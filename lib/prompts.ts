import { createClient } from "@supabase/supabase-js";
import { readdir, readFile } from "fs/promises";
import path from "path";

const PROMPT_ROOT = path.join(process.cwd(), "prompts");
const PROMPT_ROOT_RESOLVED = path.resolve(PROMPT_ROOT);
const CACHE_TTL_MS = 2000;

type CacheEntry = { value: string; at: number };

const promptCache = new Map<string, CacheEntry>();

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

function resolvePromptPath(name: string) {
  const candidate = path.resolve(PROMPT_ROOT, name);
  if (!candidate.startsWith(`${PROMPT_ROOT_RESOLVED}${path.sep}`)) {
    throw new Error("invalid_prompt_name");
  }
  return candidate;
}

export function clearPromptCache(name?: string) {
  if (!name) {
    promptCache.clear();
    return;
  }
  promptCache.delete(name);
}

export function extractPromptVariables(template: string) {
  const out = new Set<string>();
  const re = /\{([a-zA-Z0-9_]+)\}/g;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(template))) {
    const key = (m[1] ?? "").toString().trim();
    if (key) out.add(key);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

export function fillPromptTemplate(template: string, vars: Record<string, string>) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return out;
}

export async function listPromptFiles(): Promise<string[]> {
  try {
    const items = await readdir(PROMPT_ROOT, { withFileTypes: true });
    return items
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .filter((name) => /^[a-zA-Z0-9._-]+$/.test(name));
  } catch {
    return [];
  }
}

async function loadPromptFromFile(name: string) {
  try {
    const filePath = resolvePromptPath(name);
    const text = await readFile(filePath, "utf8");
    return text.toString();
  } catch {
    return "";
  }
}

async function loadPromptFromCloud(name: string) {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return "";
  try {
    const { data, error } = await supabase.from("prompt_templates").select("content").eq("id", name).maybeSingle();
    if (error) return "";
    const content = (data as { content?: unknown } | null)?.content;
    return typeof content === "string" ? content.toString() : "";
  } catch {
    return "";
  }
}

export async function loadPromptTemplate(name: string) {
  const key = (name ?? "").toString().trim();
  if (!key) return "";
  const now = Date.now();
  const cached = promptCache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  const cloud = await loadPromptFromCloud(key);
  if (cloud) {
    promptCache.set(key, { value: cloud, at: now });
    return cloud;
  }

  const file = await loadPromptFromFile(key);
  promptCache.set(key, { value: file, at: now });
  return file;
}
