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

function clearCookies(res: NextResponse) {
  res.cookies.set("notion_oauth_state", "", { path: "/", maxAge: 0 });
  res.cookies.set("notion_supabase_token", "", { path: "/", maxAge: 0 });
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
  const envOrigin = normalizeOrigin((process.env.NEXT_PUBLIC_SITE_URL ?? "").toString().trim());
  const origin = envOrigin || getPublicOrigin(req) || new URL(req.url).origin;
  const redirectBase = `${origin}/integration`;

  const url = new URL(req.url);
  const code = (url.searchParams.get("code") ?? "").trim();
  const state = (url.searchParams.get("state") ?? "").trim();
  const errorParam = (url.searchParams.get("error") ?? "").trim();
  const errorDesc = (url.searchParams.get("error_description") ?? "").trim();

  if (errorParam) {
    const res = NextResponse.redirect(`${redirectBase}?error=${encodeURIComponent(errorDesc || errorParam)}`);
    clearCookies(res);
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
    const res = NextResponse.redirect(
      `${redirectBase}?error=invalid_oauth_state&requestId=${encodeURIComponent(requestId)}`,
      { headers: { "x-request-id": requestId } }
    );
    clearCookies(res);
    return res;
  }

  const clientId = (process.env.NOTION_CLIENT_ID ?? "").toString().trim();
  const clientSecret = (process.env.NOTION_CLIENT_SECRET ?? "").toString().trim();
  if (!clientId || !clientSecret) {
    const res = NextResponse.redirect(
      `${redirectBase}?error=missing_notion_client_credentials&requestId=${encodeURIComponent(requestId)}`,
      { headers: { "x-request-id": requestId } }
    );
    clearCookies(res);
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
    const res = NextResponse.redirect(
      `${redirectBase}?error=${encodeURIComponent(errDesc || err)}&requestId=${encodeURIComponent(requestId)}`
    );
    clearCookies(res);
    return res;
  }

  const debugEnabled = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEBUG_INTEGRATIONS === "1";
  const accessToken = tokenJson.access_token;
  let botAvatarUrl: string | null = null;
  let botName: string | null = null;
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
    botAvatarUrl = me && typeof me.avatar_url === "string" ? (me.avatar_url as string) : null;
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
    const res = NextResponse.redirect(`${redirectBase}?error=unauthorized&requestId=${encodeURIComponent(requestId)}`);
    clearCookies(res);
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
        },
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  const res = NextResponse.redirect(`${redirectBase}?connected=notion&requestId=${encodeURIComponent(requestId)}`, {
    headers: { "x-request-id": requestId },
  });
  clearCookies(res);
  return res;
}
