import { createClient } from "@supabase/supabase-js";
import {
  ensureUserIndexUpToDate,
  getUserPersonaIds,
  indexPersonaDocs,
  pickRagEmbeddingsConfig,
  retrieveRelevantDocs,
} from "@/lib/rag";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import { getMongoDb } from "@/lib/mongodb";
import { syncAutomationScheduler, type AutomationDoc } from "@/lib/automationScheduler";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { makePersonaDocDbId } from "@/lib/utils";
import { formatWebSearchForPrompt, runWebSearch, type WebSearchResult } from "@/lib/skills";
import { fillPromptTemplate, loadPromptTemplate } from "@/lib/prompts";

export const runtime = "nodejs";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type PersonaDocRow = {
  id: string;
  persona_id: string | null;
  title: string | null;
  content: string | null;
  type: string | null;
  updated_at: string | null;
  is_folder?: boolean | null;
};

type SkillInput = {
  message: string;
  history: ChatMessage[];
  docs: PersonaDocRow[];
  web: string;
};

type SkillContext = {
  userId: string;
  modelId: string | null;
  taskId: string;
  chatMode: "ask" | "create";
};

type SkillResultDoc = {
  id: string | null;
  title: string | null;
  content: string;
  type: string | null;
};

type SkillResult = {
  reply: string;
  updatedDocs: SkillResultDoc[];
};

type Skill = {
  id: string;
  name: string;
  description: string;
  run: (args: { model: ChatOpenAI; input: SkillInput; context: SkillContext }) => Promise<SkillResult>;
};

type Chat2EditRequestBody = {
  message?: unknown;
  history?: unknown;
  attachedResourceIds?: unknown;
  modelId?: unknown;
  skillId?: unknown;
  defaultPersonaId?: unknown;
  stream?: unknown;
  mode?: unknown;
};

type Chat2EditResponseDoc = {
  id: string;
  title: string | null;
  content: string | null;
  type: string | null;
  updated_at: string | null;
  persona_id: string | null;
};

type Chat2EditResponse = {
  reply: string;
  updated_docs: Chat2EditResponseDoc[];
  changes?: Chat2EditChange[];
  web_search_enabled?: boolean;
  web_search?: { query: string; results: WebSearchResult[] } | null;
  web_search_error?: string | null;
  task_id?: string;
  credits_used?: number;
};

type Chat2EditChange = {
  id: string;
  persona_id: string | null;
  title_before: string | null;
  title_after: string | null;
  content_before: string | null;
  content_after: string | null;
  type_before: string | null;
  type_after: string | null;
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

const DEFAULT_MODEL_CONFIGS = [
  { id: "persona-ai", modelId: "anthropic/claude-3.5-sonnet", keyName: "NEXT_PUBLIC_CLAUDE_API_KEY" },
  { id: "gpt-5.2", modelId: "openai/gpt-4o", keyName: "NEXT_PUBLIC_GPT52_API_KEY" },
  { id: "gpt-oss", modelId: "openai/gpt-oss-120b:free", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
  { id: "nanobanana", modelId: "google/gemini-3-pro-image-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
  { id: "gemini-3.0-pro", modelId: "google/gemini-3-pro-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
  { id: "minimax-m2", modelId: "minimax/minimax-m2", keyName: "NEXT_PUBLIC_MINIMAX_API_KEY" },
  { id: "kimi-0905", modelId: "moonshotai/kimi-k2-0905", keyName: "NEXT_PUBLIC_KIMI_API_KEY" },
] as const;

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

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
    .eq("enabled", true)
    .order("priority", { ascending: true });
  if (error) return null;
  const rows = (data ?? []) as ModelRow[];
  const list = rows
    .filter((row) => row && row.enabled !== false)
    .map((row) => ({
      id: row.id,
      modelId: (row.model_id ?? "").toString(),
      apiKey: (row.api_key ?? "").toString().trim(),
    }))
    .filter((row) => row.id && row.modelId && row.apiKey);
  return list.length > 0 ? list : null;
}

async function pickModelConfig(modelId: string | null | undefined) {
  const db = await loadDbModelConfigs();
  const list = db ?? resolveDefaultModelConfigs();
  if (list.length === 0) return null;
  if (!modelId) return list[0] ?? null;
  const found = list.find((m) => m.id === modelId);
  return found ?? list[0] ?? null;
}

async function createChatModel(modelKey: string | null | undefined, opts?: { streaming?: boolean }) {
  const cfg = await pickModelConfig(modelKey);
  if (!cfg || !cfg.apiKey) {
    throw new Error("Missing API key for model");
  }
  const base = (process.env.NEXT_PUBLIC_OPENROUTER_BASE_URL ?? "").toString().trim();
  const baseURL = base || "https://openrouter.ai/api/v1";
  return new ChatOpenAI({
    model: cfg.modelId,
    temperature: 0.7,
    streaming: Boolean(opts?.streaming),
    configuration: {
      apiKey: cfg.apiKey,
      baseURL,
    },
  });
}

function creditsPerRequestForModelKey(modelKey: string | null | undefined): number {
  if (modelKey === "gpt-oss") return 0;
  if (modelKey === "claude-3.5-sonnet") return 3;
  if (modelKey === "nanobanana") return 2;
  if (modelKey === "gpt-5.2") return 2;
  return 2;
}

function estimateTokens(text: string): number {
  const raw = (text ?? "").toString();
  if (!raw) return 0;
  const cjk = (raw.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const nonCjkLen = raw.replace(/[\u4e00-\u9fff]/g, "").length;
  return Math.max(1, Math.ceil(cjk + nonCjkLen / 4));
}

let billingClient: ReturnType<typeof createClient> | null = null;

function getBillingClient() {
  if (billingClient) return billingClient;
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").toString().trim();
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
  if (updateRes.error) {
    console.error("[billing] failed_to_update_credits", { taskId: args.taskId, userId: args.userId, error: updateRes.error });
    return { billed: true, creditsUsed, newTotal: null };
  }
  console.info("[billing] charged", { taskId: args.taskId, userId: args.userId, creditsUsed, newCredits });
  return { billed: true, creditsUsed, newTotal: newCredits };
}

function isChineseText(text: string) {
  return /[\u4e00-\u9fff]/.test(text);
}

function normalizeChatMode(value: unknown): "ask" | "create" {
  return value === "ask" ? "ask" : "create";
}

const BOARD_MESSAGE_META_DELIMITER = "\n---AIPERSONA_META---\n";

function normalizeOrigin(origin: string) {
  const raw = (origin ?? "").toString().trim();
  if (!raw) return "";
  return raw.replace(/\/+$/g, "");
}

function getPublicOrigin(req: Request) {
  try {
    return normalizeOrigin(new URL(req.url).origin);
  } catch {
    const envOrigin = (process.env.NEXT_PUBLIC_SITE_URL ?? "").toString().trim();
    return envOrigin ? normalizeOrigin(envOrigin) : "";
  }
}

function parseCronFromChinese(text: string): { cron: string; timezoneHint: string } | null {
  const raw = (text ?? "").toString();
  if (!raw.includes("每天") && !raw.includes("每日")) return null;
  const re =
    /(每天|每日)\s*(早上|上午|中午|下午|晚上|夜里|凌晨)?\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2}))?\s*(?:点|时)?(?:\s*(\d{1,2})\s*分?)?/;
  const m = re.exec(raw);
  if (!m) return null;
  const period = (m[2] ?? "").toString();
  const hourRaw = Number(m[3]);
  const minuteFromColon = m[4] ? Number(m[4]) : NaN;
  const minuteFromSuffix = m[5] ? Number(m[5]) : NaN;
  const minuteRaw = Number.isFinite(minuteFromColon) ? minuteFromColon : Number.isFinite(minuteFromSuffix) ? minuteFromSuffix : 0;
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

function inferCronFromMessage(text: string): { cron: string; timezoneHint: string } | null {
  return parseCronFromChinese(text) || parseCronFromEnglish(text);
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

async function inferTimezoneFromRequest(req: Request, fallback: string) {
  const headers = req.headers;
  const directTz = getHeader(headers, ["x-vercel-ip-timezone", "cf-timezone", "x-timezone"]);
  if (directTz && isValidTimezoneName(directTz)) return directTz;
  const countryHeader =
    getHeader(headers, ["x-vercel-ip-country"]) || getHeader(headers, ["cf-ipcountry"]) || getHeader(headers, ["x-country-code"]);
  const country = countryHeader ? countryHeader.toUpperCase() : await lookupCountryByIp(getClientIp(headers));
  const tz = country ? inferTimezoneFromCountry(country) : null;
  return tz || fallback;
}

function inferAutomationKind(message: string): { kind: "ai_news_briefing" | "competitor_monitor" | "other"; target: string } {
  const raw = (message ?? "").toString().trim();
  const lower = raw.toLowerCase();
  if (/早报|新闻|资讯/.test(raw) && (raw.includes("AI") || raw.includes("ai") || /人工智能/.test(raw) || lower.includes("ai "))) {
    return { kind: "ai_news_briefing", target: "AI新闻早报" };
  }
  if (raw.includes("竞品") || raw.includes("竞对") || lower.includes("competitor")) {
    return { kind: "competitor_monitor", target: raw.slice(0, 80) };
  }
  return { kind: "other", target: raw.slice(0, 80) };
}

async function createAutomationFromBoard(args: {
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

async function loadChat2EditSystemPrompt(mode: "ask" | "create") {
  const key = mode === "ask" ? "board_chat2edit_system_ask.txt" : "board_chat2edit_system_create.txt";
  const text = await loadPromptTemplate(key);
  if (text) return text;
  return [
    "You are an editor for social media and persona documents.",
    "You can also assist with image or illustration requests; the system will create images when needed.",
    "Return a single JSON object with fields: reply and documents.",
  ].join(" ");
}

async function loadChat2EditUserPrompt() {
  const text = await loadPromptTemplate("board_chat2edit_user.txt");
  if (text) return text;
  return [
    "User id:",
    "{userId}",
    "Conversation history:",
    "{history}",
    "User instruction:",
    "{message}",
    "Web research (may be empty):",
    "{web}",
    "Current documents (JSON):",
    "{docs}",
  ].join(" ");
}

function isXhsRequest(args: { message: string; docType?: string | null; docTitle?: string; docContent?: string }) {
  const raw = [args.message, args.docTitle, args.docContent, args.docType].filter(Boolean).join(" ");
  if (/小红书/.test(raw)) return true;
  const lower = raw.toLowerCase();
  return lower.includes("xiaohongshu") || /\bxhs\b/.test(lower);
}

function wantsImageForMessage(message: string) {
  const raw = (message ?? "").toString().trim();
  if (!raw) return false;
  if (/不需要图|不要图|不用图|不想要图|不要图片|不需要图片/.test(raw)) return false;
  if (/配图|图片|图像|插图|画一|画个|配个图|生成图|生成图片|生成一张|封面图|配张|画张/.test(raw)) return true;
  const lower = raw.toLowerCase();
  return /image|illustration|draw|drawing|cover|thumbnail/.test(lower);
}

function isPostDocType(type: string | null | undefined) {
  return (type ?? "").toString().toLowerCase().includes("post");
}

function normalizeTitleKey(value: string | null | undefined) {
  return (value ?? "").toString().trim().toLowerCase();
}

function applyImageToPostContent(content: string, url: string) {
  let base: {
    text?: string;
    platform?: string | null;
    account?: string | null;
    media?: Array<{ id?: string; kind?: string; url?: string; duration_sec?: number | null }>;
    postType?: string;
  } = {};
  try {
    const parsed = JSON.parse((content ?? "").toString()) as typeof base;
    if (parsed && typeof parsed === "object") base = parsed;
  } catch {
    base = { text: (content ?? "").toString(), platform: null, account: null, media: [], postType: "纯文字" };
  }
  const media = Array.isArray(base.media) ? base.media.filter((m) => m && typeof m === "object") : [];
  const seen = new Set(
    media
      .map((m) => (typeof m?.url === "string" ? m.url.trim() : ""))
      .filter(Boolean)
  );
  if (!seen.has(url)) {
    media.push({ id: crypto.randomUUID(), kind: "image", url });
  }
  const next = { ...base, media, postType: "图文" };
  return JSON.stringify(next);
}

function sanitizeImageDisclaimers(message: string, reply: string): string {
  if (!wantsImageForMessage(message)) return reply;
  const raw = (reply ?? "").toString();
  if (!raw.trim()) return raw;
  const patterns: RegExp[] = [
    /我是一?个?文档编辑器[^。]*?(无法|不能)[^。]*?(绘制|画|生成)[^。]*(图像|图片)[^。]*。?/gi,
    /我是一?个?文本编辑器[^。]*?(无法|不能)[^。]*?(绘制|画|生成)[^。]*(图像|图片)[^。]*。?/gi,
    /作为一个?文档编辑器[^。]*?(无法|不能)[^。]*?(绘制|画|生成)[^。]*(图像|图片)[^。]*。?/gi,
    /作为一个?文本编辑器[^。]*?(无法|不能)[^。]*?(绘制|画|生成)[^。]*(图像|图片)[^。]*。?/gi,
    /我只能处理文本[^。]*?(无法|不能)[^。]*?(生成|创建)[^。]*(图像|图片)[^。]*。?/gi,
    /作为一个?文本模型[^。]*?(无法|不能)[^。]*?(绘制|画|生成)[^。]*(图像|图片)[^。]*。?/gi,
    /cannot\s+(draw|generate)\s+(images?|pictures?)[^.]*\.?/gi,
    /can(?:not|'t)\s+create\s+(images?|pictures?)[^.]*\.?/gi,
  ];
  let next = raw;
  for (const re of patterns) {
    next = next.replace(re, "");
  }
  next = next.replace(/\n{3,}/g, "\n\n").trim();
  return next;
}

async function fetchPollinationsImage(prompt: string, size: { w: number; h: number }, seed: number): Promise<{ bytes: Buffer; ext: string }> {
  const apiKey = (process.env.NEXT_PUBLIC_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY ?? "").toString().trim();
  const base = (process.env.NEXT_PUBLIC_OPENROUTER_BASE_URL ?? "").toString().trim() || "https://openrouter.ai/api/v1";
  let primaryError: unknown = null;

  if (apiKey) {
    try {
      const aspectRatio = size.w === size.h ? "1:1" : size.h > size.w ? "3:4" : "4:3";
      const body = {
        model: "google/gemini-3-pro-image-preview",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
        image_config: { aspect_ratio: aspectRatio },
      };
      const genCtrl = new AbortController();
      const genTimeout = setTimeout(() => genCtrl.abort(), 25_000);
      let data: {
        choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string | null } | null }> | null } | null }>;
      };
      try {
        const res = await fetch(`${base.replace(/\/+$/g, "")}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: genCtrl.signal,
        });
        if (!res.ok) {
          throw new Error(`Image generation failed (${res.status})`);
        }
        data = (await res.json()) as typeof data;
      } finally {
        clearTimeout(genTimeout);
      }
      const url =
        data.choices?.[0]?.message?.images?.[0]?.image_url?.url &&
        data.choices[0]!.message!.images![0]!.image_url!.url!.toString();
      if (!url) {
        throw new Error("No image returned from model");
      }
      if (url.startsWith("data:")) {
        const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(url);
        if (!match) throw new Error("Invalid data URL");
        const mime = match[1]!.toLowerCase();
        const b64 = match[2]!;
        const bytes = Buffer.from(b64, "base64");
        const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
        return { bytes, ext };
      }
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 25_000);
      try {
        const direct = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal });
        if (!direct.ok) throw new Error(`Image fetch failed (${direct.status})`);
        const ct = (direct.headers.get("content-type") ?? "").toLowerCase();
        const bytes = Buffer.from(await direct.arrayBuffer());
        const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
        return { bytes, ext };
      } finally {
        clearTimeout(timeout);
      }
    } catch (e) {
      primaryError = e;
      console.error("[image] openrouter image generation failed, falling back to pollinations.ai", e);
    }
  }

  const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${size.w}&height=${size.h}&seed=${seed}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(fallbackUrl, { method: "GET", redirect: "follow", signal: ctrl.signal });
    if (!res.ok) throw new Error(`Image fetch failed (${res.status})`);
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    const bytes = Buffer.from(await res.arrayBuffer());
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
    return { bytes, ext };
  } catch (e) {
    if (primaryError) {
      console.error("[image] pollinations.ai fallback also failed", { primaryError, fallbackError: e });
    }
    throw e instanceof Error ? e : new Error("Image fetch failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadToSupabaseStorage(args: {
  accessToken: string;
  bucket: string;
  key: string;
  contentType: string;
  bytes: Buffer;
}): Promise<string> {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").toString().trim();
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").toString().trim();
  if (!supabaseUrl || !supabaseAnonKey) throw new Error("Supabase not configured");

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const up = await withTimeout(
    supabase.storage.from(args.bucket).upload(args.key, args.bytes, {
      contentType: args.contentType,
      upsert: false,
    }),
    25_000,
    "Upload to Supabase Storage"
  );
  if (up.error) throw new Error(up.error.message);
  const pub = supabase.storage.from(args.bucket).getPublicUrl(args.key);
  const url = (pub.data?.publicUrl ?? "").toString().trim();
  if (!url) throw new Error("Failed to get public url");
  return url;
}

async function generateImagePrompt(args: {
  userId: string;
  message: string;
  docTitle: string;
  docContent: string;
  docType?: string | null;
  preferXhs?: boolean;
}) {
  const fallback = `${args.message}\n${args.docTitle}\n${args.docContent}`.trim();
  try {
    const model = await createChatModel("nanobanana");
    const useXhs = Boolean(args.preferXhs);
    let sys = [
      "You generate concise English prompts for image generation.",
      "Keep it under 30 words.",
      "Describe subject, style, lighting, composition, and mood.",
      "No text overlays, no watermarks, no logos.",
    ].join(" ");
    let user = [
      `Instruction: ${args.message}`,
      `Title: ${args.docTitle}`,
      `Content: ${args.docContent.slice(0, 600)}`,
    ]
      .filter(Boolean)
      .join("\n");
    if (useXhs) {
      const template =
        (await loadPromptTemplate("image_prompt.txt")) || (await loadPromptTemplate("image_prompt_short.txt"));
      if (template) {
        const pageContent = (args.docContent ?? "").toString().trim().slice(0, 600);
        const outline = (args.docContent ?? "").toString().trim().slice(0, 1200) || (args.docTitle ?? "").toString();
        user = fillPromptTemplate(template, {
          page_content: pageContent || (args.docTitle ?? "").toString() || (args.message ?? "").toString(),
          page_type: "封面",
          user_topic: (args.message ?? "").toString(),
          full_outline: outline || (args.message ?? "").toString(),
        });
        sys = [
          "Convert the following Xiaohongshu design brief into a concise English image prompt.",
          "Keep it under 40 words.",
          "Emphasize 3:4 vertical layout, clean typography, and cohesive styling.",
          "No text overlays, no watermarks, no logos.",
        ].join(" ");
      }
    }
    const res = await withTimeout(
      model.invoke([
        { role: "system", content: sys },
        { role: "user", content: user },
      ]),
      30_000,
      "Generate image prompt"
    );
    const text =
      typeof res === "string"
        ? res
        : typeof res === "object" && res !== null && "content" in res
          ? String((res as { content?: unknown }).content ?? "")
          : "";
    const trimmed = text.trim();
    if (trimmed) {
      return trimmed;
    }
  } catch {
    void 0;
  }
  return fallback.slice(0, 400);
}

async function attachImageToDocs(args: {
  message: string;
  updatedDocs: SkillResultDoc[];
  existingDocs: PersonaDocRow[];
  accessToken: string;
  userId: string;
}): Promise<{ updatedDocs: SkillResultDoc[]; note: string | null }> {
  if (!wantsImageForMessage(args.message)) return { updatedDocs: args.updatedDocs, note: null };

  const docsById = new Map(args.existingDocs.map((d) => [d.id, d]));
  const findDocByTitle = (t: string | null | undefined) => {
    const key = normalizeTitleKey(t);
    if (!key) return null;
    return args.existingDocs.find((d) => normalizeTitleKey(d.title) === key) ?? null;
  };

  const pickExisting = (u: SkillResultDoc) => {
    if (u.id) return docsById.get(u.id) ?? null;
    if (!u.id && args.existingDocs.length === 1) return args.existingDocs[0] ?? null;
    if (!u.id) return findDocByTitle(u.title) ?? null;
    return null;
  };

  let targetIndex = -1;
  if (args.updatedDocs.length > 0) {
    for (let i = 0; i < args.updatedDocs.length; i++) {
      const u = args.updatedDocs[i]!;
      const existing = pickExisting(u);
      const type = u.type ?? existing?.type ?? null;
      if (isPostDocType(type)) {
        targetIndex = i;
        break;
      }
    }
  }

  const target = targetIndex >= 0 ? args.updatedDocs[targetIndex]! : args.updatedDocs[0] ?? null;
  const existing = target ? pickExisting(target) : null;
  const resolvedType = target ? target.type ?? existing?.type ?? null : null;
  const title = target?.title ?? existing?.title ?? "";
  const content = target?.content || existing?.content || "";
  const shouldAttachToPost = targetIndex >= 0 && isPostDocType(resolvedType);

  let prompt = "";
  try {
    prompt = await generateImagePrompt({
      userId: args.userId,
      message: args.message,
      docTitle: (title ?? "").toString().trim(),
      docContent: (content ?? "").toString().trim(),
      docType: resolvedType,
      preferXhs: shouldAttachToPost && isXhsRequest({ message: args.message, docType: resolvedType, docTitle: title, docContent: content }),
    });
  } catch {
    prompt = (args.message ?? "").toString().trim();
  }
  if (!prompt) return { updatedDocs: args.updatedDocs, note: null };

  const size = shouldAttachToPost ? { w: 1080, h: 1440 } : { w: 1024, h: 1024 };
  const seed = Math.floor(Math.random() * 100000);

  try {
    const img = await fetchPollinationsImage(prompt, size, seed);
    const ext = img.ext || "jpg";
    const key = `${args.userId}/generated/${target?.id ?? "new"}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const primaryBucket = "persona-media";
    const fallbackBucket = "chat-attachments";
    let url = "";
    try {
      url = await uploadToSupabaseStorage({
        accessToken: args.accessToken,
        bucket: primaryBucket,
        key,
        contentType: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg",
        bytes: img.bytes,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      if (!/bucket/i.test(msg) && !/not found/i.test(msg)) throw e instanceof Error ? e : new Error(msg);
      url = await uploadToSupabaseStorage({
        accessToken: args.accessToken,
        bucket: fallbackBucket,
        key,
        contentType: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg",
        bytes: img.bytes,
      });
    }

    if (shouldAttachToPost && targetIndex >= 0) {
      const nextDocs = args.updatedDocs.map((d, idx) => {
        if (idx !== targetIndex) return d;
        const nextContent = applyImageToPostContent(d.content || content, url);
        return { ...d, content: nextContent };
      });
      const note = isChineseText(args.message) ? "已将配图写入文档。" : "Added the image to the document.";
      return { updatedDocs: nextDocs, note };
    }
    const mediaHtml = `<p><img src="${url}" /></p>`;
    const mediaDoc: SkillResultDoc = {
      id: null,
      title: isChineseText(args.message) ? "生成图片" : "Generated Image",
      content: mediaHtml,
      type: `photos;folder=0;parent=`,
    };
    const nextDocs = [...args.updatedDocs, mediaDoc];
    const note = `![Image](${url})`;
    return { updatedDocs: nextDocs, note };
  } catch {
    const note = shouldAttachToPost
      ? isChineseText(args.message)
        ? "配图生成失败，已保留文本内容。"
        : "Image generation failed; text content was preserved."
      : isChineseText(args.message)
        ? "图片生成失败，请稍后重试。"
        : "Image generation failed. Please try again.";
    return { updatedDocs: args.updatedDocs, note };
  }
}

function safeBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (!v) return false;
    if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  }
  return false;
}

function extractUrls(text: string): string[] {
  const raw = (text ?? "").toString();
  if (!raw) return [];
  const out: string[] = [];
  const re = /https?:\/\/[^\s<>"'()]+/g;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(raw))) {
    const url = (m[0] ?? "").trim();
    if (url) out.push(url);
  }
  return Array.from(new Set(out));
}

function pickWebSearchQuery(args: { message: string; history: ChatMessage[]; docs: PersonaDocRow[] }) {
  const message = (args.message ?? "").toString().trim();
  const messageUrls = extractUrls(message);
  if (messageUrls.length > 0) return messageUrls[0]!;

  const quoted =
    message.match(/[《“"']([^》”"']{4,80})[》”"']/)?.[1]?.toString().trim() ??
    message.match(/(?:标题|文章|来源)[:：]\s*([^\n]{4,80})/)?.[1]?.toString().trim() ??
    "";
  if (quoted) return quoted;

  for (let i = args.history.length - 1; i >= 0; i--) {
    const h = args.history[i];
    if (!h) continue;
    const urls = extractUrls(h.content);
    if (urls.length > 0) return urls[0]!;
  }

  const title = args.docs.find((d) => typeof d.title === "string" && d.title.trim().length > 0)?.title?.trim() ?? "";
  if (title) return title;

  return message;
}

function sseEncode(event: string, data: string) {
  const safeEvent = event.replace(/[^\w-]/g, "");
  const payload = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const dataLines = payload.split("\n").map((line) => `data: ${line}`);
  return `event: ${safeEvent}\n${dataLines.join("\n")}\n\n`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function extractChunkText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (!chunk || typeof chunk !== "object") return "";
  const c = chunk as { content?: unknown };
  const content = c.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((it) => {
        if (typeof it === "string") return it;
        if (it && typeof it === "object" && "text" in it) return String((it as { text?: unknown }).text ?? "");
        return "";
      })
      .join("");
  }
  return "";
}

function safeArrayOfChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      if (!v || typeof v !== "object") return null;
      const obj = v as { role?: unknown; content?: unknown };
      const role = obj.role === "user" || obj.role === "assistant" ? obj.role : null;
      const content = typeof obj.content === "string" ? obj.content : null;
      if (!role || content === null) return null;
      return { role, content };
    })
    .filter((m): m is ChatMessage => m !== null);
}

function safeArrayOfIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && v.trim().length > 0) out.push(v.trim());
  }
  return Array.from(new Set(out));
}

function serializeDocsForPrompt(docs: PersonaDocRow[]): { id: string; title: string | null; type: string | null; content: string }[] {
  return docs.map((d) => {
    const raw = (d.content ?? "").toString();
    const maxLen = 12000;
    const headLen = 6000;
    const tailLen = 6000;
    const content =
      raw.length > maxLen
        ? `${raw.slice(0, headLen)}\n...\n${raw.slice(Math.max(0, raw.length - tailLen))}`
        : raw;
    return {
      id: d.id,
      title: d.title ?? null,
      type: d.type ?? null,
      content,
    };
  });
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

const chat2EditSkill: Skill = {
  id: "chat2edit",
  name: "Chat 2 Edit",
  description: "Edits attached persona docs based on chat instructions",
  async run({ model, input, context }) {
    const docsPayload = serializeDocsForPrompt(input.docs);
    const web = (input.web ?? "").toString();
    const systemTemplate = await loadChat2EditSystemPrompt(context.chatMode);
    const userTemplate = await loadChat2EditUserPrompt();
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", systemTemplate],
      ["user", userTemplate],
    ]);
    const chain = prompt.pipe(model);

    const values = {
      userId: context.userId,
      history: JSON.stringify(input.history),
      message: input.message,
      web,
      docs: JSON.stringify(docsPayload),
    };

    const rawMessage = await chain.invoke(values);
    const raw =
      typeof rawMessage === "string"
        ? rawMessage
        : typeof rawMessage === "object" && rawMessage !== null && "content" in rawMessage
          ? String((rawMessage as { content?: unknown }).content ?? "")
          : "";

    try {
      const billingSystemText = fillPromptTemplate(systemTemplate, {
        userId: values.userId,
        history: values.history,
        message: values.message,
        web: values.web,
        docs: values.docs,
      });
      const billingUserText = fillPromptTemplate(userTemplate, {
        userId: values.userId,
        history: values.history,
        message: values.message,
        web: values.web,
        docs: values.docs,
      });
      await chargeCredits({
        userId: context.userId,
        modelKey: context.modelId,
        taskId: context.taskId,
        title: `Chat usage · chat2edit · ${context.modelId || "default"}`,
        inputText: `${billingSystemText}\n${billingUserText}`,
        outputText: raw,
      });
    } catch {
      void 0;
    }

    const delimiter = "\n---JSON---\n";
    const delimIndex = raw.indexOf(delimiter);
    const replyText = delimIndex >= 0 ? raw.slice(0, delimIndex).trim() : "";
    const jsonText = delimIndex >= 0 ? raw.slice(delimIndex + delimiter.length) : raw;

    const parsed = extractJson(jsonText);
    if (!parsed || typeof parsed !== "object") {
      const reply = sanitizeImageDisclaimers(input.message, raw.toString().trim());
      return { reply, updatedDocs: [] };
    }
    const obj = parsed as { reply?: unknown; documents?: unknown; updatedDocs?: unknown };
    const replyRaw = typeof obj.reply === "string" ? obj.reply : raw.toString();
    const docsRaw = Array.isArray(obj.documents) ? obj.documents : Array.isArray(obj.updatedDocs) ? obj.updatedDocs : [];
    const updatedDocs: SkillResultDoc[] = [];
    for (const item of docsRaw) {
      if (!item || typeof item !== "object") continue;
      const it = item as { id?: unknown; title?: unknown; content?: unknown; type?: unknown };
      const idRaw = typeof it.id === "string" ? it.id.trim() : "";
      const title = it.title === null || typeof it.title === "string" ? (it.title as string | null) : null;
      const content = typeof it.content === "string" ? it.content : "";
      const type = it.type === null || typeof it.type === "string" ? (it.type as string | null) : null;
      updatedDocs.push({ id: idRaw.length > 0 ? idRaw : null, title, content, type });
    }
    const baseReply = replyText || replyRaw.toString().trim() || raw.toString().trim();
    const safeReply = sanitizeImageDisclaimers(input.message, baseReply);
    return { reply: safeReply, updatedDocs };
  },
};

const SKILLS: Record<string, Skill> = {
  [chat2EditSkill.id]: chat2EditSkill,
};

function pickSkill(skillId: string | null | undefined): Skill {
  if (skillId && SKILLS[skillId]) return SKILLS[skillId];
  return chat2EditSkill;
}

export async function POST(req: Request): Promise<Response> {
  const auth = await getUserFromRequest(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawRequestId = req.headers.get("x-request-id");
  const requestIdCandidate = (rawRequestId ?? "").toString().trim();
  const requestId = requestIdCandidate && isUuid(requestIdCandidate) ? requestIdCandidate : crypto.randomUUID();
  const taskId = requestId;
  const appendRequestId = (msg: string) => {
    const base = (msg ?? "").toString().trim() || "Unknown error";
    return `${base} (Request ID: ${requestId})`;
  };

  let body: Chat2EditRequestBody | null = null;
  try {
    body = (await req.json()) as Chat2EditRequestBody;
  } catch {
    body = null;
  }

  const message = typeof body?.message === "string" ? body?.message.trim() : "";
  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const history = safeArrayOfChatMessages(body?.history);
  const attachedIds = safeArrayOfIds(body?.attachedResourceIds);
  const modelId = typeof body?.modelId === "string" ? body?.modelId : null;
  const skillId = typeof body?.skillId === "string" ? body?.skillId : null;
  const defaultPersonaId = typeof body?.defaultPersonaId === "string" ? body?.defaultPersonaId : null;
  const streamRequested = safeBoolean(body?.stream);
  const chatMode = normalizeChatMode(body?.mode);
  console.info("[chat2edit] task_started", {
    taskId,
    requestId,
    userId: auth.user.id,
    modelId,
    skillId,
    streamRequested,
    attachedCount: attachedIds.length,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return Response.json({ error: "Supabase not configured" }, { status: 500 });
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

  if (streamRequested && (skillId === "chat2edit" || !skillId)) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, payload: unknown) => {
          const data = typeof payload === "string" ? payload : JSON.stringify(payload);
          controller.enqueue(encoder.encode(sseEncode(event, data)));
        };

        (async () => {
          let creditsUsed = 0;
          let closed = false;
          const safeClose = () => {
            if (closed) return;
            closed = true;
            try {
              controller.close();
            } catch {
              void 0;
            }
          };
          const keepAliveTimer = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(":\n\n"));
            } catch {
              void 0;
            }
          }, 15000);

          try {
            send("status", { label: "Loading documents" });

            let docs: PersonaDocRow[] = [];
            if (attachedIds.length > 0) {
              const { data, error } = await supabase
                .from("persona_docs")
                .select("id,persona_id,title,content,type,updated_at")
                .in("id", attachedIds);
              if (error) {
                const msg = appendRequestId(error.message);
                console.error("[chat2edit] load_docs_error", { requestId, message: error.message });
                send("error", { error: msg });
                return;
              }
              docs = (data ?? []) as PersonaDocRow[];
            }

            const ragEnabled = (process.env.RAG_ENABLED ?? "1").toString().trim() !== "0";
            const ragEmbeddings = ragEnabled ? pickRagEmbeddingsConfig() : null;
            if (ragEnabled && ragEmbeddings) {
              send("status", { label: "Retrieving context" });
              try {
                const personaIds = await getUserPersonaIds(auth.user.id);
                await ensureUserIndexUpToDate({ supabase, userId: auth.user.id, personaIds, embeddings: ragEmbeddings });
                const retrieved = await retrieveRelevantDocs({
                  supabase,
                  personaIds,
                  query: message,
                  embeddings: ragEmbeddings,
                  maxDocs: attachedIds.length > 0 ? 4 : 6,
                });
                const existing = new Set(docs.map((d) => d.id));
                for (const d of retrieved) {
                  if (existing.has(d.id)) continue;
                  docs.push(d);
                  existing.add(d.id);
                }
              } catch {
                void 0;
              }
            }

            const webSearchEnabled = (process.env.ENABLE_WEB_SEARCH ?? "1").toString().trim() !== "0";
            let webResults: WebSearchResult[] = [];
            let web = "";
            let webSearchError: string | null = null;
            const webQuery = pickWebSearchQuery({ message, history, docs });
            if (webSearchEnabled) {
              send("status", { label: "Web search started" });
              try {
                webResults = await runWebSearch(webQuery, 3);
                web = formatWebSearchForPrompt(webResults);
              } catch (e) {
                const err = e instanceof Error ? e : null;
                const webTaskId = crypto.randomUUID();
                console.error("[web search] failed", {
                  taskId: webTaskId,
                  query: webQuery,
                  provider: (process.env.WEB_SEARCH_PROVIDER ?? "").toString().trim() || "auto",
                  name: err?.name ?? "unknown",
                  message: err?.message ?? e,
                  stack: err?.stack,
                });
                webSearchError = webTaskId;
                webResults = [];
                web = "";
              }
              if (webSearchError) {
                send("status", { label: `Web search error: ${webSearchError}` });
              } else {
                const count = webResults.length;
                send("status", { label: count > 0 ? `Web search: ${count} results` : "Web search: 0 results" });
                const topResults = webResults.slice(0, 3);
                for (let i = 0; i < topResults.length; i++) {
                  const r = topResults[i];
                  if (!r?.title && !r?.url) continue;
                  const prefix = i === 0 ? "Top source" : `Source ${i + 1}`;
                  const title = r.title || "Untitled";
                  send("status", { label: `${prefix}: ${title}` });
                }
              }
            } else {
              send("status", { label: "Web search disabled" });
            }

            send("status", { label: "Calling model" });

          let model: ChatOpenAI;
          try {
            model = await createChatModel(modelId, { streaming: true });
          } catch (e) {
            const err = e instanceof Error ? e : null;
            const msg = appendRequestId(err?.message ?? "Failed to create model");
            console.error("[chat2edit] create_model_error", {
              requestId,
              name: err?.name ?? "unknown",
              message: err?.message ?? e,
            });
            send("error", { error: msg });
            return;
          }

          const docsPayload = serializeDocsForPrompt(docs);
          const systemText = await loadChat2EditSystemPrompt(chatMode);
          const userTemplate = await loadChat2EditUserPrompt();
          const prompt = ChatPromptTemplate.fromMessages([
            ["system", systemText],
            ["user", userTemplate],
          ]);
          const chain = prompt.pipe(model);

          const values = {
            userId: auth.user.id,
            history: JSON.stringify(history),
            message,
            web,
            docs: JSON.stringify(docsPayload),
          };

          let raw = "";
          try {
            const streamFn = (chain as unknown as { stream?: (v: unknown) => unknown }).stream;
            const canStream = typeof streamFn === "function";
            let streamed = false;
            if (canStream) {
              try {
                const iterable = streamFn.call(chain, values) as unknown;
                const isAsyncIterable =
                  iterable &&
                  (typeof iterable === "object" || typeof iterable === "function") &&
                  Symbol.asyncIterator in (iterable as object);
                const isIterable =
                  iterable &&
                  (typeof iterable === "object" || typeof iterable === "function") &&
                  Symbol.iterator in (iterable as object);

                if (isAsyncIterable) {
                  for await (const chunk of iterable as AsyncIterable<unknown>) {
                    const delta = extractChunkText(chunk);
                    if (!delta) continue;
                    raw += delta;
                    send("delta", delta);
                  }
                  streamed = true;
                } else if (isIterable) {
                  for (const chunk of iterable as Iterable<unknown>) {
                    const delta = extractChunkText(chunk);
                    if (!delta) continue;
                    raw += delta;
                    send("delta", delta);
                  }
                  streamed = true;
                }
              } catch {
                streamed = false;
              }
            }

            if (!streamed) {
              const rawMessage = await chain.invoke(values);
              const text =
                typeof rawMessage === "string"
                  ? rawMessage
                  : typeof rawMessage === "object" && rawMessage !== null && "content" in rawMessage
                    ? String((rawMessage as { content?: unknown }).content ?? "")
                    : "";
              raw = text;
              if (text) send("delta", text);
            }
          } catch (e) {
            const err = e instanceof Error ? e : null;
            const msg = appendRequestId(err?.message ?? "Streaming failed");
            console.error("[chat2edit] streaming_error", {
              requestId,
              name: err?.name ?? "unknown",
              message: err?.message ?? e,
            });
            send("error", { error: msg });
            return;
          }

          send("status", { label: "Drafting changes" });

          try {
            const billingSystemText = fillPromptTemplate(systemText, {
              userId: values.userId,
              history: values.history,
              message: values.message,
              web: values.web,
              docs: values.docs,
            });
            const billingUserText = fillPromptTemplate(userTemplate, {
              userId: values.userId,
              history: values.history,
              message: values.message,
              web: values.web,
              docs: values.docs,
            });
            const billed = await chargeCredits({
              userId: auth.user.id,
              modelKey: modelId,
              taskId,
              title: `Chat usage · chat2edit · ${modelId || "default"}`,
              inputText: `${billingSystemText}\n${billingUserText}`,
              outputText: raw,
            });
            creditsUsed = billed.creditsUsed;
          } catch {
            void 0;
          }

          const delimiter = "\n---JSON---\n";
          const delimIndex = raw.indexOf(delimiter);
          const replyText = delimIndex >= 0 ? raw.slice(0, delimIndex).trim() : "";
          const jsonText = delimIndex >= 0 ? raw.slice(delimIndex + delimiter.length) : raw;
          const parsed = extractJson(jsonText);
          const parsedObj = parsed && typeof parsed === "object" ? (parsed as { documents?: unknown; reply?: unknown }) : null;
          const docsRaw = Array.isArray(parsedObj?.documents) ? parsedObj!.documents : [];
          const updatedDocs: SkillResultDoc[] = [];
          for (const item of docsRaw) {
            if (!item || typeof item !== "object") continue;
            const it = item as { id?: unknown; title?: unknown; content?: unknown; type?: unknown };
            const idRaw = typeof it.id === "string" ? it.id.trim() : "";
            const title = it.title === null || typeof it.title === "string" ? (it.title as string | null) : null;
            const content = typeof it.content === "string" ? it.content : "";
            const type = it.type === null || typeof it.type === "string" ? (it.type as string | null) : null;
            updatedDocs.push({ id: idRaw.length > 0 ? idRaw : null, title, content, type });
          }
          const baseReply =
            replyText ||
            (typeof parsedObj?.reply === "string" ? parsedObj.reply.toString().trim() : "") ||
            raw.toString().trim();
          const imageAttach = await withTimeout(
            attachImageToDocs({
              message,
              updatedDocs,
              existingDocs: docs,
              accessToken: auth.accessToken,
              userId: auth.user.id,
            }),
            60_000,
            "Attach image"
          );
          const finalReply = imageAttach.note ? (baseReply ? `${baseReply}\n\n${imageAttach.note}` : imageAttach.note) : baseReply;
          const safeReply = sanitizeImageDisclaimers(message, finalReply);
          const result: SkillResult = { reply: safeReply, updatedDocs: imageAttach.updatedDocs };

          const docsById = new Map(docs.map((d) => [d.id, d]));
          const normalizeTitle = (t: string | null | undefined) => (t ?? "").toString().trim().toLowerCase();
          const findDocByTitle = (t: string | null | undefined) => {
            const key = normalizeTitle(t);
            if (!key) return null;
            return docs.find((d) => normalizeTitle(d.title) === key) ?? null;
          };
          const updates: PersonaDocRow[] = [];
          const inserts: PersonaDocRow[] = [];
          const nowIso = new Date().toISOString();
          for (const u of result.updatedDocs) {
            let existing = u.id ? docsById.get(u.id) ?? null : null;
            if (!existing && !u.id && docs.length === 1) {
              existing = docs[0] ?? null;
            }
            if (!existing) {
              existing = findDocByTitle(u.title) ?? null;
            }
            if (existing) {
              updates.push({
                id: existing.id,
                persona_id: existing.persona_id,
                title: u.title ?? existing.title,
                content: u.content,
                type: u.type ?? existing.type,
                updated_at: nowIso,
              });
              continue;
            }
            if (!docs.length) {
              const cleanId = crypto.randomUUID();
              if (!defaultPersonaId) {
                const dbId = `private-${auth.user.id}-${cleanId}`;
                inserts.push({
                  id: dbId,
                  persona_id: null,
                  title: u.title ?? "Untitled",
                  content: u.content,
                  type: u.type ?? "persona",
                  updated_at: nowIso,
                });
              } else {
                const dbId = makePersonaDocDbId(defaultPersonaId, cleanId);
                inserts.push({
                  id: dbId,
                  persona_id: defaultPersonaId,
                  title: u.title ?? "Untitled",
                  content: u.content,
                  type: u.type ?? "persona",
                  updated_at: nowIso,
                });
              }
              continue;
            }
            const base = docs[0];
            const cleanId = crypto.randomUUID();
            if (!base.persona_id) {
              const dbId = `private-${auth.user.id}-${cleanId}`;
              inserts.push({
                id: dbId,
                persona_id: null,
                title: u.title ?? "Untitled",
                content: u.content,
                type: u.type ?? base.type ?? "persona",
                updated_at: nowIso,
              });
            } else {
              const dbId = makePersonaDocDbId(base.persona_id, cleanId);
              inserts.push({
                id: dbId,
                persona_id: base.persona_id,
                title: u.title ?? "Untitled",
                content: u.content,
                type: u.type ?? base.type,
                updated_at: nowIso,
              });
            }
          }

          const draftUpserts = [...updates, ...inserts];
          if (draftUpserts.length > 0) {
            const draftChanges: Chat2EditChange[] = [];
            for (const after of draftUpserts) {
              const before = docsById.get(after.id) ?? null;
              draftChanges.push({
                id: after.id,
                persona_id: after.persona_id ?? null,
                title_before: before?.title ?? null,
                title_after: after.title ?? null,
                content_before: before?.content ?? null,
                content_after: after.content ?? null,
                type_before: before?.type ?? null,
                type_after: after.type ?? null,
              });
            }
            send("docs", {
              stage: "draft",
              updated_docs: draftUpserts.map((d) => ({
                id: d.id,
                title: d.title,
                content: d.content,
                type: d.type,
                updated_at: d.updated_at,
                persona_id: d.persona_id,
              })),
              changes: draftChanges,
              task_id: taskId,
            });
          }

          let persisted: PersonaDocRow[] = [];
          if (draftUpserts.length > 0) {
            send("status", { label: "Saving documents" });
            const { data, error } = await withTimeout(
              (async () => await supabase.from("persona_docs").upsert(draftUpserts).select("id,persona_id,title,content,type,updated_at"))(),
              25_000,
              "Upsert documents"
            );
            if (error) {
              const msg = appendRequestId(error.message);
              console.error("[chat2edit] save_docs_error", { requestId, message: error.message });
              send("error", { error: msg });
              return;
            }
            persisted = (data ?? []) as PersonaDocRow[];
          }

          if (ragEnabled && ragEmbeddings) {
            try {
              await withTimeout(
                indexPersonaDocs({ supabase, userId: auth.user.id, docs: persisted, embeddings: ragEmbeddings }),
                30_000,
                "Index documents"
              );
            } catch {
              void 0;
            }
          }

          const changes: Chat2EditChange[] = [];
          for (const after of persisted) {
            const before = docsById.get(after.id) ?? null;
            changes.push({
              id: after.id,
              persona_id: after.persona_id ?? null,
              title_before: before?.title ?? null,
              title_after: after.title ?? null,
              content_before: before?.content ?? null,
              content_after: after.content ?? null,
              type_before: before?.type ?? null,
              type_after: after.type ?? null,
            });
          }

          let replyForClient = result.reply;
          if (chatMode === "create") {
            const inferred = inferCronFromMessage(message);
            const origin = getPublicOrigin(req);
            if (inferred && origin) {
              const timezone = await inferTimezoneFromRequest(req, inferred.timezoneHint);
              const { kind, target } = inferAutomationKind(message);
              const confirmTimeoutSeconds = 10;
              const confirmAt = new Date(Date.now() + confirmTimeoutSeconds * 1000).toISOString();
              const taskPlan =
                kind === "ai_news_briefing"
                  ? [
                      { title: "检索AI新闻源", status: "pending" as const },
                      { title: "生成要点摘要", status: "pending" as const },
                      { title: "保存到资源库", status: "pending" as const },
                    ]
                  : kind === "competitor_monitor"
                    ? [
                        { title: "解析监控目标", status: "pending" as const },
                        { title: "拉取最新信息", status: "pending" as const },
                        { title: "生成摘要报告", status: "pending" as const },
                        { title: "保存到资源库", status: "pending" as const },
                      ]
                    : [{ title: "执行自动化任务", status: "pending" as const }];

              const automationName =
                kind === "ai_news_briefing"
                  ? "AI新闻早报"
                  : kind === "competitor_monitor"
                    ? `竞品监控：${target}`
                    : `自动化任务：${(message ?? "").toString().slice(0, 24)}`;

              const internal: Record<string, unknown> =
                kind === "ai_news_briefing"
                  ? { kind, topic: target, source: "board", model_key: modelId || null }
                  : kind === "competitor_monitor"
                    ? { kind, target, source: "board", model_key: modelId || null }
                    : { kind, target, source: "board", model_key: modelId || null };

              const id = await createAutomationFromBoard({
                userId: auth.user.id,
                origin,
                name: automationName,
                cron: inferred.cron,
                timezone: timezone || null,
                todos: taskPlan.map((t) => ({ text: t.title, done: false })),
                internal,
                enabled: false,
                previewConfig: { enabled: true, auto_confirm: true, confirm_timeout_seconds: confirmTimeoutSeconds },
              });

              const meta = {
                task_plan: taskPlan,
                automation: {
                  id,
                  name: automationName,
                  cron: inferred.cron,
                  enabled: false,
                  auto_confirm: true,
                  confirm_timeout_seconds: confirmTimeoutSeconds,
                  confirm_at: confirmAt,
                },
              };

              const note = "\n\n我将于10秒后按以上配置创建并启用该自动化任务；如需取消或修改，请在倒计时结束前告知我。";
              if (!replyForClient.includes("10秒后")) replyForClient = `${replyForClient}${note}`;
              replyForClient = `${replyForClient}${BOARD_MESSAGE_META_DELIMITER}${JSON.stringify(meta)}`;
            }
          }

          const responsePayload: Chat2EditResponse = {
            reply: replyForClient,
            updated_docs: persisted.map((d) => ({
              id: d.id,
              title: d.title,
              content: d.content,
              type: d.type,
              updated_at: d.updated_at,
              persona_id: d.persona_id,
            })),
            changes,
            web_search_enabled: webSearchEnabled,
            web_search: webSearchEnabled ? { query: webQuery, results: webResults } : null,
            web_search_error: webSearchError,
            task_id: taskId,
            credits_used: creditsUsed,
          };

          send("final", responsePayload);
          console.info("[chat2edit] task_completed", { taskId, requestId, userId: auth.user.id, creditsUsed });
          return;
          } finally {
            clearInterval(keepAliveTimer);
            safeClose();
          }
        })().catch((e) => {
        const err = e instanceof Error ? e : null;
        const msg = appendRequestId(err?.message ?? "Streaming failed");
        console.error("[chat2edit] stream_final_error", {
          requestId,
          name: err?.name ?? "unknown",
          message: err?.message ?? e,
        });
        controller.enqueue(encoder.encode(sseEncode("error", JSON.stringify({ error: msg }))));
          try {
            controller.close();
          } catch {
            void 0;
          }
        });
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  let docs: PersonaDocRow[] = [];
  if (attachedIds.length > 0) {
    const { data, error } = await supabase
      .from("persona_docs")
      .select("id,persona_id,title,content,type,updated_at")
      .in("id", attachedIds);
    if (error) {
      const msg = appendRequestId(error.message);
      console.error("[chat2edit] load_docs_error", { requestId, message: error.message });
      return Response.json({ error: msg }, { status: 500 });
    }
    docs = (data ?? []) as PersonaDocRow[];
  }

  const ragEnabled = (process.env.RAG_ENABLED ?? "1").toString().trim() !== "0";
  const ragEmbeddings = ragEnabled ? pickRagEmbeddingsConfig() : null;
  let personaIds: string[] = [];
  if (ragEnabled && ragEmbeddings) {
    try {
      personaIds = await getUserPersonaIds(auth.user.id);
      await ensureUserIndexUpToDate({ supabase, userId: auth.user.id, personaIds, embeddings: ragEmbeddings });
      const retrieved = await retrieveRelevantDocs({
        supabase,
        personaIds,
        query: message,
        embeddings: ragEmbeddings,
        maxDocs: attachedIds.length > 0 ? 4 : 6,
      });
      const existing = new Set(docs.map((d) => d.id));
      for (const d of retrieved) {
        if (existing.has(d.id)) continue;
        docs.push(d);
        existing.add(d.id);
      }
    } catch {
      void 0;
    }
  }

  const webSearchEnabled = (process.env.ENABLE_WEB_SEARCH ?? "1").toString().trim() !== "0";
  let webResults: WebSearchResult[] = [];
  let web = "";
  let webSearchError: string | null = null;
  const webQuery = pickWebSearchQuery({ message, history, docs });
  if (webSearchEnabled) {
    try {
      webResults = await runWebSearch(webQuery, 3);
      web = formatWebSearchForPrompt(webResults);
    } catch (e) {
      const err = e instanceof Error ? e : null;
      const taskId = crypto.randomUUID();
      console.error("[web search] failed", {
        taskId,
        query: webQuery,
        provider: (process.env.WEB_SEARCH_PROVIDER ?? "").toString().trim() || "auto",
        name: err?.name ?? "unknown",
        message: err?.message ?? e,
        stack: err?.stack,
      });
      webSearchError = taskId;
      webResults = [];
      web = "";
    }
  }

  let model: ChatOpenAI;
  try {
    model = await createChatModel(modelId);
  } catch (e) {
    const err = e instanceof Error ? e : null;
    const msg = appendRequestId(err?.message ?? "Failed to create model");
    console.error("[chat2edit] create_model_error", {
      requestId,
      name: err?.name ?? "unknown",
      message: err?.message ?? e,
    });
    return Response.json({ error: msg }, { status: 500 });
  }

  const skill = pickSkill(skillId);

  let result: SkillResult;
  try {
    result = await skill.run({
      model,
      input: { message, history, docs, web },
      context: { userId: auth.user.id, modelId, taskId, chatMode },
    });
  } catch (e) {
    const err = e instanceof Error ? e : null;
    const msg = appendRequestId(err?.message ?? "Skill execution failed");
    console.error("[chat2edit] skill_error", {
      requestId,
      name: err?.name ?? "unknown",
      message: err?.message ?? e,
    });
    return Response.json({ error: msg }, { status: 500 });
  }

  const imageAttach = await attachImageToDocs({
    message,
    updatedDocs: result.updatedDocs,
    existingDocs: docs,
    accessToken: auth.accessToken,
    userId: auth.user.id,
  });
  const replyWithImageNote = imageAttach.note
    ? result.reply
      ? `${result.reply}\n\n${imageAttach.note}`
      : imageAttach.note
    : result.reply;
  const sanitizedReply = sanitizeImageDisclaimers(message, replyWithImageNote);
  const finalResult: SkillResult = { reply: sanitizedReply, updatedDocs: imageAttach.updatedDocs };

  let replyForClient = finalResult.reply;
  if (chatMode === "create") {
    const inferred = inferCronFromMessage(message);
    const origin = getPublicOrigin(req);
    if (inferred && origin) {
      const timezone = await inferTimezoneFromRequest(req, inferred.timezoneHint);
      const { kind, target } = inferAutomationKind(message);
      const confirmTimeoutSeconds = 10;
      const confirmAt = new Date(Date.now() + confirmTimeoutSeconds * 1000).toISOString();
      const taskPlan =
        kind === "ai_news_briefing"
          ? [
              { title: "检索AI新闻源", status: "pending" as const },
              { title: "生成要点摘要", status: "pending" as const },
              { title: "保存到资源库", status: "pending" as const },
            ]
          : kind === "competitor_monitor"
            ? [
                { title: "解析监控目标", status: "pending" as const },
                { title: "拉取最新信息", status: "pending" as const },
                { title: "生成摘要报告", status: "pending" as const },
                { title: "保存到资源库", status: "pending" as const },
              ]
            : [{ title: "执行自动化任务", status: "pending" as const }];

      const automationName =
        kind === "ai_news_briefing"
          ? "AI新闻早报"
          : kind === "competitor_monitor"
            ? `竞品监控：${target}`
            : `自动化任务：${(message ?? "").toString().slice(0, 24)}`;

      const internal: Record<string, unknown> =
        kind === "ai_news_briefing"
          ? { kind, topic: target, source: "board", model_key: modelId || null }
          : kind === "competitor_monitor"
            ? { kind, target, source: "board", model_key: modelId || null }
            : { kind, target, source: "board", model_key: modelId || null };

      const id = await createAutomationFromBoard({
        userId: auth.user.id,
        origin,
        name: automationName,
        cron: inferred.cron,
        timezone: timezone || null,
        todos: taskPlan.map((t) => ({ text: t.title, done: false })),
        internal,
        enabled: false,
        previewConfig: { enabled: true, auto_confirm: true, confirm_timeout_seconds: confirmTimeoutSeconds },
      });

      const meta = {
        task_plan: taskPlan,
        automation: {
          id,
          name: automationName,
          cron: inferred.cron,
          enabled: false,
          auto_confirm: true,
          confirm_timeout_seconds: confirmTimeoutSeconds,
          confirm_at: confirmAt,
        },
      };

      const note = "\n\n我将于10秒后按以上配置创建并启用该自动化任务；如需取消或修改，请在倒计时结束前告知我。";
      if (!replyForClient.includes("10秒后")) replyForClient = `${replyForClient}${note}`;
      replyForClient = `${replyForClient}${BOARD_MESSAGE_META_DELIMITER}${JSON.stringify(meta)}`;
    }
  }

  const docsById = new Map(docs.map((d) => [d.id, d]));
  const normalizeTitle = (t: string | null | undefined) => (t ?? "").toString().trim().toLowerCase();
  const findDocByTitle = (t: string | null | undefined) => {
    const key = normalizeTitle(t);
    if (!key) return null;
    return docs.find((d) => normalizeTitle(d.title) === key) ?? null;
  };
  const updates: PersonaDocRow[] = [];
  const inserts: PersonaDocRow[] = [];
  const nowIso = new Date().toISOString();
  for (const u of finalResult.updatedDocs) {
    let existing = u.id ? docsById.get(u.id) ?? null : null;
    if (!existing && !u.id && docs.length === 1) {
      existing = docs[0] ?? null;
    }
    if (!existing) {
      existing = findDocByTitle(u.title) ?? null;
    }
    if (existing) {
      updates.push({
        id: existing.id,
        persona_id: existing.persona_id,
        title: u.title ?? existing.title,
        content: u.content,
        type: u.type ?? existing.type,
        updated_at: nowIso,
      });
      continue;
    }
    if (!docs.length) {
      const cleanId = crypto.randomUUID();
      if (!defaultPersonaId) {
        const dbId = `private-${auth.user.id}-${cleanId}`;
        inserts.push({
          id: dbId,
          persona_id: null,
          title: u.title ?? "Untitled",
          content: u.content,
          type: u.type ?? "persona",
          updated_at: nowIso,
        });
      } else {
        const dbId = makePersonaDocDbId(defaultPersonaId, cleanId);
        inserts.push({
          id: dbId,
          persona_id: defaultPersonaId,
          title: u.title ?? "Untitled",
          content: u.content,
          type: u.type ?? "persona",
          updated_at: nowIso,
        });
      }
      continue;
    }
    const base = docs[0];
    const cleanId = crypto.randomUUID();
    if (!base.persona_id) {
      const dbId = `private-${auth.user.id}-${cleanId}`;
      inserts.push({
        id: dbId,
        persona_id: null,
        title: u.title ?? "Untitled",
        content: u.content,
        type: u.type ?? base.type ?? "persona",
        updated_at: nowIso,
      });
    } else {
      const dbId = makePersonaDocDbId(base.persona_id, cleanId);
      inserts.push({
        id: dbId,
        persona_id: base.persona_id,
        title: u.title ?? "Untitled",
        content: u.content,
        type: u.type ?? base.type,
        updated_at: nowIso,
      });
    }
  }

  let persisted: PersonaDocRow[] = [];
  const upserts = [...updates, ...inserts];
  if (upserts.length > 0) {
    const { data, error } = await supabase
      .from("persona_docs")
      .upsert(upserts)
      .select("id,persona_id,title,content,type,updated_at");
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    persisted = (data ?? []) as PersonaDocRow[];
  }

  if (ragEnabled && ragEmbeddings) {
    try {
      await indexPersonaDocs({ supabase, userId: auth.user.id, docs: persisted, embeddings: ragEmbeddings });
    } catch {
      void 0;
    }
  }

  const changes: Chat2EditChange[] = [];
  for (const after of persisted) {
    const before = docsById.get(after.id) ?? null;
    changes.push({
      id: after.id,
      persona_id: after.persona_id ?? null,
      title_before: before?.title ?? null,
      title_after: after.title ?? null,
      content_before: before?.content ?? null,
      content_after: after.content ?? null,
      type_before: before?.type ?? null,
      type_after: after.type ?? null,
    });
  }

  const responsePayload: Chat2EditResponse = {
    reply: replyForClient,
    updated_docs: persisted.map((d) => ({
      id: d.id,
      title: d.title,
      content: d.content,
      type: d.type,
      updated_at: d.updated_at,
      persona_id: d.persona_id,
    })),
    changes,
    web_search_enabled: webSearchEnabled,
    web_search: webSearchEnabled ? { query: webQuery, results: webResults } : null,
    web_search_error: webSearchError,
    task_id: taskId,
  };

  console.info("[chat2edit] task_completed", { taskId, userId: auth.user.id });
  return Response.json(responsePayload, { status: 200 });
}
