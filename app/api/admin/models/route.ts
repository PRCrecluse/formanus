import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import type { User } from "@supabase/supabase-js";

export const runtime = "nodejs";

type ModelRow = {
  id: string;
  name: string | null;
  model_id: string | null;
  api_key: string | null;
  priority: number | null;
  enabled: boolean | null;
};

type DefaultModelConfig = {
  id: string;
  name: string;
  modelId: string;
  keyName: string;
  priority: number;
};

const ADMIN_EMAIL = "1765591779@qq.com";
const ADMIN_PROVIDER = "apple";
const ADMIN_QUERY_PARAM_KEY = "panel";
const ADMIN_QUERY_PARAM_SECRET = (process.env.NEXT_PUBLIC_ADMIN_PANEL_KEY ?? "").toString().trim();
const ADMIN_QUERY_PARAM_REQUIRED = ADMIN_QUERY_PARAM_SECRET.length > 0;

function isAdminUser(user: User, req: Request) {
  const email = (user.email ?? "").toLowerCase().trim();
  const provider = (user.app_metadata?.provider ?? "").toString().toLowerCase().trim();
  if (email !== ADMIN_EMAIL.toLowerCase().trim()) return false;
  if (provider !== ADMIN_PROVIDER) return false;
  if (!ADMIN_QUERY_PARAM_REQUIRED) return true;
  const url = new URL(req.url);
  const queryValue = (url.searchParams.get(ADMIN_QUERY_PARAM_KEY) ?? "").toString().trim();
  return queryValue === ADMIN_QUERY_PARAM_SECRET;
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

const DEFAULT_MODEL_CONFIGS: DefaultModelConfig[] = [
  { id: "persona-ai", name: "PersonaAI", modelId: "google/gemini-3-pro-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY", priority: 1 },
  { id: "gpt-5.2", name: "GPT5.2", modelId: "openai/gpt-5.2", keyName: "NEXT_PUBLIC_GPT52_API_KEY", priority: 2 },
  { id: "nanobanana", name: "Nanobanana", modelId: "google/gemini-3-pro-image-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY", priority: 3 },
  { id: "gemini-3.0-pro", name: "Gemini3.0pro", modelId: "google/gemini-3-pro-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY", priority: 4 },
  { id: "minimax-m2", name: "Minimax M2", modelId: "minimax/minimax-m2", keyName: "NEXT_PUBLIC_MINIMAX_API_KEY", priority: 5 },
  { id: "kimi-0905", name: "Kimi0905", modelId: "moonshotai/kimi-k2-0905", keyName: "NEXT_PUBLIC_KIMI_API_KEY", priority: 6 },
  { id: "claude-3.5-sonnet", name: "Claude3.5 Sonnet", modelId: "anthropic/claude-3.5-sonnet", keyName: "NEXT_PUBLIC_CLAUDE_API_KEY", priority: 7 },
];

function resolveDefaultModels() {
  return DEFAULT_MODEL_CONFIGS.map((cfg) => {
    const directKey = (process.env[cfg.keyName] ?? "").toString().trim();
    const fallbackKey = (process.env.NEXT_PUBLIC_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY ?? "").toString().trim();
    const apiKey = directKey || fallbackKey;
    const hasApiKey = Boolean(apiKey);
    return {
      id: cfg.id,
      name: cfg.name,
      modelId: cfg.modelId,
      priority: cfg.priority,
      enabled: true,
      apiKeyLast4: hasApiKey ? apiKey.slice(-4) : "",
      hasApiKey,
    };
  }).filter((m) => m.hasApiKey);
}

export async function GET(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminUser(auth.user, req)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getSupabaseServiceClient();
  const defaultModels = resolveDefaultModels();
  if (!supabase) {
    return Response.json({ models: defaultModels }, { status: 200 });
  }

  const { data, error } = await supabase
    .from("model_configs")
    .select("id,name,model_id,api_key,priority,enabled")
    .order("priority", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as ModelRow[];
  const map = new Map<
    string,
    {
      id: string;
      name: string;
      modelId: string;
      priority: number;
      enabled: boolean;
      apiKeyLast4: string;
      hasApiKey: boolean;
    }
  >();

  for (const m of defaultModels) {
    map.set(m.id, {
      id: m.id,
      name: m.name,
      modelId: m.modelId,
      priority: m.priority,
      enabled: m.enabled,
      apiKeyLast4: m.apiKeyLast4,
      hasApiKey: m.hasApiKey,
    });
  }

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const apiKey = (row.api_key ?? "").toString();
    const modelIdRaw = (row.model_id ?? "").toString();
    const fixedModelId =
      row.id === "gpt-5.2" && /gpt-4o/i.test(modelIdRaw) ? "openai/gpt-5.2" : modelIdRaw;
    const existing = map.get(row.id);
    const priority = Number.isFinite(row.priority)
      ? Number(row.priority)
      : (typeof existing?.priority === "number" ? existing.priority : index + 1);
    const enabled = typeof row.enabled === "boolean" ? row.enabled : existing?.enabled ?? true;
    const name = (row.name ?? existing?.name ?? row.id).toString();
    const apiKeyLast4 = apiKey ? apiKey.slice(-4) : existing?.apiKeyLast4 ?? "";
    const hasApiKey = Boolean(apiKey) || Boolean(existing?.hasApiKey);

    map.set(row.id, {
      id: row.id,
      name,
      modelId: fixedModelId || existing?.modelId || "",
      priority,
      enabled,
      apiKeyLast4,
      hasApiKey,
    });
  }

  const models = Array.from(map.values()).sort((a, b) => a.priority - b.priority);
  return Response.json({ models }, { status: 200 });
}

export async function POST(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminUser(auth.user, req)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getSupabaseServiceClient();
  if (!supabase) return Response.json({ error: "Supabase not configured" }, { status: 500 });

  let body: Record<string, unknown> | null = null;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const modelId = typeof body?.modelId === "string" ? body.modelId.trim() : "";
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const enabledRaw = body?.enabled;
  const enabled = typeof enabledRaw === "boolean" ? enabledRaw : true;

  if (!id || !modelId || !apiKey) {
    return Response.json({ error: "id, modelId, apiKey are required" }, { status: 400 });
  }

  let priority = Number.isFinite(Number(body?.priority)) ? Number(body?.priority) : NaN;
  if (!Number.isFinite(priority) || priority <= 0) {
    const { data: maxRows } = await supabase.from("model_configs").select("priority").order("priority", { ascending: false }).limit(1);
    const maxPriority = Array.isArray(maxRows) && maxRows.length > 0 ? Number((maxRows[0] as { priority?: unknown })?.priority ?? 0) : 0;
    priority = maxPriority + 1;
  }

  const now = new Date().toISOString();
  const payload = {
    id,
    name: name || id,
    model_id: modelId,
    api_key: apiKey,
    priority: Math.floor(priority),
    enabled,
    updated_at: now,
  };

  const { error } = await supabase.from("model_configs").upsert(payload);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true }, { status: 200 });
}

export async function PUT(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminUser(auth.user, req)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getSupabaseServiceClient();
  if (!supabase) return Response.json({ error: "Supabase not configured" }, { status: 500 });

  let body: Record<string, unknown> | null = null;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  const modelsRaw = body?.models;
  if (!Array.isArray(modelsRaw)) {
    return Response.json({ error: "models is required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const payload = modelsRaw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const id = typeof obj.id === "string" ? obj.id.trim() : "";
      if (!id) return null;
      const name = typeof obj.name === "string" ? obj.name.trim() : "";
      const modelId = typeof obj.modelId === "string" ? obj.modelId.trim() : "";
      const enabled = typeof obj.enabled === "boolean" ? obj.enabled : true;
      const priorityRaw = Number.isFinite(Number(obj.priority)) ? Number(obj.priority) : index + 1;
      const apiKey = typeof obj.apiKey === "string" ? obj.apiKey.trim() : "";
      const base = {
        id,
        name: name || id,
        model_id: modelId,
        priority: Math.floor(priorityRaw),
        enabled,
        updated_at: now,
      } as Record<string, unknown>;
      if (apiKey) base.api_key = apiKey;
      return base;
    })
    .filter((v): v is Record<string, unknown> => Boolean(v));

  if (payload.length === 0) {
    return Response.json({ error: "models is empty" }, { status: 400 });
  }

  const { error } = await supabase.from("model_configs").upsert(payload);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true }, { status: 200 });
}
