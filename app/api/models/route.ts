import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type ModelRow = {
  id: string;
  name: string | null;
  model_id: string;
  priority: number | null;
  enabled: boolean | null;
};

type ConfigRow = {
  id: string;
  model_id: string | null;
};

const DEFAULT_MODELS = [
  { id: "persona-ai", name: "PersonaAI", modelId: "google/gemini-3-pro-preview", priority: 1 },
  { id: "gpt-5.2", name: "GPT5.2", modelId: "openai/gpt-5.2", priority: 2 },
  { id: "gpt-oss", name: "GPT oss", modelId: "openai/gpt-oss-120b:free", priority: 3 },
  { id: "nanobanana", name: "Nanobanana", modelId: "google/gemini-3-pro-image-preview", priority: 4 },
  { id: "gemini-3.0-pro", name: "Gemini3.0pro", modelId: "google/gemini-3-pro-preview", priority: 5 },
  { id: "minimax-m2", name: "Minimax M2", modelId: "minimax/minimax-m2", priority: 6 },
  { id: "kimi-0905", name: "Kimi0905", modelId: "moonshotai/kimi-k2-0905", priority: 7 },
  { id: "claude-3.5-sonnet", name: "Claude3.5 Sonnet", modelId: "anthropic/claude-3.5-sonnet", priority: 8 },
];

const CONFIG_ROW_IDS = ["ask-default", "ask-default-cn", "oss-prompt-system", "oss-prompt-model", "oss-prompt-baseurl"] as const;

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

function getSupabaseServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").toString().trim();
  if (!supabaseUrl || !serviceKey) return null;

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function loadEnabledModelRows() {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("model_configs")
    .select("id,name,model_id,priority,enabled")
    .eq("enabled", true)
    .order("priority", { ascending: true });
  if (error) return null;
  return (data ?? []) as ModelRow[];
}

async function loadConfigRows() {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("model_configs").select("id,model_id").in("id", [...CONFIG_ROW_IDS]);
  if (error) return null;
  return (data ?? []) as ConfigRow[];
}

export async function GET(req: Request) {
  const rows = await loadEnabledModelRows();
  const dbModels = (rows ?? [])
    .filter((row) => row && typeof row.id === "string" && row.id.trim())
    .filter((row) => !CONFIG_ROW_IDS.includes(row.id as (typeof CONFIG_ROW_IDS)[number]))
    .filter((row) => row && typeof row.id === "string" && row.id.trim())
    .map((row, index) => ({
      id: row.id,
      name: (row.name ?? row.id).toString().trim() || row.id,
      modelId: row.model_id,
      priority: Number.isFinite(row.priority) ? Number(row.priority) : index + 1,
    }));

  const map = new Map<string, { id: string; name: string; modelId: string; priority: number }>();
  for (const d of DEFAULT_MODELS) {
    map.set(d.id, { id: d.id, name: d.name, modelId: d.modelId, priority: Number(d.priority) });
  }
  for (const m of dbModels) {
    map.set(m.id, { id: m.id, name: m.name, modelId: m.modelId, priority: Number(m.priority) });
  }
  const merged = Array.from(map.values()).sort((a, b) => a.priority - b.priority);

  const configRows = (await loadConfigRows()) ?? [];
  const configMap = new Map<string, string>();
  for (const row of configRows) {
    const id = (row?.id ?? "").toString().trim();
    const value = (row?.model_id ?? "").toString();
    if (id) configMap.set(id, value);
  }

  const allowedAskDefaults = new Set<string>([...DEFAULT_MODELS.map((m) => m.id), ...dbModels.map((m) => m.id)]);
  const askDefaultGlobalRaw = (configMap.get("ask-default") ?? "").trim();
  const askDefaultCnRaw = (configMap.get("ask-default-cn") ?? "").trim();
  const askDefaultGlobal = askDefaultGlobalRaw && allowedAskDefaults.has(askDefaultGlobalRaw) ? askDefaultGlobalRaw : "claude-3.5-sonnet";
  const askDefaultCn = askDefaultCnRaw && allowedAskDefaults.has(askDefaultCnRaw) ? askDefaultCnRaw : "kimi-0905";

  const headers = req.headers;
  const countryHeader =
    getHeader(headers, ["x-vercel-ip-country"]) ||
    getHeader(headers, ["cf-ipcountry"]) ||
    getHeader(headers, ["x-country-code"]);
  let country = countryHeader ? countryHeader.toUpperCase() : null;
  let source: "header" | "ipapi" | "unknown" = country ? "header" : "unknown";
  if (!country) {
    const ip = getClientIp(headers);
    const lookedUp = await lookupCountryByIp(ip);
    if (lookedUp) {
      country = lookedUp;
      source = "ipapi";
    }
  }
  const isMainlandChina = country === "CN";
  const askDefault = isMainlandChina ? askDefaultCn : askDefaultGlobal;

  const ossPromptSystem = (configMap.get("oss-prompt-system") ?? "").toString();
  const ossPromptModel = (configMap.get("oss-prompt-model") ?? "").toString().trim();
  const ossPromptBaseUrl = (configMap.get("oss-prompt-baseurl") ?? "").toString().trim();

  return Response.json(
    {
      models: merged,
      ask_default: askDefault,
      ask_default_global: askDefaultGlobal,
      ask_default_cn: askDefaultCn,
      geo: { country, isMainlandChina, source },
      oss_prompt: {
        system: ossPromptSystem,
        model: ossPromptModel,
        baseUrl: ossPromptBaseUrl,
      },
    },
    { status: 200 }
  );
}
