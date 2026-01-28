import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import type { User } from "@supabase/supabase-js";
import { clearPromptCache, extractPromptVariables, loadPromptTemplate } from "@/lib/prompts";
import { readFile, writeFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const PROMPT_ROOT = path.join(process.cwd(), "prompts");
const PROMPT_ROOT_RESOLVED = path.resolve(PROMPT_ROOT);

const ADMIN_EMAIL = "1765591779@qq.com";
const ADMIN_PROVIDER = "apple";
const ADMIN_QUERY_PARAM_KEY = "panel";
const ADMIN_QUERY_PARAM_SECRET = (process.env.NEXT_PUBLIC_ADMIN_PANEL_KEY ?? "").toString().trim();
const ADMIN_QUERY_PARAM_REQUIRED = ADMIN_QUERY_PARAM_SECRET.length > 0;

const PROMPT_VARIABLE_RULES: Record<string, { required: string[]; allowed: string[] }> = {
  "board_chat2edit_user.txt": {
    required: ["userId", "history", "message", "web", "docs"],
    allowed: ["userId", "history", "message", "web", "docs"],
  },
  "xhs_batch_system.txt": {
    required: ["pages", "caption_language", "text_language"],
    allowed: ["pages", "caption_language", "text_language"],
  },
  "outline_prompt.txt": {
    required: ["topic"],
    allowed: ["topic"],
  },
  "content_prompt.txt": {
    required: ["topic", "outline"],
    allowed: ["topic", "outline"],
  },
  "image_prompt.txt": {
    required: ["page_type", "page_content", "user_topic", "full_outline"],
    allowed: ["page_type", "page_content", "user_topic", "full_outline"],
  },
  "image_prompt_short.txt": {
    required: ["page_type", "page_content"],
    allowed: ["page_type", "page_content"],
  },
};

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

function isSafePromptId(id: string) {
  return /^[a-zA-Z0-9._-]+$/.test(id);
}

function resolvePromptPath(name: string) {
  const candidate = path.resolve(PROMPT_ROOT, name);
  if (!candidate.startsWith(`${PROMPT_ROOT_RESOLVED}${path.sep}`)) {
    throw new Error("invalid_prompt_name");
  }
  return candidate;
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

async function readPromptFile(id: string) {
  try {
    const fp = resolvePromptPath(id);
    const text = await readFile(fp, "utf8");
    return text.toString();
  } catch {
    return "";
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getUserFromRequest(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminUser(auth.user, req)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const params = await ctx.params;
  const idRaw = (params?.id ?? "").toString().trim();
  const id = decodeURIComponent(idRaw);
  if (!id || !isSafePromptId(id)) return Response.json({ error: "Invalid prompt id" }, { status: 400 });

  const content = await loadPromptTemplate(id);
  const fileContent = await readPromptFile(id);
  return Response.json(
    {
      id,
      content,
      hasFile: Boolean(fileContent),
    },
    { status: 200 }
  );
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getUserFromRequest(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminUser(auth.user, req)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const params = await ctx.params;
  const idRaw = (params?.id ?? "").toString().trim();
  const id = decodeURIComponent(idRaw);
  if (!id || !isSafePromptId(id)) return Response.json({ error: "Invalid prompt id" }, { status: 400 });

  let body: Record<string, unknown> | null = null;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  const content = typeof body?.content === "string" ? body.content : "";
  const syncToCloud = body?.syncToCloud === false ? false : true;
  const writeToFile = body?.writeToFile === false ? false : true;

  const rules = PROMPT_VARIABLE_RULES[id];
  if (rules) {
    const vars = extractPromptVariables(content);
    const allowed = new Set(rules.allowed);
    const unknown = vars.filter((v) => !allowed.has(v));
    const missing = rules.required.filter((v) => !vars.includes(v));
    if (unknown.length > 0 || missing.length > 0) {
      return Response.json(
        { error: "Invalid template variables", unknown, missing, required: rules.required, allowed: rules.allowed },
        { status: 400 }
      );
    }
  }

  const result: { ok: boolean; cloud?: { ok: boolean; error?: string } | null; file?: { ok: boolean; error?: string } | null } = {
    ok: true,
    cloud: null,
    file: null,
  };

  if (syncToCloud) {
    const supabase = getSupabaseServiceClient();
    if (!supabase) {
      result.cloud = { ok: false, error: "Supabase not configured" };
    } else {
      try {
        const now = new Date().toISOString();
        const { error } = await supabase.from("prompt_templates").upsert({ id, content, updated_at: now });
        result.cloud = error ? { ok: false, error: error.message } : { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "cloud_write_failed";
        result.cloud = { ok: false, error: msg };
      }
    }
  }

  if (writeToFile) {
    try {
      const fp = resolvePromptPath(id);
      await writeFile(fp, content, "utf8");
      result.file = { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "file_write_failed";
      result.file = { ok: false, error: msg };
    }
  }

  clearPromptCache(id);
  return Response.json(result, { status: 200 });
}
