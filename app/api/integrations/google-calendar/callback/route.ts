import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getMongoDb } from "@/lib/mongodb";
import crypto from "crypto";

export const runtime = "nodejs";

type GoogleTokenResponse = {
  token_type?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

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
  res.cookies.set("gcal_oauth_state", "", { path: "/", maxAge: 0 });
  res.cookies.set("gcal_oauth_verifier", "", { path: "/", maxAge: 0 });
  res.cookies.set("gcal_supabase_token", "", { path: "/", maxAge: 0 });
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
  const envOrigin = (process.env.NEXT_PUBLIC_SITE_URL ?? "").toString().trim();
  const origin = getPublicOrigin(req) || normalizeOrigin(envOrigin) || new URL(req.url).origin;
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

  const reqState = (req.cookies.get("gcal_oauth_state")?.value ?? "").trim();
  const verifier = (req.cookies.get("gcal_oauth_verifier")?.value ?? "").trim();
  const supabaseToken = (req.cookies.get("gcal_supabase_token")?.value ?? "").trim();

  if (!code || !state || !verifier || !supabaseToken || state !== reqState) {
    console.error("[integrations:google-calendar:callback] invalid_oauth_state", {
      requestId,
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasCookieState: Boolean(reqState),
      hasCookieVerifier: Boolean(verifier),
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

  const clientId = (process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "").toString().trim();
  const clientSecret = (process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "").toString().trim();
  if (!clientId || !clientSecret) {
    const res = NextResponse.redirect(
      `${redirectBase}?error=missing_google_calendar_client_credentials&requestId=${encodeURIComponent(requestId)}`,
      { headers: { "x-request-id": requestId } }
    );
    clearCookies(res);
    return res;
  }

  const redirectUri = `${origin}/api/integrations/google-calendar/callback`;
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenJson = (await tokenRes.json()) as GoogleTokenResponse & { error?: string; error_description?: string };

  if (!tokenRes.ok || !tokenJson.access_token) {
    console.error("[integrations:google-calendar:callback] token_exchange_failed", {
      requestId,
      status: tokenRes.status,
      error: tokenJson?.error ?? null,
      errorDescription: tokenJson?.error_description ?? null,
      hasAccessToken: Boolean(tokenJson?.access_token),
    });
    const res = NextResponse.redirect(
      `${redirectBase}?error=${encodeURIComponent(tokenJson.error_description || tokenJson.error || "token_exchange_failed")}&requestId=${encodeURIComponent(requestId)}`
    );
    clearCookies(res);
    return res;
  }

  const user = await getSupabaseUser(supabaseToken);
  if (!user) {
    const res = NextResponse.redirect(`${redirectBase}?error=unauthorized&requestId=${encodeURIComponent(requestId)}`);
    clearCookies(res);
    return res;
  }

  const db = await getMongoDb();
  const col = db.collection("social_accounts");
  const expiresAt =
    typeof tokenJson.expires_in === "number" ? new Date(Date.now() + tokenJson.expires_in * 1000) : null;
  const now = new Date();

  await col.updateOne(
    { userId: user.id, provider: "google_calendar" },
    {
      $set: {
        provider: "google_calendar",
        userId: user.id,
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token ?? null,
        tokenType: tokenJson.token_type ?? "bearer",
        scope: tokenJson.scope ?? null,
        expiresAt,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  const res = NextResponse.redirect(`${redirectBase}?connected=google_calendar&requestId=${encodeURIComponent(requestId)}`, {
    headers: { "x-request-id": requestId },
  });
  clearCookies(res);
  return res;
}

