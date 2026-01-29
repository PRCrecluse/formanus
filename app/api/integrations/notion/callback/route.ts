import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getMongoDb } from "@/lib/mongodb";
import crypto from "crypto";

export const runtime = "nodejs";

type NotionTokenResponse = {
  access_token?: string;
  token_type?: string;
  bot_id?: string;
  workspace_id?: string;
  workspace_name?: string;
  duplicated_template_id?: string | null;
  owner?: unknown;
};

function safeJsonParse(input: string): unknown {
  try {
    return input ? (JSON.parse(input) as unknown) : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const unwrapped = trimmed.replace(/^`+/, "").replace(/`+$/, "").trim();
  return unwrapped || null;
}

function extractOwnerUser(owner: unknown): { id: string | null; name: string | null; avatarUrl: string | null } {
  const root = isRecord(owner) ? owner : null;
  const candidate = root && isRecord(root.user) ? (root.user as Record<string, unknown>) : root;
  const id = candidate && typeof candidate.id === "string" ? candidate.id : null;
  const name = candidate && typeof candidate.name === "string" ? candidate.name : null;
  const avatarUrl = candidate ? cleanUrl(candidate.avatar_url) : null;
  return { id, name, avatarUrl };
}

async function getSupabaseUser(accessToken: string) {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").toString().trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").toString().trim();
  if (!url || !anonKey) return null;
  const client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user;
}

function getPublicHostname(req: NextRequest) {
  const forwardedHost = (req.headers.get("x-forwarded-host") ?? "").toString().trim();
  const hostHeader = forwardedHost || (req.headers.get("host") ?? "").toString().trim();
  const first = hostHeader.split(",")[0]?.trim() ?? "";
  return first.split(":")[0]?.trim() ?? "";
}

function getCookieDomain(req: NextRequest) {
  const envDomain = (process.env.COOKIE_DOMAIN ?? "").toString().trim();
  if (envDomain) return envDomain;
  const hostname = getPublicHostname(req);
  if (!hostname) return undefined;
  if (hostname === "localhost" || hostname.endsWith(".vercel.app")) return undefined;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return undefined;
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

function clearCookie(res: NextResponse, name: string, domain?: string) {
  res.cookies.set(name, "", { path: "/", maxAge: 0, domain });
}

function clearCookies(res: NextResponse, domain?: string) {
  clearCookie(res, "notion_oauth_state");
  clearCookie(res, "notion_supabase_token");
  if (domain) {
    clearCookie(res, "notion_oauth_state", domain);
    clearCookie(res, "notion_supabase_token", domain);
  }
}

function normalizeOrigin(value: string) {
  return value.replace(/\/+$/, "");
}

function getPublicOrigin(req: NextRequest) {
  const forwardedProto = (req.headers.get("x-forwarded-proto") ?? "").toString().trim();
  const forwardedHost = (req.headers.get("x-forwarded-host") ?? "").toString().trim();
  const host = forwardedHost || (req.headers.get("host") ?? "").toString().trim();
  const proto = forwardedProto || req.nextUrl.protocol.replace(":", "");
  const origin = host && proto ? `${proto}://${host}` : req.nextUrl.origin;
  return normalizeOrigin(origin);
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const cookieDomain = getCookieDomain(req);
  const envOrigin = normalizeOrigin((process.env.NEXT_PUBLIC_SITE_URL ?? "").toString().trim());
  const origin = envOrigin || getPublicOrigin(req) || new URL(req.url).origin;
  const redirectBase = new URL(`${origin}/integration`);
  redirectBase.searchParams.set("tab", "platforms");

  const buildRedirectUrl = (params: Record<string, string | undefined>) => {
    const nextUrl = new URL(redirectBase.toString());
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value.length > 0) nextUrl.searchParams.set(key, value);
    }
    return nextUrl.toString();
  };

  const url = new URL(req.url);
  const code = (url.searchParams.get("code") ?? "").trim();
  const state = (url.searchParams.get("state") ?? "").trim();
  const errorParam = (url.searchParams.get("error") ?? "").trim();
  const errorDesc = (url.searchParams.get("error_description") ?? "").trim();

  if (errorParam) {
    const res = NextResponse.redirect(buildRedirectUrl({ error: errorDesc || errorParam }));
    clearCookies(res, cookieDomain);
    return res;
  }

  const reqState = (req.cookies.get("notion_oauth_state")?.value ?? "").trim();
  const supabaseToken = (req.cookies.get("notion_supabase_token")?.value ?? "").trim();

  if (!code || !state || !supabaseToken || state !== reqState) {
    console.error("[integrations:notion:callback] invalid_oauth_state", {
      requestId,
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasCookieState: Boolean(reqState),
      hasCookieSupabaseToken: Boolean(supabaseToken),
      stateMatch: Boolean(state && reqState && state === reqState),
      host: req.headers.get("host"),
      xForwardedHost: req.headers.get("x-forwarded-host"),
      xForwardedProto: req.headers.get("x-forwarded-proto"),
      origin,
    });
    const res = NextResponse.redirect(buildRedirectUrl({ error: "invalid_oauth_state", requestId }), {
      headers: { "x-request-id": requestId },
    });
    clearCookies(res, cookieDomain);
    return res;
  }

  const clientId = (process.env.NOTION_CLIENT_ID ?? "").toString().trim();
  const clientSecret = (process.env.NOTION_CLIENT_SECRET ?? "").toString().trim();
  if (!clientId || !clientSecret) {
    const res = NextResponse.redirect(buildRedirectUrl({ error: "missing_notion_client_credentials", requestId }), {
      headers: { "x-request-id": requestId },
    });
    clearCookies(res, cookieDomain);
    return res;
  }

  const redirectUri = `${origin}/api/integrations/notion/callback`;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      "Notion-Version": "2025-09-03",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  const tokenText = await tokenRes.text().catch(() => "");
  let tokenJson: (NotionTokenResponse & { error?: string; error_description?: string }) | null = null;
  try {
    tokenJson = tokenText ? (JSON.parse(tokenText) as NotionTokenResponse & { error?: string; error_description?: string }) : null;
  } catch {
    tokenJson = null;
  }

  if (!tokenRes.ok || !tokenJson?.access_token) {
    const err = tokenJson && typeof tokenJson.error === "string" ? tokenJson.error : "token_exchange_failed";
    const errDesc =
      tokenJson && typeof tokenJson.error_description === "string" ? tokenJson.error_description : null;
    console.error("[integrations:notion:callback] token_exchange_failed", {
      requestId,
      status: tokenRes.status,
      error: err,
      errorDescription: errDesc,
      body: tokenText ? tokenText.slice(0, 500) : "",
    });
    const res = NextResponse.redirect(buildRedirectUrl({ error: errDesc || err, requestId }));
    clearCookies(res, cookieDomain);
    return res;
  }

  const debugEnabled = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEBUG_INTEGRATIONS === "1";
  const accessToken = tokenJson.access_token;
  let botAvatarUrl: string | null = null;
  let botName: string | null = null;
  const ownerUser = extractOwnerUser(tokenJson.owner);
  const userId = ownerUser.id;
  const userName = ownerUser.name;
  const userAvatarUrl = ownerUser.avatarUrl;
  try {
    const meRes = await fetch("https://api.notion.com/v1/users/me", {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Notion-Version": "2025-09-03",
      },
    });
    const meText = await meRes.text().catch(() => "");
    const meParsed = safeJsonParse(meText);
    const me = (meParsed && typeof meParsed === "object" ? (meParsed as Record<string, unknown>) : null) as Record<string, unknown> | null;
    botAvatarUrl = me ? cleanUrl(me.avatar_url) : null;
    botName = me && typeof me.name === "string" ? (me.name as string) : null;
    if (debugEnabled) {
      console.log("[integrations:notion:callback] me", {
        requestId,
        ok: meRes.ok,
        status: meRes.status,
        hasAvatarUrl: Boolean(botAvatarUrl),
        hasName: Boolean(botName),
      });
      if (!meRes.ok) {
        console.log("[integrations:notion:callback] me_body", { requestId, body: meText ? meText.slice(0, 500) : "" });
      }
    }
  } catch (error: unknown) {
    if (debugEnabled) {
      const message = error instanceof Error ? error.message : "Request failed";
      console.log("[integrations:notion:callback] me_error", { requestId, message });
    }
  }

  const user = await getSupabaseUser(supabaseToken);
  if (!user) {
    const res = NextResponse.redirect(buildRedirectUrl({ error: "unauthorized", requestId }));
    clearCookies(res, cookieDomain);
    return res;
  }

  const now = new Date();
  const db = await getMongoDb();
  const col = db.collection("social_accounts");
  await col.updateOne(
    { userId: user.id, provider: "notion" },
    {
      $set: {
        provider: "notion",
        userId: user.id,
        accessToken: tokenJson.access_token,
        refreshToken: null,
        tokenType: tokenJson.token_type ?? "bearer",
        scope: null,
        expiresAt: null,
        profile: {
          workspaceId: (tokenJson.workspace_id ?? null) as string | null,
          workspaceName: (tokenJson.workspace_name ?? null) as string | null,
          botId: (tokenJson.bot_id ?? null) as string | null,
          botName,
          botAvatarUrl,
          userId,
          userName,
          userAvatarUrl,
        },
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  const res = NextResponse.redirect(buildRedirectUrl({ connected: "notion", requestId }), { headers: { "x-request-id": requestId } });
  clearCookies(res, cookieDomain);
  return res;
}
