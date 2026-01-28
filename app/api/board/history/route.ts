import { createClient } from "@supabase/supabase-js";
import { getRedisClient } from "@/lib/redis";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";

export const runtime = "nodejs";

type ChatRow = {
  id: string;
  title: string | null;
  created_at: string;
};

type MessageRow = {
  id: string;
  role: string | null;
  content: string | null;
  created_at: string;
};

const DEFAULT_CHAT_LIMIT = 20;
const MAX_CHAT_LIMIT = 50;

const DEFAULT_MESSAGE_LIMIT = 200;
const MAX_MESSAGE_LIMIT = 500;

const CHAT_CACHE_TTL_SECONDS = 15;
const MESSAGE_CACHE_TTL_SECONDS = 10;

export async function GET(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const chatId = (url.searchParams.get("chatId") ?? "").trim();

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

  const redis = getRedisClient();

  if (!chatId) {
    const limitRaw = url.searchParams.get("limit");
    const limitParsed = limitRaw ? Number(limitRaw) : NaN;
    const limitBase = Number.isFinite(limitParsed) && limitParsed > 0 ? Math.floor(limitParsed) : DEFAULT_CHAT_LIMIT;
    const limit = Math.min(Math.max(limitBase, 1), MAX_CHAT_LIMIT);

    const cacheKey = `aipersona:board:chats:v1:${auth.user.id}:limit:${limit}`;
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as { chats: ChatRow[] };
          return Response.json(parsed, { status: 200, headers: { "Cache-Control": "private, max-age=0" } });
        }
      } catch {
        void 0;
      }
    }

    const { data, error } = await supabase
      .from("chats")
      .select("id,title,created_at")
      .eq("user_id", auth.user.id)
      .like("title", "Board:%")
      .order("created_at", { ascending: false })
      .range(0, limit - 1);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    const payload = { chats: ((data ?? []) as ChatRow[]) ?? [] };

    if (redis) {
      try {
        await redis.set(cacheKey, JSON.stringify(payload), "EX", CHAT_CACHE_TTL_SECONDS);
      } catch {
        void 0;
      }
    }

    return Response.json(payload, { status: 200, headers: { "Cache-Control": "private, max-age=0" } });
  }

  const limitRaw = url.searchParams.get("limit");
  const limitParsed = limitRaw ? Number(limitRaw) : NaN;
  const limitBase = Number.isFinite(limitParsed) && limitParsed > 0 ? Math.floor(limitParsed) : DEFAULT_MESSAGE_LIMIT;
  const limit = Math.min(Math.max(limitBase, 1), MAX_MESSAGE_LIMIT);

  const beforeRaw = (url.searchParams.get("before") ?? "").trim();
  const before = beforeRaw && Number.isFinite(Date.parse(beforeRaw)) ? beforeRaw : "";

  const cacheKey = `aipersona:board:messages:v1:${auth.user.id}:${chatId}:limit:${limit}:before:${before || "none"}`;
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as {
          messages: MessageRow[];
          has_more: boolean;
          next_before: string | null;
        };
        return Response.json(parsed, { status: 200, headers: { "Cache-Control": "private, max-age=0" } });
      }
    } catch {
      void 0;
    }
  }

  const chatRes = await supabase.from("chats").select("id").eq("id", chatId).eq("user_id", auth.user.id).maybeSingle();
  if (chatRes.error) {
    return Response.json({ error: chatRes.error.message }, { status: 500 });
  }
  if (!chatRes.data) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let query = supabase
    .from("messages")
    .select("id,role,content,created_at")
    .eq("chat_id", chatId);

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data, error } = await query.order("created_at", { ascending: false }).range(0, limit);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rows = ((data ?? []) as MessageRow[]) ?? [];
  const hasMore = rows.length > limit;
  const slice = rows.slice(0, limit);
  const newestFirst = slice;
  const oldestFirst = [...newestFirst].reverse();
  const nextBefore = oldestFirst.length > 0 ? oldestFirst[0]!.created_at : null;

  const payload = { messages: oldestFirst, has_more: hasMore, next_before: nextBefore };

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(payload), "EX", MESSAGE_CACHE_TTL_SECONDS);
    } catch {
      void 0;
    }
  }

  return Response.json(payload, { status: 200, headers: { "Cache-Control": "private, max-age=0" } });
}
