import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
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

function base64Url(input: Buffer) {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createCodeVerifier() {
  return base64Url(crypto.randomBytes(32));
}

function createCodeChallenge(verifier: string) {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64Url(hash);
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
  try {
    const auth = await withTimeout(getUserFromRequest(req), 10_000, "auth_timeout");
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized", requestId },
        { status: 401, headers: { "x-request-id": requestId } }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnon) {
      return NextResponse.json(
        { error: "Supabase not configured", requestId },
        { status: 500, headers: { "x-request-id": requestId } }
      );
    }
    const supabase = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: `Bearer ${auth.accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: userRow } = await supabase
      .from("users")
      .select("membership_status")
      .eq("id", auth.user.id)
      .single();
    const plan = typeof userRow?.membership_status === "string" ? (userRow.membership_status as string).toLowerCase() : "free";
    if (plan === "free") {
      return NextResponse.json(
        { error: "Upgrade required", requestId },
        { status: 403, headers: { "x-request-id": requestId } }
      );
    }

    const clientId = (process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "").toString().trim();
    if (!clientId) {
      return NextResponse.json(
        { error: "Missing GOOGLE_CALENDAR_CLIENT_ID", requestId },
        { status: 500, headers: { "x-request-id": requestId } }
      );
    }

    const envOrigin = (process.env.NEXT_PUBLIC_SITE_URL ?? "").toString().trim();
    const origin = getPublicOrigin(req) || normalizeOrigin(envOrigin) || new URL(req.url).origin;
    const redirectUri = `${origin}/api/integrations/google-calendar/callback`;

    const state = base64Url(crypto.randomBytes(24));
    const codeVerifier = createCodeVerifier();
    const codeChallenge = createCodeChallenge(codeVerifier);

    const scopes = [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
    ];

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes.join(" "),
      state,
      access_type: "offline",
      include_granted_scopes: "true",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "consent",
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    const res = NextResponse.json({ url, requestId }, { headers: { "x-request-id": requestId } });

    const secure = origin.startsWith("https://");
    res.cookies.set("gcal_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 600,
    });
    res.cookies.set("gcal_oauth_verifier", codeVerifier, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 600,
    });
    res.cookies.set("gcal_supabase_token", auth.accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 600,
    });

    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    console.error("[integrations:google-calendar:start]", { requestId, message });
    return NextResponse.json(
      { error: message, requestId },
      { status: message.includes("timeout") ? 504 : 500, headers: { "x-request-id": requestId } }
    );
  }
}
