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

    const clientId = (process.env.NOTION_CLIENT_ID ?? "").toString().trim();
    if (!clientId) {
      return NextResponse.json(
        { error: "Missing NOTION_CLIENT_ID", requestId },
        { status: 500, headers: { "x-request-id": requestId } }
      );
    }

    const envOrigin = normalizeOrigin((process.env.NEXT_PUBLIC_SITE_URL ?? "").toString().trim());
    const origin = envOrigin || getPublicOrigin(req) || new URL(req.url).origin;
    const redirectUri = `${origin}/api/integrations/notion/callback`;

    const state = base64Url(crypto.randomBytes(24));

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      owner: "user",
      redirect_uri: redirectUri,
      state,
    });

    const url = `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
    const res = NextResponse.json({ url, requestId }, { headers: { "x-request-id": requestId } });

    const secure = origin.startsWith("https://");
    res.cookies.set("notion_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 600,
    });
    res.cookies.set("notion_supabase_token", auth.accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 600,
    });

    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    console.error("[integrations:notion:start]", { requestId, message });
    return NextResponse.json(
      { error: message, requestId },
      { status: message.includes("timeout") ? 504 : 500, headers: { "x-request-id": requestId } }
    );
  }
}
