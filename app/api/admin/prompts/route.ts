import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import type { User } from "@supabase/supabase-js";
import { listPromptFiles } from "@/lib/prompts";

export const runtime = "nodejs";

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

export async function GET(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminUser(auth.user, req)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const files = await listPromptFiles();
  const fileSet = new Set(files);

  const supabase = getSupabaseServiceClient();
  let cloudIds: string[] = [];
  let cloudUpdatedAtMap = new Map<string, string>();
  if (supabase) {
    try {
      const { data, error } = await supabase.from("prompt_templates").select("id,updated_at");
      if (!error && Array.isArray(data)) {
        cloudIds = data
          .map((r) => (r as { id?: unknown }).id)
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .map((v) => v.trim());
        cloudUpdatedAtMap = new Map(
          data
            .map((r) => {
              const id = typeof (r as { id?: unknown }).id === "string" ? String((r as { id?: unknown }).id) : "";
              const updatedAt = typeof (r as { updated_at?: unknown }).updated_at === "string" ? String((r as { updated_at?: unknown }).updated_at) : "";
              if (!id || !updatedAt) return null;
              return [id, updatedAt] as const;
            })
            .filter((x): x is readonly [string, string] => Boolean(x))
        );
      }
    } catch {
      cloudIds = [];
      cloudUpdatedAtMap = new Map();
    }
  }

  const allIds = Array.from(new Set([...files, ...cloudIds])).sort((a, b) => a.localeCompare(b));

  const prompts = allIds.map((id) => ({
    id,
    hasFile: fileSet.has(id),
    hasCloud: cloudIds.includes(id),
    cloudUpdatedAt: cloudUpdatedAtMap.get(id) ?? null,
  }));

  return Response.json({ prompts }, { status: 200 });
}
