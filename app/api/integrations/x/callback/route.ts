import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getMongoDb } from "@/lib/mongodb";
import crypto from "crypto";

export const runtime = "nodejs";

type TwitterTokenResponse = {
  token_type?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

type TwitterUserResponse = {
  data?: {
    id?: string;
    name?: string;
    username?: string;
    profile_image_url?: string;
  };
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
  res.cookies.set("x_oauth_state", "", { path: "/", maxAge: 0 });
  res.cookies.set("x_oauth_verifier", "", { path: "/", maxAge: 0 });
  res.cookies.set("x_supabase_token", "", { path: "/", maxAge: 0 });
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

  const reqState = (req.cookies.get("x_oauth_state")?.value ?? "").trim();
  const verifier = (req.cookies.get("x_oauth_verifier")?.value ?? "").trim();
  const supabaseToken = (req.cookies.get("x_supabase_token")?.value ?? "").trim();

  if (!code || !state || !verifier || !supabaseToken || state !== reqState) {
    console.error("[integrations:x:callback] invalid_oauth_state", {
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
    const res = NextResponse.redirect(`${redirectBase}?error=invalid_oauth_state&requestId=${encodeURIComponent(requestId)}`, {
      headers: { "x-request-id": requestId },
    });
    clearCookies(res);
    return res;
  }

  const clientId = (process.env.X_CLIENT_ID ?? "").toString().trim();
  const clientSecret = (process.env.X_CLIENT_SECRET ?? "").toString().trim();
  if (!clientId || !clientSecret) {
    const res = NextResponse.redirect(`${redirectBase}?error=missing_x_client_credentials&requestId=${encodeURIComponent(requestId)}`, {
      headers: { "x-request-id": requestId },
    });
    clearCookies(res);
    return res;
  }

  const redirectUri = `${origin}/api/integrations/x/callback`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    client_id: clientId,
  });

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenRes = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const tokenJson = (await tokenRes.json()) as TwitterTokenResponse & { error?: string; error_description?: string };
  if (!tokenRes.ok || !tokenJson.access_token) {
    console.error("[integrations:x:callback] token_exchange_failed", {
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

  const userRes = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
  const userText = await userRes.text().catch(() => "");
  let userJson: TwitterUserResponse | null = null;
  try {
    userJson = userText ? (JSON.parse(userText) as TwitterUserResponse) : null;
  } catch {
    userJson = null;
  }
  const hasUserId = Boolean(userJson && userJson.data && userJson.data.id);
  const userFetchForbidden = userRes.status === 403;

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
  const providerAccountId = hasUserId && userJson?.data?.id ? userJson.data.id.toString() : null;

  if (providerAccountId) {
    await col.updateMany(
      {
        userId: user.id,
        provider: "twitter",
        providerAccountId: { $exists: false },
        "profile.id": providerAccountId,
      },
      {
        $set: {
          providerAccountId,
        },
      }
    );
  }

  await col.updateOne(
    { userId: user.id, provider: "twitter", providerAccountId: providerAccountId ?? null },
    {
      $set: {
        provider: "twitter",
        userId: user.id,
        providerAccountId: providerAccountId ?? null,
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token ?? null,
        tokenType: tokenJson.token_type ?? "bearer",
        scope: tokenJson.scope ?? null,
        expiresAt,
        profile: hasUserId
          ? {
              id: userJson!.data?.id ?? null,
              username: userJson!.data?.username ?? null,
              name: userJson!.data?.name ?? null,
              profileImageUrl: userJson!.data?.profile_image_url ?? null,
            }
          : {
              id: null,
              username: null,
              name: null,
              profileImageUrl: null,
            },
        updatedAt: now,
        meta: userFetchForbidden
          ? {
              userFetchStatus: userRes.status,
              userFetchBody: (userText ? userText.slice(0, 300) : ""),
            }
          : undefined,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  const res = NextResponse.redirect(
    `${redirectBase}?connected=twitter${userFetchForbidden ? "&note=user_profile_forbidden" : ""}&requestId=${encodeURIComponent(requestId)}`,
    {
    headers: { "x-request-id": requestId },
    }
  );
  clearCookies(res);
  return res;
}
