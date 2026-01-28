import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import { getRedisClient } from "@/lib/redis";

export const runtime = "nodejs";

const LIST_TTL_SECONDS = 30;

type PersonaDocMeta = {
  id: string;
  title: string | null;
  type: string | null;
  updated_at: string | null;
  persona_id: string | null;
};

export async function GET(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const personaId = (url.searchParams.get("personaId") ?? "").trim();
  if (!personaId) {
    return Response.json({ error: "personaId is required" }, { status: 400 });
  }
  const noCache = (url.searchParams.get("noCache") ?? "").trim() === "1";

  const redis = getRedisClient();
  const cacheKey = `aipersona:persona-docs:list:v1:${auth.user.id}:${personaId}`;
  if (redis && !noCache) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as { docs: PersonaDocMeta[] };
        return Response.json(parsed.docs, { status: 200, headers: { "Cache-Control": "private, max-age=0" } });
      }
    } catch {
      void 0;
    }
  }

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

  const isPrivate = personaId === "__private__";
  const query = supabase
    .from("persona_docs")
    .select("id,title,type,updated_at,persona_id");
  const builder = isPrivate
    ? query
        .is("persona_id", null)
        .like("id", `private-${auth.user.id}-%`)
    : query.eq("persona_id", personaId);
  const { data, error } = await builder
    .order("updated_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const docs = (data ?? []) as PersonaDocMeta[];

  if (redis && !noCache) {
    try {
      await redis.set(cacheKey, JSON.stringify({ docs }), "EX", LIST_TTL_SECONDS);
    } catch {
      void 0;
    }
  }

  return Response.json(docs, {
    status: 200,
    headers: { "Cache-Control": noCache ? "no-store" : "private, max-age=0" },
  });
}
