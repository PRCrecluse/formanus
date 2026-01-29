import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import { ensureUserIndexUpToDate, getUserPersonaIds, pickRagEmbeddingsConfig, retrieveRelevantDocs } from "@/lib/rag";
import { AIPERSONA_SYSTEM_PROMPT } from "@/lib/prompts"; // 导入调优后的提示词
import { getMongoDb } from "@/lib/mongodb";
import { syncAutomationScheduler, type AutomationDoc } from "@/lib/automationScheduler";

export const runtime = "nodejs";

type ChatRole = "user" | "assistant" | "system";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type Body = {
  messages?: unknown;
  modelId?: unknown;
};

type ModelConfig = {
  id: string;
  modelId: string;
  apiKey: string;
};

type ModelRow = {
  id: string;
  model_id: string | null;
  api_key: string | null;
  enabled: boolean | null;
  priority: number | null;
};

type ConfigRow = {
  id: string;
  model_id: string | null;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function readJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function postJsonWithRetry(args: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  retries: number;
}) {
  const { url, headers, body, timeoutMs, retries } = args;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(t);

      if ((res.status >= 500 || res.status === 429) && attempt < retries) {
        await sleep(350 + attempt * 250);
        continue;
      }

      const data = await readJsonResponse(res);
      return { res, data };
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < retries) {
        await sleep(350 + attempt * 250);
        continue;
      }
      throw lastErr;
    }
  }

  throw lastErr;
}

const DEFAULT_MODEL_CONFIGS = [
  { id: "persona-ai", modelId: "google/gemini-3-pro-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
  { id: "gpt-5.2", modelId: "openai/gpt-5.2", keyName: "NEXT_PUBLIC_GPT52_API_KEY" },
  { id: "gpt-oss", modelId: "openai/gpt-oss-120b:free", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
  { id: "nanobanana", modelId: "google/gemini-3-pro-image-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
  { id: "gemini-3.0-pro", modelId: "google/gemini-3-pro-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
  { id: "minimax-m2", modelId: "minimax/minimax-m2", keyName: "NEXT_PUBLIC_MINIMAX_API_KEY" },
  { id: "kimi-0905", modelId: "moonshotai/kimi-k2-0905", keyName: "NEXT_PUBLIC_KIMI_API_KEY" },
  { id: "claude-3.5-sonnet", modelId: "anthropic/claude-3.5-sonnet", keyName: "NEXT_PUBLIC_CLAUDE_API_KEY" },
] as const;

function resolveDefaultModelConfigs() {
  return DEFAULT_MODEL_CONFIGS.map((cfg) => {
    const directKey = (process.env[cfg.keyName] ?? "").toString().trim();
    const fallbackKey = (process.env.NEXT_PUBLIC_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY ?? "").toString().trim();
    const apiKey = directKey || fallbackKey;
    return { id: cfg.id, modelId: cfg.modelId, apiKey };
  }).filter((cfg) => cfg.apiKey);
}

async function loadDbModelConfigs(): Promise<ModelConfig[] | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").toString().trim();
  if (!supabaseUrl || !serviceKey) return null;
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await supabase
    .from("model_configs")
    .select("id,model_id,api_key,enabled,priority")
    .order("priority", { ascending: true });
  if (error) return null;
  const rows = (data ?? []) as ModelRow[];
  const list = rows
    .map((row) => ({
      id: row.id,
      modelId: (row.model_id ?? "").toString(),
      apiKey: (row.api_key ?? "").toString().trim(),
    }))
    .filter((row) => row.id && row.modelId && row.apiKey);
  return list.length > 0 ? list : null;
}

async function loadDbBindings(ids: string[]): Promise<Map<string, string>> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").toString().trim();
  const map = new Map<string, string>();
  if (!supabaseUrl || !serviceKey || ids.length === 0) return map;
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await supabase.from("model_configs").select("id,model_id").in("id", ids);
  if (error) return map;
  const rows = (data ?? []) as ConfigRow[];
  for (const row of rows) {
    const id = (row?.id ?? "").toString().trim();
    const value = (row?.model_id ?? "").toString().trim();
    if (id && value) map.set(id, value);
  }
  return map;
}

function findModelConfig(list: ModelConfig[], key: string) {
  const normalized = (key ?? "").toString().trim();
  if (!normalized) return null;
  return list.find((m) => m.id === normalized || m.modelId === normalized) ?? null;
}

async function pickModelConfig(modelId: string | null | undefined) {
  const db = await loadDbModelConfigs();
  const defaults = resolveDefaultModelConfigs();
  const sources = [db ?? [], defaults].filter((l) => l.length > 0);
  if (sources.length === 0) return null;

  const normalized = (modelId ?? "").toString().trim();
  if (!normalized) return sources[0]?.[0] ?? null;

  for (const list of sources) {
    const found = findModelConfig(list, normalized);
    if (found) return found;
  }

  const BINDING_IDS = new Set<string>([
    "ask-default",
    "ask-default-cn",
    "ask-fallback-1",
    "ask-fallback-2",
    "ask-fallback-cn-1",
    "ask-fallback-cn-2",
  ]);
  if (BINDING_IDS.has(normalized)) {
    const bindings = await loadDbBindings([normalized]);
    const targetId = (bindings.get(normalized) ?? "").toString().trim();
    if (targetId) {
      for (const list of sources) {
        const byTarget = findModelConfig(list, targetId);
        if (byTarget) return byTarget;
      }
    }
    return null;
  }
  return null;
}

function uniqNonEmpty(values: Array<string | null | undefined>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const s = (v ?? "").toString().trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function getUpstreamErrorMessage(detail: unknown) {
  if (!detail) return "";
  if (typeof detail === "string") return detail.trim();
  if (typeof detail !== "object") return "";
  const obj = detail as Record<string, unknown>;
  const msg = obj.message;
  if (typeof msg === "string") return msg.trim();
  return "";
}

function shouldFallbackOnUpstreamError(status: number, detail: unknown) {
  if (status === 429 || status >= 500) return true;
  if (status !== 400) return false;
  const msg = getUpstreamErrorMessage(detail).toLowerCase();
  if (!msg) return false;
  return msg.includes("not a valid model id") || msg.includes("invalid model id");
}

function getHeader(headers: Headers, names: string[]) {
  for (const name of names) {
    const value = headers.get(name);
    if (value && value.trim()) return value.trim();
  }
  return "";
}

function getClientIp(headers: Headers) {
  const forwarded = getHeader(headers, ["x-forwarded-for"]);
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    getHeader(headers, ["x-real-ip", "cf-connecting-ip", "x-client-ip", "x-forwarded", "forwarded-for", "forwarded"]) || ""
  );
}

async function lookupCountryByIp(ip: string) {
  if (!ip) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { country_code?: string | null };
    const code = (json?.country_code ?? "").toString().trim().toUpperCase();
    return code || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function stripHtml(html: string): string {
  return (html ?? "")
    .toString()
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  const out: ChatMessage[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const obj = v as { role?: unknown; content?: unknown };
    const role = obj.role === "user" || obj.role === "assistant" || obj.role === "system" ? obj.role : null;
    const content = typeof obj.content === "string" ? obj.content : null;
    if (!role || content === null) continue;
    out.push({ role, content });
  }
  return out;
}

function normalizeOrigin(value: string) {
  return value.replace(/\/+$/, "");
}

function getPublicOrigin(req: Request) {
  const proto = (req.headers.get("x-forwarded-proto") ?? "").toString().trim();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").toString().trim();
  if (proto && host) return normalizeOrigin(`${proto}://${host}`);
  try {
    return normalizeOrigin(new URL(req.url).origin);
  } catch {
    const envOrigin = (process.env.NEXT_PUBLIC_SITE_URL ?? "").toString().trim();
    return envOrigin ? normalizeOrigin(envOrigin) : "";
  }
}

function extractJson(text: string): unknown | null {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  const slice = text.slice(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

function parseCronFromChinese(text: string): { cron: string; timezoneHint: string } | null {
  const raw = (text ?? "").toString();
  if (!raw.includes("每天")) return null;
  const re =
    /每天\s*(早上|上午|中午|下午|晚上|夜里|凌晨)?\s*(\d{1,2})\s*(?:点|时)(?:\s*(\d{1,2})\s*分?)?/;
  const m = re.exec(raw);
  if (!m) return null;
  const period = (m[1] ?? "").toString();
  const hourRaw = Number(m[2]);
  const minuteRaw = m[3] ? Number(m[3]) : 0;
  if (!Number.isFinite(hourRaw) || !Number.isFinite(minuteRaw)) return null;
  if (hourRaw < 0 || hourRaw > 23 || minuteRaw < 0 || minuteRaw > 59) return null;
  let hour = hourRaw;
  const isPm = period === "下午" || period === "晚上" || period === "夜里" || period === "中午";
  if (isPm && hour < 12) hour += 12;
  if (period === "凌晨" && hour === 12) hour = 0;
  const cron = `${minuteRaw} ${hour} * * *`;
  return { cron, timezoneHint: "Asia/Shanghai" };
}

function parseCronFromEnglish(text: string): { cron: string; timezoneHint: string } | null {
  const raw = (text ?? "").toString().trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (!/(every\s+day|daily|each\s+day)/.test(lower)) return null;
  const patterns: RegExp[] = [
    /\b(?:every\s+day|daily|each\s+day)\b[\s,]*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b[\s,]*(?:every\s+day|daily|each\s+day)\b/i,
    /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b[\s,]*(?:every\s+day|daily|each\s+day)\b/i,
  ];
  let m: RegExpExecArray | null = null;
  for (const re of patterns) {
    m = re.exec(raw);
    if (m) break;
  }
  if (!m) return null;
  const hourRaw = Number(m[1]);
  const minuteRaw = m[2] ? Number(m[2]) : 0;
  const ampm = (m[3] ?? "").toString().toLowerCase();
  if (!Number.isFinite(hourRaw) || !Number.isFinite(minuteRaw)) return null;
  if (minuteRaw < 0 || minuteRaw > 59) return null;
  let hour = hourRaw;
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    if (ampm === "am") {
      if (hour === 12) hour = 0;
    } else if (ampm === "pm") {
      if (hour !== 12) hour += 12;
    } else {
      return null;
    }
  } else {
    if (hour < 0 || hour > 23) return null;
  }
  const cron = `${minuteRaw} ${hour} * * *`;
  return { cron, timezoneHint: "UTC" };
}

function inferCronFromMessage(text: string) {
  return parseCronFromChinese(text) || parseCronFromEnglish(text);
}

function isValidTimezoneName(value: string) {
  const s = (value ?? "").toString().trim();
  if (!s) return false;
  if (!s.includes("/")) return false;
  if (/\s/.test(s)) return false;
  return true;
}

function inferTimezoneFromCountry(country: string): string | null {
  const code = (country ?? "").toString().trim().toUpperCase();
  if (!code) return null;
  const map: Record<string, string> = {
    CN: "Asia/Shanghai",
    HK: "Asia/Hong_Kong",
    TW: "Asia/Taipei",
    MO: "Asia/Macau",
    JP: "Asia/Tokyo",
    KR: "Asia/Seoul",
    SG: "Asia/Singapore",
    IN: "Asia/Kolkata",
    TH: "Asia/Bangkok",
    VN: "Asia/Ho_Chi_Minh",
    ID: "Asia/Jakarta",
    PH: "Asia/Manila",
    AU: "Australia/Sydney",
    NZ: "Pacific/Auckland",
    GB: "Europe/London",
    IE: "Europe/Dublin",
    FR: "Europe/Paris",
    DE: "Europe/Berlin",
    ES: "Europe/Madrid",
    IT: "Europe/Rome",
    NL: "Europe/Amsterdam",
    BE: "Europe/Brussels",
    CH: "Europe/Zurich",
    AT: "Europe/Vienna",
    SE: "Europe/Stockholm",
    NO: "Europe/Oslo",
    DK: "Europe/Copenhagen",
    FI: "Europe/Helsinki",
    PL: "Europe/Warsaw",
    CZ: "Europe/Prague",
    PT: "Europe/Lisbon",
    RU: "Europe/Moscow",
    TR: "Europe/Istanbul",
    IL: "Asia/Jerusalem",
    SA: "Asia/Riyadh",
    AE: "Asia/Dubai",
    ZA: "Africa/Johannesburg",
    NG: "Africa/Lagos",
    EG: "Africa/Cairo",
    BR: "America/Sao_Paulo",
    AR: "America/Argentina/Buenos_Aires",
    CL: "America/Santiago",
    CO: "America/Bogota",
    PE: "America/Lima",
    MX: "America/Mexico_City",
    CA: "America/Toronto",
    US: "America/New_York",
  };
  return map[code] || null;
}

function inferAutomationKind(text: string): { kind: "ai_news_briefing" | "competitor_monitor" | "other"; target: string } {
  const raw = (text ?? "").toString().trim();
  const lower = raw.toLowerCase();
  if (/早报|新闻|资讯/.test(raw) && (raw.includes("AI") || raw.includes("ai") || /人工智能/.test(raw) || lower.includes("ai"))) {
    return { kind: "ai_news_briefing", target: "AI新闻早报" };
  }
  if (raw.includes("竞品") || raw.includes("竞对") || lower.includes("competitor")) {
    return { kind: "competitor_monitor", target: raw.slice(0, 80) };
  }
  return { kind: "other", target: raw.slice(0, 80) };
}

function normalizeThinkingSteps(value: unknown): Array<{ label: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ label: string }> = [];
  for (const it of value) {
    const obj = it && typeof it === "object" ? (it as Record<string, unknown>) : null;
    if (!obj) continue;
    const label = typeof obj.label === "string" ? obj.label.trim() : "";
    if (!label) continue;
    out.push({ label });
  }
  return out.slice(0, 20);
}

function normalizeTaskPlan(value: unknown): Array<{ title: string; status?: "pending" | "in_progress" | "completed" }> {
  if (!Array.isArray(value)) return [];
  const placeholderTitles = new Set([
    "理解需求与约束",
    "制定执行步骤",
    "执行并反馈结果",
    "understand requirements and constraints",
    "plan execution steps",
    "execute and report results",
  ]);
  const out: Array<{ title: string; status?: "pending" | "in_progress" | "completed" }> = [];
  for (const it of value) {
    const obj = it && typeof it === "object" ? (it as Record<string, unknown>) : null;
    if (!obj) continue;
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    if (!title) continue;
    if (placeholderTitles.has(title.toLowerCase())) continue;
    const statusRaw = typeof obj.status === "string" ? obj.status.trim() : "";
    const status =
      statusRaw === "pending" || statusRaw === "in_progress" || statusRaw === "completed"
        ? (statusRaw as "pending" | "in_progress" | "completed")
        : undefined;
    out.push({ title, ...(status ? { status } : {}) });
  }
  return out.slice(0, 12);
}

async function createAutomationFromAgent(args: {
  userId: string;
  origin: string;
  name: string;
  cron: string;
  timezone: string | null;
  todos: Array<{ text: string; done: boolean }>;
  internal: Record<string, unknown>;
  enabled?: boolean;
  previewConfig?: { enabled: boolean; auto_confirm: boolean; confirm_timeout_seconds: number } | null;
}) {
  const now = new Date();
  const id = crypto.randomUUID();
  const db = await getMongoDb();
  await db.collection<AutomationDoc & { internal?: Record<string, unknown> }>("automations").insertOne({
    _id: id,
    userId: args.userId,
    name: args.name,
    enabled: args.enabled ?? true,
    cron: args.cron,
    timezone: args.timezone,
    webhookUrl: `${args.origin}/api/automations/webhook`,
    internal: args.internal,
    previewConfig: args.previewConfig ?? null,
    todos: args.todos.map((t) => ({ _id: crypto.randomUUID(), text: t.text, done: t.done, createdAt: now })),
    lastRunAt: null,
    lastRunOk: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });
  await syncAutomationScheduler().catch(() => null);
  return id;
}

function creditsPerRequestForModelKey(modelKey: string | null | undefined): number {
  if (modelKey === "gpt-oss") return 0;
  if (modelKey === "claude-3.5-sonnet") return 3;
  if (modelKey === "nanobanana") return 2;
  if (modelKey === "gpt-5.2") return 2;
  return 2;
}

let billingClient: ReturnType<typeof createClient> | null = null;

function getBillingClient() {
  if (billingClient) return billingClient;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").toString().trim();
  if (!supabaseUrl || !serviceKey) return null;
  billingClient = createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return billingClient;
}

async function chargeCredits(args: {
  userId: string;
  modelKey: string | null | undefined;
  taskId: string;
  title: string;
  inputText: string;
  outputText: string;
}): Promise<{ billed: boolean; creditsUsed: number; newTotal: number | null }> {
  const supabase = getBillingClient();
  if (!supabase) {
    console.warn("[billing] disabled", { taskId: args.taskId, userId: args.userId });
    return { billed: false, creditsUsed: 0, newTotal: null };
  }
  const creditsUsed = creditsPerRequestForModelKey(args.modelKey);
  if (!Number.isFinite(creditsUsed) || creditsUsed <= 0) return { billed: false, creditsUsed: 0, newTotal: null };

  const currentCreditsRes = await supabase.from("users").select("credits").eq("id", args.userId).maybeSingle();
  if (currentCreditsRes.error) {
    console.error("[billing] failed_to_read_credits", { taskId: args.taskId, userId: args.userId, error: currentCreditsRes.error });
    return { billed: false, creditsUsed: 0, newTotal: null };
  }
  const currentCreditsRaw = (currentCreditsRes.data as { credits?: unknown } | null)?.credits;
  const currentCredits = typeof currentCreditsRaw === "number" && Number.isFinite(currentCreditsRaw) ? Math.floor(currentCreditsRaw) : 0;
  const newCredits = currentCredits - creditsUsed;

  const insertRes = await (supabase.from("credit_history") as unknown as {
    insert: (values: { id: string; user_id: string; title: string; qty: number; amount?: number; total: number }) => PromiseLike<{
      error: { code?: string; message?: string } | null;
    }>;
  }).insert({
    id: args.taskId,
    user_id: args.userId,
    title: args.title,
    qty: -creditsUsed,
    amount: -creditsUsed,
    total: newCredits,
  });
  if (insertRes.error) {
    if (insertRes.error.code === "23505") {
      console.info("[billing] already_billed", { taskId: args.taskId, userId: args.userId });
      return { billed: false, creditsUsed: 0, newTotal: null };
    }
    console.error("[billing] failed_to_insert_history", { taskId: args.taskId, userId: args.userId, error: insertRes.error });
    return { billed: false, creditsUsed: 0, newTotal: null };
  }
  const updateRes = await (supabase.from("users") as unknown as {
    update: (values: { credits: number }) => {
      eq: (column: string, value: string) => PromiseLike<{ error: { message?: string } | null }>;
    };
  })
    .update({ credits: newCredits })
    .eq("id", args.userId);
  if ((updateRes as { error?: unknown }).error) {
    console.error("[billing] failed_to_update_credits", { taskId: args.taskId, userId: args.userId, error: (updateRes as { error?: unknown }).error });
    return { billed: true, creditsUsed, newTotal: null };
  }
  console.info("[billing] charged", { taskId: args.taskId, userId: args.userId, creditsUsed, newCredits });
  return { billed: true, creditsUsed, newTotal: newCredits };
}

export async function POST(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const rawTaskId = req.headers.get("x-task-id") ?? req.headers.get("x-request-id");
  const taskIdCandidate = (rawTaskId ?? "").toString().trim();
  const taskId = taskIdCandidate && isUuid(taskIdCandidate) ? taskIdCandidate : crypto.randomUUID();
  const requestId = taskId;
  const requestFailed = () => `request failed,requestid=${requestId}`;

  let body: Body | null = null;
  try {
    body = (await req.json()) as Body;
  } catch {
    body = null;
  }

  const modelKey = typeof body?.modelId === "string" ? body.modelId.trim() : "";
  const countryHeader =
    getHeader(req.headers, ["x-vercel-ip-country"]) ||
    getHeader(req.headers, ["cf-ipcountry"]) ||
    getHeader(req.headers, ["x-country-code"]);
  let country = countryHeader ? countryHeader.toUpperCase() : null;
  if (!country) {
    const ip = getClientIp(req.headers);
    const lookedUp = await lookupCountryByIp(ip);
    if (lookedUp) country = lookedUp;
  }
  const isMainlandChina = country === "CN";
  const directTimezone =
    getHeader(req.headers, ["x-vercel-ip-timezone"]) || getHeader(req.headers, ["cf-timezone"]) || getHeader(req.headers, ["x-timezone"]);
  const countryTimezone = country ? inferTimezoneFromCountry(country) : null;
  const requestTimezone = (directTimezone && isValidTimezoneName(directTimezone) ? directTimezone : countryTimezone) || (isMainlandChina ? "Asia/Shanghai" : "UTC");
  const defaultModelKey = isMainlandChina ? "ask-default-cn" : "ask-default";
  const primaryModelKey = modelKey || defaultModelKey;
  const fallbackCandidates = isMainlandChina
    ? ["ask-fallback-cn-1", "ask-fallback-cn-2"]
    : ["ask-fallback-1", "ask-fallback-2"];
  const candidateIds = uniqNonEmpty([primaryModelKey, ...fallbackCandidates]);
  const baseURL = ((process.env.NEXT_PUBLIC_OPENROUTER_BASE_URL ?? process.env.OPENROUTER_BASE_URL ?? "").toString().trim() ||
    "https://openrouter.ai/api/v1");

  const messages = safeMessages(body?.messages);
  if (messages.length === 0) {
    console.error("[chat/complete] invalid_messages", { taskId, requestId, userId: auth.user.id });
    return Response.json({ error: requestFailed() }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[chat/complete] supabase_not_configured", { taskId, requestId, userId: auth.user.id });
    return Response.json({ error: requestFailed() }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const ragEnabled = (process.env.RAG_ENABLED ?? "1").toString().trim() !== "0";
  const ragEmbeddings = ragEnabled ? pickRagEmbeddingsConfig() : null;

  let augmented: ChatMessage[] = messages;
  
  // 注入调优后的系统提示词 (AIPersona Strategic Orchestrator)
  const systemMsg: ChatMessage = {
    role: "system",
    content: `${AIPERSONA_SYSTEM_PROMPT}

## Output Contract (Strict)
You MUST respond with a single JSON object only (no Markdown fences, no extra text).
Schema:
{
  "reply": "string",
  "thinking_steps": [{"label": "string"}],
  "task_plan": [{"title":"string","status":"pending|in_progress|completed"}],
  "automation": {
    "auto_create": true|false,
    "name": "string",
    "cron": "string (5-field cron)",
    "timezone": "string|null",
    "kind": "ai_news_briefing|competitor_monitor|other",
    "target": "string"
  }
}
Rules:
- thinking_steps: show high-level progress labels only; do NOT include chain-of-thought.
- task_plan: only include concrete, user-facing execution steps or deliverables; omit it if you only have generic placeholders.
- NEVER put generic items like "理解需求与约束" / "制定执行步骤" / "执行并反馈结果" in task_plan.
If user requests a recurring schedule (e.g. every day 9am), include automation.auto_create=true with a valid cron/timezone.`,
  };

  if (ragEnabled && ragEmbeddings) {
    try {
      const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
      const query = lastUser.toString().trim();
      if (query) {
        const personaIds = await getUserPersonaIds(auth.user.id);
        await ensureUserIndexUpToDate({ supabase, userId: auth.user.id, personaIds, embeddings: ragEmbeddings });
        const retrieved = await retrieveRelevantDocs({ supabase, personaIds, query, embeddings: ragEmbeddings, maxDocs: 6 });
        if (retrieved.length > 0) {
          const text = retrieved
            .map((d, i) => {
              const title = (d.title ?? "").toString().trim();
              const raw = d.content ?? "";
              const plain = stripHtml(raw.toString());
              const header = `Doc ${i + 1}${title ? `: ${title}` : ""} (id: ${d.id})`;
              return `${header}\n${plain}`.trim();
            })
            .join("\n\n---\n\n")
            .slice(0, 24_000);
          
          const ragSys: ChatMessage = {
            role: "system",
            content: ["Relevant user documents are provided below.", "Use them when answering if helpful.", "", text]
              .filter(Boolean)
              .join("\n"),
          };
          // 编排：调优提示词放在最前，RAG 信息紧随其后
          augmented = [systemMsg, ragSys, ...messages];
        } else {
          augmented = [systemMsg, ...messages];
        }
      } else {
        augmented = [systemMsg, ...messages];
      }
    } catch {
      augmented = [systemMsg, ...messages];
    }
  } else {
    augmented = [systemMsg, ...messages];
  }

  console.info("[chat/complete] task_started", { taskId, requestId, userId: auth.user.id, modelId: modelKey || null });
  const attempted = new Set<string>();
  for (let i = 0; i < candidateIds.length; i += 1) {
    const candidateId = candidateIds[i]!;
    const isLast = i === candidateIds.length - 1;
    try {
      const cfg = await pickModelConfig(candidateId);
      if (!cfg || !cfg.apiKey) {
        console.error("[chat/complete] missing_model_config", { taskId, requestId, userId: auth.user.id, candidateId });
        continue;
      }
      const signature = `${cfg.id}::${cfg.modelId}`;
      if (attempted.has(signature)) {
        console.info("[chat/complete] skip_duplicate_candidate", { taskId, requestId, userId: auth.user.id, candidateId, signature });
        continue;
      }
      attempted.add(signature);

      const url = `${baseURL.replace(/\/+$/g, "")}/chat/completions`;
      const { res, data } = await postJsonWithRetry({
        url,
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://aipersona.web",
          "X-Title": "AIPersona",
        },
        body: {
          model: cfg.modelId,
          messages: augmented,
        },
        timeoutMs: 25_000,
        retries: 0,
      });

      if (!res.ok) {
        const status = res.status;
        const detail =
          data && typeof data === "object" && data && "error" in (data as Record<string, unknown>)
            ? (data as Record<string, unknown>).error
            : null;
        console.error("[chat/complete] upstream_failed", {
          taskId,
          requestId,
          userId: auth.user.id,
          candidateId,
          modelId: cfg.modelId,
          status,
          detail,
        });
        if (!isLast && shouldFallbackOnUpstreamError(status, detail)) {
          await sleep(250 + i * 200);
          continue;
        }
        return Response.json({ error: requestFailed() }, { status: 502 });
      }

      let creditsUsed = 0;
      try {
        const content = (() => {
          if (!data || typeof data !== "object") return "";
          const obj = data as { choices?: Array<{ message?: { content?: unknown } }> };
          const first = Array.isArray(obj.choices) && obj.choices.length > 0 ? obj.choices[0] : null;
          const msg = first && first.message ? first.message : null;
          const raw = msg && typeof msg.content === "string" ? (msg.content as string) : "";
          if (raw) return raw;
          if (msg && Array.isArray(msg.content)) {
            const parts = (msg.content as Array<{ text?: string }>)
              .map((p) => (typeof p?.text === "string" ? p.text.trim() : ""))
              .filter(Boolean);
            return parts.join("\n");
          }
          return "";
        })();
        const inputText = augmented.map((m) => (m?.content ?? "").toString()).join("\n");
        const billed = await chargeCredits({
          userId: auth.user.id,
          modelKey: cfg.id,
          taskId,
          title: `Chat usage · chat/complete · ${cfg.id}`,
          inputText,
          outputText: content,
        });
        creditsUsed = billed.creditsUsed;
      } catch {
        void 0;
      }

      const rawContent = (() => {
        if (!data || typeof data !== "object") return "";
        const obj = data as { choices?: Array<{ message?: { content?: unknown } }> };
        const first = Array.isArray(obj.choices) && obj.choices.length > 0 ? obj.choices[0] : null;
        const msg = first && first.message ? first.message : null;
        if (msg && typeof msg.content === "string") return msg.content as string;
        if (msg && Array.isArray(msg.content)) {
          const parts = (msg.content as Array<{ text?: string }>)
            .map((p) => (typeof p?.text === "string" ? p.text.trim() : ""))
            .filter(Boolean);
          return parts.join("\n");
        }
        return "";
      })();

      const lastUserText = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
      const parsed = extractJson(rawContent);
      const parsedObj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
      const replyTextRaw = parsedObj && typeof parsedObj.reply === "string" ? parsedObj.reply.trim() : "";
      let replyText = replyTextRaw || rawContent || "The agent did not return a visible reply.";
      const thinkingSteps = normalizeThinkingSteps(parsedObj?.thinking_steps);
      let taskPlan = normalizeTaskPlan(parsedObj?.task_plan);

      const origin = getPublicOrigin(req);
      const inferredCron = inferCronFromMessage(lastUserText);
      const automationObj = parsedObj?.automation && typeof parsedObj.automation === "object" ? (parsedObj.automation as Record<string, unknown>) : null;
      const automationAutoCreate = Boolean(automationObj?.auto_create);
      const automationNameRaw = typeof automationObj?.name === "string" ? automationObj.name.trim() : "";
      const automationCronRaw = typeof automationObj?.cron === "string" ? automationObj.cron.trim() : "";
      const automationTzRaw = typeof automationObj?.timezone === "string" ? automationObj.timezone.trim() : "";
      const automationKindRaw = typeof automationObj?.kind === "string" ? automationObj.kind.trim() : "";
      const automationTargetRaw = typeof automationObj?.target === "string" ? automationObj.target.trim() : "";
      const { kind: inferredKind, target: inferredTarget } = inferAutomationKind(lastUserText.toString());
      const automationKind = (automationKindRaw || inferredKind) as "ai_news_briefing" | "competitor_monitor" | "other";
      const automationTarget = automationTargetRaw || inferredTarget;

      const shouldCreateAutomation =
        origin &&
        (automationAutoCreate || Boolean(inferredCron)) &&
        (automationCronRaw || inferredCron?.cron) &&
        (automationNameRaw || lastUserText.trim());

      let createdAutomation: { id: string; name: string; cron: string; enabled: boolean } | null = null;
      let autoConfirmAt: string | null = null;
      if (shouldCreateAutomation) {
        const cron = automationCronRaw || inferredCron!.cron;
        const timezone =
          (automationTzRaw || requestTimezone || inferredCron?.timezoneHint || (isMainlandChina ? "Asia/Shanghai" : "UTC")).trim() ||
          (isMainlandChina ? "Asia/Shanghai" : "UTC");
        const name =
          automationNameRaw ||
          (automationKind === "ai_news_briefing"
            ? "AI新闻早报"
            : automationKind === "competitor_monitor"
              ? `竞品监控：${automationTarget}`
              : `自动化任务：${(lastUserText ?? "").toString().slice(0, 24)}`);
        const internal =
          automationKind === "ai_news_briefing"
            ? { kind: automationKind, topic: automationTarget || "AI新闻早报", source: "chat", model_key: cfg.id }
            : {
                kind: automationKind,
                target: automationTarget || (lastUserText ?? "").toString().slice(0, 80),
                source: "chat",
                model_key: cfg.id,
              };
        const confirmTimeoutSeconds = 10;
        autoConfirmAt = new Date(Date.now() + confirmTimeoutSeconds * 1000).toISOString();
        const todosFromPlan =
          taskPlan.length > 0
            ? taskPlan
            : [
                { title: "Analyze monitoring target", status: "pending" as const },
                { title: "Fetch latest information", status: "pending" as const },
                { title: "Generate summary report", status: "pending" as const },
                { title: "Save results to library", status: "pending" as const },
              ];
        const todos = todosFromPlan.map((t) => ({ text: t.title, done: t.status === "completed" }));
        const id = await createAutomationFromAgent({
          userId: auth.user.id,
          origin,
          name,
          cron,
          timezone: timezone || null,
          todos,
          internal,
          enabled: false,
          previewConfig: { enabled: true, auto_confirm: true, confirm_timeout_seconds: confirmTimeoutSeconds },
        });
        createdAutomation = { id, name, cron, enabled: false };
        if (taskPlan.length === 0) taskPlan = todosFromPlan;
      }
      if (createdAutomation && autoConfirmAt) {
        const note =
          "\n\n我将于10秒后按以上配置创建并启用该自动化任务；如需取消或修改，请在倒计时结束前告知我。";
        if (!replyText.includes("10秒后")) replyText = `${replyText}${note}`;
      }

      const meta = {
        ...(thinkingSteps.length > 0 ? { thinking_steps: thinkingSteps } : {}),
        ...(taskPlan.length > 0 ? { task_plan: taskPlan } : {}),
        ...(createdAutomation
          ? {
              automation: {
                ...createdAutomation,
                auto_confirm: true,
                confirm_timeout_seconds: 10,
                confirm_at: autoConfirmAt,
              },
            }
          : {}),
      } as Record<string, unknown>;

      const BOARD_MESSAGE_META_DELIMITER = "\n---AIPERSONA_META---\n";
      const patchedContent =
        Object.keys(meta).length > 0 ? `${replyText}${BOARD_MESSAGE_META_DELIMITER}${JSON.stringify(meta)}` : replyText;

      const patchedData =
        data && typeof data === "object" ? ({ ...(data as Record<string, unknown>) } as Record<string, unknown>) : null;
      if (patchedData && Array.isArray((patchedData as { choices?: unknown }).choices)) {
        const choices = (patchedData as { choices: unknown[] }).choices;
        const firstChoice = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>) : {};
        const firstMsg =
          firstChoice.message && typeof firstChoice.message === "object" ? (firstChoice.message as Record<string, unknown>) : {};
        firstMsg.content = patchedContent;
        firstChoice.message = firstMsg;
        (patchedData as { choices: unknown[] }).choices = [firstChoice, ...choices.slice(1)];
      }

      console.info("[chat/complete] task_completed", {
        taskId,
        requestId,
        userId: auth.user.id,
        creditsUsed,
        candidateId,
        chosenModelKey: cfg.id,
        chosenModelId: cfg.modelId,
      });

      if (patchedData && typeof patchedData === "object") {
        return Response.json({ ...(patchedData as Record<string, unknown>), task_id: taskId, credits_used: creditsUsed }, { status: 200 });
      }
      return Response.json({ data: patchedData ?? data, task_id: taskId, credits_used: creditsUsed }, { status: 200 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upstream request failed";
      console.error("[chat/complete] candidate_error", { taskId, requestId, userId: auth.user.id, candidateId, error: msg });
      if (!isLast) {
        await sleep(250 + i * 200);
        continue;
      }
      return Response.json({ error: requestFailed() }, { status: 502 });
    }
  }

  console.error("[chat/complete] all_failed", { taskId, requestId, userId: auth.user.id, modelId: modelKey || null });
  return Response.json({ error: requestFailed() }, { status: 502 });
}
