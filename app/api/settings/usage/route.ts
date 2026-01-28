import { createClient } from "@supabase/supabase-js";
import { getRedisClient } from "@/lib/redis";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";

export const runtime = "nodejs";

type UsageRow = {
  id: string;
  created_at: string;
  description?: string | null;
  qty?: number | null;
  total?: number | null;
  title?: string | null;
  amount?: number | null;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const CACHE_TTL_SECONDS = 10;

export async function GET(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limitParsed = limitRaw ? Number(limitRaw) : NaN;
  const limitBase = Number.isFinite(limitParsed) && limitParsed > 0 ? Math.floor(limitParsed) : DEFAULT_LIMIT;
  const limit = Math.min(Math.max(limitBase, 1), MAX_LIMIT);
  const noCache = (url.searchParams.get("noCache") ?? "").trim() === "1";

  const redis = getRedisClient();
  const cacheKey = `aipersona:settings:usage:v1:${auth.user.id}:limit:${limit}`;
  if (redis && !noCache) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as { credits: number; history: UsageRow[] };
        return Response.json(parsed, { status: 200, headers: { "Cache-Control": "private, max-age=0" } });
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

  const [creditsRes, historyRes] = await Promise.all([
    supabase.from("users").select("credits").eq("id", auth.user.id).maybeSingle(),
    supabase
      .from("credit_history")
      .select("id,created_at,qty,total,title,amount")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  if (creditsRes.error) {
    return Response.json({ error: creditsRes.error.message }, { status: 500 });
  }
  if (historyRes.error) {
    return Response.json({ error: historyRes.error.message }, { status: 500 });
  }

  const payload = {
    credits: creditsRes.data?.credits ?? 0,
    history: ((historyRes.data ?? []) as UsageRow[]) ?? [],
  };

  if (redis && !noCache) {
    try {
      await redis.set(cacheKey, JSON.stringify(payload), "EX", CACHE_TTL_SECONDS);
    } catch {
      void 0;
    }
  }

  return Response.json(payload, { status: 200, headers: { "Cache-Control": "private, max-age=0" } });
}
