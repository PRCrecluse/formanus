import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import { getRedisClient } from "@/lib/redis";

export const runtime = "nodejs";

const DOC_TTL_SECONDS = 60;

type PersonaDocRow = {
  id: string;
  persona_id: string | null;
  title: string | null;
  content: string | null;
  type: string | null;
  updated_at: string | null;
};

export async function GET(req: Request, context: { params: Promise<{ docId: string }> }) {
  const auth = await getUserFromRequest(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { docId: rawDocId } = await context.params;
  const docId = decodeURIComponent(rawDocId);
  if (!docId) {
    return Response.json({ error: "docId is required" }, { status: 400 });
  }

  const redis = getRedisClient();
  const cacheKey = `aipersona:persona-docs:doc:v1:${auth.user.id}:${docId}`;
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as { doc: PersonaDocRow };
        return Response.json(parsed.doc, { status: 200 });
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

  const { data, error } = await supabase.from("persona_docs").select("*").eq("id", docId).maybeSingle();
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  let doc = (data ?? null) as PersonaDocRow | null;

  if (!doc) {
    const url = new URL(req.url);
    const personaId = (url.searchParams.get("personaId") ?? "").trim();
    const legacyId = (url.searchParams.get("legacyId") ?? "").trim();
    if (personaId && legacyId) {
      const legacyRes = await supabase
        .from("persona_docs")
        .select("*")
        .eq("id", legacyId)
        .eq("persona_id", personaId)
        .maybeSingle();
      if (!legacyRes.error && legacyRes.data) {
        doc = legacyRes.data as PersonaDocRow;
      }
    }
  }

  if (!doc) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify({ doc }), "EX", DOC_TTL_SECONDS);
    } catch {
      void 0;
    }
  }

  return Response.json(doc, { status: 200 });
}

