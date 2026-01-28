import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import { ensureUserIndexUpToDate, getUserPersonaIds, pickRagEmbeddingsConfig, retrieveRelevantDocs } from "@/lib/rag";

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
          const sys: ChatMessage = {
            role: "system",
            content: ["Relevant user documents are provided below.", "Use them when answering if helpful.", "", text]
              .filter(Boolean)
              .join("\n"),
          };
          const firstIsSystem = messages.length > 0 && messages[0]?.role === "system";
          augmented = firstIsSystem ? [messages[0]!, sys, ...messages.slice(1)] : [sys, ...messages];
        }
      }
    } catch {
      augmented = messages;
    }
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

      console.info("[chat/complete] task_completed", {
        taskId,
        requestId,
        userId: auth.user.id,
        creditsUsed,
        candidateId,
        chosenModelKey: cfg.id,
        chosenModelId: cfg.modelId,
      });

      if (data && typeof data === "object") {
        return Response.json({ ...(data as Record<string, unknown>), task_id: taskId, credits_used: creditsUsed }, { status: 200 });
      }
      return Response.json({ data, task_id: taskId, credits_used: creditsUsed }, { status: 200 });
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
