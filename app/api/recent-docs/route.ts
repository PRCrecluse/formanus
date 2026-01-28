import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { getMongoDb } from "@/lib/mongodb";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";

export const runtime = "nodejs";

type RecentDocRow = {
  id: string;
  persona_id: string | null;
  title: string | null;
  type: string | null;
  updated_at: string | null;
};

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 20;

function withTimeout<T>(promise: Promise<T> | PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(t);
        resolve(value);
      },
      (error) => {
        clearTimeout(t);
        reject(error);
      }
    );
  });
}

type PostgrestErrorLike = { message: string } | null;
type PostgrestResponseLike<T> = { data: T | null; error: PostgrestErrorLike };
type PostgrestFilterBuilderLike<T> = PromiseLike<PostgrestResponseLike<T>> & {
  or: (filters: string) => PostgrestFilterBuilderLike<T>;
  order: (column: string, opts?: { ascending?: boolean }) => PostgrestFilterBuilderLike<T>;
  range: (from: number, to: number) => PostgrestFilterBuilderLike<T>;
};
type PostgrestQueryBuilderLike<T> = {
  select: (columns?: string) => PostgrestFilterBuilderLike<T>;
};
type SupabaseLike = {
  from: (table: string) => unknown;
};
function fromLike<T>(supabase: SupabaseLike, table: string) {
  return supabase.from(table) as unknown as PostgrestQueryBuilderLike<T>;
}

export async function GET(req: Request) {
  const rawRequestId = req.headers.get("x-request-id");
  const requestId = (rawRequestId ?? "").toString().trim() || crypto.randomUUID();
  const startedAt = Date.now();
  let stage = "init";

  try {
    stage = "auth";
    const auth = await withTimeout(getUserFromRequest(req), 10_000, "auth_timeout");
    if (!auth) {
      return Response.json(
        { error: "Unauthorized", requestId },
        { status: 401, headers: { "x-request-id": requestId } }
      );
    }

    stage = "parse_query";
    const url = new URL(req.url);
    const limitRaw = url.searchParams.get("limit");
    const limitParsed = limitRaw ? Number(limitRaw) : NaN;
    const limitBase = Number.isFinite(limitParsed) && limitParsed > 0 ? Math.floor(limitParsed) : DEFAULT_LIMIT;
    const limit = Math.min(Math.max(limitBase, 1), MAX_LIMIT);

    stage = "db_connect";
    const db = await withTimeout(getMongoDb(), 15_000, "db_connect_timeout");
    stage = "db_query_personas";
    const personaDocs = await withTimeout(
      db
        .collection<{
          _id: string;
          userId: string;
        }>("personas")
        .find({ userId: auth.user.id })
        .project<{ _id: string }>({ _id: 1 })
        .toArray(),
      15_000,
      "db_query_timeout"
    );

    const personaIds = personaDocs.map((p) => p._id).filter((id) => typeof id === "string" && id.length > 0);
    if (personaIds.length === 0) {
      return Response.json([], { status: 200, headers: { "x-request-id": requestId } });
    }

    stage = "supabase_init";
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      const message = "Supabase not configured";
      console.error("[recent-docs] config_error", { requestId, stage, message });
      return Response.json(
        { error: message, requestId },
        { status: 500, headers: { "x-request-id": requestId } }
      );
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

    stage = "supabase_query";
    const csv = personaIds.map((id) => `${id}`).join(",");
    const query = fromLike<RecentDocRow[]>(supabase as unknown as SupabaseLike, "persona_docs")
      .select("id,title,updated_at,persona_id,type")
      .or(csv ? `persona_id.in.(${csv}),persona_id.is.null` : "persona_id.is.null")
      .order("updated_at", { ascending: false })
      .range(0, limit - 1);
    const { data, error } = await withTimeout(query, 15_000, "supabase_query_timeout");

    if (error) {
      const message = error.message || "Supabase query failed";
      console.error("[recent-docs] supabase_error", { requestId, stage, message });
      return Response.json(
        { error: message, requestId },
        { status: 500, headers: { "x-request-id": requestId } }
      );
    }

    const rows = (data ?? []) as RecentDocRow[];
    return Response.json(rows, { status: 200, headers: { "x-request-id": requestId } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    const status = message.includes("timeout") ? 504 : 500;
    console.error("[recent-docs] error", {
      requestId,
      stage,
      message,
      elapsedMs: Date.now() - startedAt,
    });
    return Response.json(
      { error: message, requestId },
      { status, headers: { "x-request-id": requestId } }
    );
  }
}
