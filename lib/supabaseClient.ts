"use client";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

export const isSupabaseConfigured = Boolean(url && key);

const looksLikeJwt = (tok?: string) => typeof tok === "string" && tok.split(".").length === 3;
if (!url || !key) {
  console.warn("[Supabase] Missing env: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
} else if (!looksLikeJwt(key)) {
  console.warn("[Supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY doesn't look like a JWT. Please use the 'anon' public key from Supabase settings, not a publishable key.");
}

type AuthClient = SupabaseClient["auth"];
type SignInWithOAuthArgs = Parameters<AuthClient["signInWithOAuth"]>[0];
type SignInWithOtpArgs = Parameters<AuthClient["signInWithOtp"]>[0];

type GetUserReturn = Awaited<ReturnType<AuthClient["getUser"]>>;
type SignInWithOAuthReturn = Awaited<ReturnType<AuthClient["signInWithOAuth"]>>;
type SignInWithOtpReturn = Awaited<ReturnType<AuthClient["signInWithOtp"]>>;
type SignOutReturn = Awaited<ReturnType<AuthClient["signOut"]>>;
type ExchangeCodeReturn = Awaited<ReturnType<AuthClient["exchangeCodeForSession"]>>;
type GetSessionReturn = Awaited<ReturnType<AuthClient["getSession"]>>;
type FunctionInvokeOptions = Parameters<SupabaseClient["functions"]["invoke"]>[1];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(err: unknown) {
  const e = err as { name?: unknown; message?: unknown };
  return e && typeof e === "object" && (e.name === "AbortError" || e.message === "The user aborted a request.");
}

function shouldRetryResponse(res: Response) {
  if (!res) return false;
  if (res.status === 408 || res.status === 429) return true;
  if (res.status >= 500 && res.status <= 599) return true;
  return false;
}

const DEFAULT_FETCH_TIMEOUT_MS = 15000;
let lastFetchTimeoutLogAt = 0;
let lastGetSessionTimeoutLogAt = 0;

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isExpiredOrNearExpiry(expiresAt?: number | null, leewaySeconds = 60) {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return false;
  const now = nowSeconds();
  return now >= expiresAt - Math.max(0, Math.floor(leewaySeconds));
}

function extractSessionLike(v: unknown): Session | null {
  if (!isRecord(v)) return null;
  const accessToken = typeof v.access_token === "string" ? v.access_token : "";
  const tokenType = "bearer" as const;
  const userRecord = isRecord(v.user) ? v.user : null;
  const userId = typeof userRecord?.id === "string" ? userRecord.id : "";
  const user = userRecord ? (userRecord as unknown as Session["user"]) : null;
  const expiresAt = typeof v.expires_at === "number" ? v.expires_at : null;
  if (!accessToken || !userId || !user) return null;
  return {
    ...(v as unknown as Session),
    access_token: accessToken,
    token_type: tokenType,
    user,
    expires_at: expiresAt ?? undefined,
  };
}

function tryReadStoredSessionSnapshot(): Session | null {
  if (typeof window === "undefined") return null;
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const ref = host.split(".")[0] ?? "";
    if (!ref) return null;
    const key1 = `sb-${ref}-auth-token`;
    const key2 = `sb-${ref}-auth-token-storage`;
    const storages: Storage[] = [window.localStorage, window.sessionStorage];
    const directKeys = [key1, key2];
    const candidates: Array<{ storage: Storage; key: string; raw: string }> = [];

    for (const s of storages) {
      for (const k of directKeys) {
        const raw = s.getItem(k);
        if (raw) candidates.push({ storage: s, key: k, raw });
      }
    }

    if (candidates.length === 0) {
      for (const s of storages) {
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (!k) continue;
          if (!k.startsWith("sb-") || !k.endsWith("-auth-token")) continue;
          const raw = s.getItem(k);
          if (!raw) continue;
          candidates.push({ storage: s, key: k, raw });
        }
      }
    }

    for (const c of candidates) {
      const parsed = safeJsonParse(c.raw);
      const direct = extractSessionLike(parsed);
      if (direct) return direct;
      if (isRecord(parsed)) {
        const fromCurrent = extractSessionLike(parsed.currentSession);
        if (fromCurrent) return fromCurrent;
        const fromSession = extractSessionLike(parsed.session);
        if (fromSession) return fromSession;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function mergeSignals(a?: AbortSignal | null, b?: AbortSignal | null) {
  if (!a) return b ?? null;
  if (!b) return a ?? null;
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

const retryingFetch: typeof fetch = async (input, init) => {
  const method = (init?.method ?? "GET").toUpperCase();
  const retryable = method === "GET" || method === "HEAD";
  const maxRetries = retryable ? 2 : 0;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (init?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      const controller = new AbortController();
      const timeoutMs = DEFAULT_FETCH_TIMEOUT_MS;
      const startedAt = Date.now();
      const timer = setTimeout(() => {
        const elapsed = Date.now() - startedAt;
        const err = new Error(`Fetch timeout after ${elapsed}ms`);
        (err as { name?: string }).name = "AbortError";
        controller.abort(err);
      }, timeoutMs);
      const signal = mergeSignals(init?.signal ?? null, controller.signal);
      const res = await fetch(input, { ...(init ?? {}), signal: signal ?? undefined });
      clearTimeout(timer);
      if (!retryable || !shouldRetryResponse(res) || attempt >= maxRetries) return res;
      const retryAfter = res.headers.get("retry-after");
      const parsed = retryAfter ? Number.parseInt(retryAfter, 10) : NaN;
      const retryAfterMs = Number.isFinite(parsed) ? Math.max(0, parsed) * 1000 : null;
      const base = 180 * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 120);
      const waitMs = retryAfterMs ?? Math.min(1800, base + jitter);
      await sleep(waitMs);
      continue;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        const now = Date.now();
        if (now - lastFetchTimeoutLogAt > 8000) {
          lastFetchTimeoutLogAt = now;
          console.warn("[Supabase] fetch aborted (timeout)", {
            url: typeof input === "string" ? input : "",
            method,
            attempt,
          });
        }
      }
      lastErr = err;
      if (!retryable || isAbortError(err) || attempt >= maxRetries) throw err;
      const base = 180 * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 160);
      await sleep(Math.min(1800, base + jitter));
    }
  }

  throw lastErr ?? new Error("Failed to fetch");
};

const globalRef = globalThis as unknown as { __aipersona_supabase?: SupabaseClient };
let client: SupabaseClient;
if (globalRef.__aipersona_supabase) {
  client = globalRef.__aipersona_supabase;
} else if (url && key) {
  const instance = createClient(url, key, {
    global: { fetch: retryingFetch },
    auth: ({ persistSession: true, lock: async (_name, _acquireTimeout, fn) => await fn() } satisfies NonNullable<
      Parameters<typeof createClient>[2]
    >["auth"]),
  });
  globalRef.__aipersona_supabase = instance;
  client = instance;
} else {
  console.warn("Supabase credentials missing (NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY), using mock client.");
  const mockAuth = {
    auth: {
      async getUser() {
        return ({ data: { user: null }, error: null } as unknown) as GetUserReturn;
      },
      onAuthStateChange() {
        return {
          data: { subscription: { unsubscribe() {} } },
        } as ReturnType<AuthClient["onAuthStateChange"]>;
      },
      async getSession() {
        return { data: { session: null }, error: null } as GetSessionReturn;
      },
      async signOut() {
        return { error: null } as SignOutReturn;
      },
      async signInWithOAuth(_args: SignInWithOAuthArgs) {
        return {
          data: { url: null },
          error: { message: "Supabase not configured" },
        } as unknown as SignInWithOAuthReturn;
      },
      async signInWithOtp(_args: SignInWithOtpArgs) {
        return {
          data: { user: null, session: null },
          error: { message: "Supabase not configured" },
        } as unknown as SignInWithOtpReturn;
      },
      async exchangeCodeForSession(_code: string) {
        return {
          data: { user: null, session: null },
          error: { message: "Supabase not configured" },
        } as unknown as ExchangeCodeReturn;
      },
    },
    functions: {
      invoke: async () => ({
        data: null,
        error: { message: "Supabase not configured" },
      }),
    } as unknown as SupabaseClient["functions"],
    from: ((_table: string) => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: [], error: null }),
          single: async () => ({ data: null, error: null }),
        }),
        order: async () => ({ data: [], error: null }),
        single: async () => ({ data: null, error: null }),
      }),
      insert: () => ({
        select: () => ({
          single: async () => ({
            data: null,
            error: { message: "Supabase not configured" },
          }),
        }),
      }),
    })) as unknown as SupabaseClient["from"],
    storage: {
      from: ((_bucket: string) => ({
        upload: async () => ({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      })) as unknown as SupabaseClient["storage"]["from"],
    },
  };

  client = mockAuth as unknown as SupabaseClient;
}

export const supabase = client;

export async function getSessionWithTimeout(opts?: {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}): Promise<{ session: Session | null; timedOut: boolean }> {
  const timeoutMs =
    typeof opts?.timeoutMs === "number" && opts.timeoutMs > 0 ? Math.floor(opts.timeoutMs) : 4000;
  const retries = typeof opts?.retries === "number" && opts.retries >= 0 ? Math.floor(opts.retries) : 3;
  const retryDelayMs =
    typeof opts?.retryDelayMs === "number" && opts.retryDelayMs > 0 ? Math.floor(opts.retryDelayMs) : 200;

  const storedSession = tryReadStoredSessionSnapshot();
  if (storedSession) {
    const expiresAt = typeof storedSession.expires_at === "number" ? storedSession.expires_at : null;
    const expired = typeof expiresAt === "number" && Number.isFinite(expiresAt) ? nowSeconds() >= expiresAt : false;
    if (!expired) return { session: storedSession, timedOut: false };
  }

  let anyTimeout = false;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const startedAt = Date.now();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutP = new Promise<{ kind: "timeout" }>((resolve) => {
      timeoutId = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    });

    const authP = client.auth
      .getSession()
      .then((r) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = null;
        return { kind: "ok" as const, value: r };
      })
      .catch(() => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = null;
        return { kind: "ok" as const, value: { data: { session: null }, error: null } };
      });

    const raced = await Promise.race([authP, timeoutP]);

    if (raced.kind === "timeout") {
      anyTimeout = true;
      const now = Date.now();
      if (now - lastGetSessionTimeoutLogAt > 8000) {
        lastGetSessionTimeoutLogAt = now;
        console.warn("[Supabase] auth.getSession timed out", {
          timeoutMs,
          attempt,
          elapsedMs: now - startedAt,
        });
      }
    } else {
      const session = raced.value?.data?.session ?? null;
      if (session && !isExpiredOrNearExpiry(session.expires_at, 60)) {
        return { session, timedOut: anyTimeout };
      }

      if (session && isExpiredOrNearExpiry(session.expires_at, 60)) {
        const startedAt = Date.now();
        let refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
        const refreshTimeoutP = new Promise<{ kind: "timeout" }>((resolve) => {
          refreshTimeoutId = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
        });

        const refreshP = client.auth
          .refreshSession()
          .then((r) => {
            if (refreshTimeoutId) clearTimeout(refreshTimeoutId);
            refreshTimeoutId = null;
            return { kind: "ok" as const, value: r };
          })
          .catch(() => {
            if (refreshTimeoutId) clearTimeout(refreshTimeoutId);
            refreshTimeoutId = null;
            return { kind: "ok" as const, value: { data: { session: null, user: null }, error: null } };
          });

        const refreshed = await Promise.race([refreshP, refreshTimeoutP]);
        if (refreshed.kind === "timeout") {
          anyTimeout = true;
          const now = Date.now();
          if (now - lastGetSessionTimeoutLogAt > 8000) {
            lastGetSessionTimeoutLogAt = now;
            console.warn("[Supabase] auth.refreshSession timed out", {
              timeoutMs,
              attempt,
              elapsedMs: now - startedAt,
            });
          }
        } else {
          const refreshedSession = refreshed.value?.data?.session ?? null;
          if (refreshedSession && !isExpiredOrNearExpiry(refreshedSession.expires_at, 60)) {
            return { session: refreshedSession, timedOut: anyTimeout };
          }
        }
      }
    }

    if (attempt < retries) {
      const base = Math.max(0, retryDelayMs);
      const exp = Math.min(2500, base * Math.pow(2, attempt));
      const jitter = Math.floor(Math.random() * 120);
      const backoff = Math.max(base, exp + jitter);
      if (backoff > 0) await new Promise((r) => setTimeout(r, backoff));
    }
  }

  const storedAfter = anyTimeout ? tryReadStoredSessionSnapshot() : null;
  if (storedAfter && !isExpiredOrNearExpiry(storedAfter.expires_at, 60)) {
    const expiresAt = typeof storedAfter.expires_at === "number" ? storedAfter.expires_at : null;
    const expired = expiresAt ? Date.now() / 1000 >= expiresAt : null;
    console.warn("[Supabase] using stored session snapshot after getSession timeouts", {
      expired,
      hasExpiresAt: Boolean(expiresAt),
    });
    return { session: storedAfter, timedOut: true };
  }

  return { session: null, timedOut: anyTimeout };
}

export async function getMembershipStatusWithTimeout(opts?: {
  sessionTimeoutMs?: number;
  sessionRetries?: number;
  sessionRetryDelayMs?: number;
}): Promise<string> {
  if (!isSupabaseConfigured) return "free";
  const { session } = await getSessionWithTimeout({
    timeoutMs: opts?.sessionTimeoutMs ?? 2500,
    retries: opts?.sessionRetries ?? 2,
    retryDelayMs: opts?.sessionRetryDelayMs ?? 120,
  });
  const userId = session?.user?.id ?? null;
  if (!userId) return "free";
  const { data } = await supabase.from("users").select("membership_status").eq("id", userId).maybeSingle();
  const raw = typeof data?.membership_status === "string" ? data.membership_status.toLowerCase() : "free";
  return raw === "free" ? "free" : raw;
}

/**
 * Helper to invoke Supabase Edge Functions with proper Authorization header.
 * This ensures we pass the user's session JWT if they are logged in.
 */
export async function invokeEdgeFunction<T = unknown>(
  functionName: string,
  options: Omit<NonNullable<FunctionInvokeOptions>, "headers"> & { headers?: Record<string, string> } = {}
) {
  const { session } = await getSessionWithTimeout({ timeoutMs: 1000, retries: 1, retryDelayMs: 80 });
  const token = session?.access_token;

  if (!token) {
    console.warn(`[invokeEdgeFunction] No active session found for function: ${functionName}. Request might fail with 401 if 'verify_jwt' is enabled.`);
  } else {
    console.log(`[invokeEdgeFunction] Invoking ${functionName} with active session token.`);
  }

  const headers = {
    ...options.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  return client.functions.invoke<T>(functionName, {
    ...options,
    headers,
  });
}
