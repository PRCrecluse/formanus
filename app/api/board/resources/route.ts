import { createClient } from "@supabase/supabase-js";
import { getMongoDb } from "@/lib/mongodb";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";

export const runtime = "nodejs";

type ResourceRow = {
  id: string;
  title: string | null;
  updated_at: string | null;
  persona_id: string | null;
  type: string | null;
  content: string | null;
};

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

type CacheValue = {
  payload: { resources: ResourceRow[]; has_more: boolean; next_offset: number };
  expiresAt: number;
};

type CacheEntry = {
  value: CacheValue | null;
  inFlight: Promise<CacheValue> | null;
};

const CACHE_TTL_MS = 12_000;
const STALE_IF_SLOW_MS = 2500;

const cache = new Map<string, CacheEntry>();

function cacheKey(userId: string, limit: number, offset: number) {
  return `board-resources:v1:${userId}:l${limit}:o${offset}`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Request timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export async function GET(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");
  const limitParsed = limitRaw ? Number(limitRaw) : NaN;
  const offsetParsed = offsetRaw ? Number(offsetRaw) : NaN;
  const limitBase = Number.isFinite(limitParsed) && limitParsed > 0 ? Math.floor(limitParsed) : DEFAULT_LIMIT;
  const offsetBase = Number.isFinite(offsetParsed) && offsetParsed >= 0 ? Math.floor(offsetParsed) : 0;
  const limit = Math.min(Math.max(limitBase, 1), MAX_LIMIT);
  const offset = Math.max(offsetBase, 0);

  const key = cacheKey(auth.user.id, limit, offset);
  const now = Date.now();
  const existing = cache.get(key);
  const fresh = existing?.value && existing.value.expiresAt > now ? existing.value : null;
  if (fresh) {
    return Response.json(fresh.payload, { status: 200, headers: { "Cache-Control": "private, max-age=0", "x-cache": "memory-hit" } });
  }

  const entry: CacheEntry = existing ?? { value: null, inFlight: null };

  if (!entry.inFlight) {
    entry.inFlight = (async () => {
      const db = await getMongoDb();
      const personaDocs = await db
        .collection<{
          _id: string;
          userId: string;
        }>("personas")
        .find({ userId: auth.user.id })
        .project<{ _id: string }>({ _id: 1 })
        .toArray();

      const personaIds = personaDocs.map((p) => p._id).filter((id) => typeof id === "string" && id.length > 0);
      if (personaIds.length === 0) {
        return { payload: { resources: [], has_more: false, next_offset: 0 }, expiresAt: now + CACHE_TTL_MS };
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error("Supabase not configured");
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

      const csv = personaIds.map((id) => `${id}`).join(",");
      const { data, error } = await supabase
        .from("persona_docs")
        .select("id,title,updated_at,persona_id,type,content")
        .or(csv ? `persona_id.in.(${csv}),persona_id.is.null` : "persona_id.is.null")
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw new Error(error.message);

      const rows = (data ?? []) as ResourceRow[];
      const hasMore = rows.length === limit;
      const nextOffset = offset + rows.length;

      return {
        payload: { resources: rows, has_more: hasMore, next_offset: nextOffset },
        expiresAt: Date.now() + CACHE_TTL_MS,
      };
    })()
      .then((value) => {
        entry.value = value;
        return value;
      })
      .finally(() => {
        entry.inFlight = null;
      });

    cache.set(key, entry);
  }

  const stale = entry.value;
  try {
    const value = stale ? await Promise.race([entry.inFlight, new Promise<CacheValue>((resolve) => setTimeout(() => resolve(stale), STALE_IF_SLOW_MS))]) : await entry.inFlight;
    const hitType = value === stale && stale ? "memory-stale" : "memory-miss";
    return Response.json(value.payload, { status: 200, headers: { "Cache-Control": "private, max-age=0", "x-cache": hitType } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
