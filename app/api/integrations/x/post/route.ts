import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import { postToXForUser } from "@/lib/integrations/x";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  const result = await postToXForUser({ userId: auth.user.id, text });
  if (!result.ok) {
    const status = typeof result.status === "number" ? result.status : 500;
    const message =
      status === 401 || status === 403
        ? "X rejected the request. Please reconnect your X account and ensure write permissions."
        : result.error || "Post failed";
    return NextResponse.json({ error: message, detail: result.detail ?? null, raw: result.raw ?? null }, { status });
  }

  return NextResponse.json(result.raw ?? { ok: true, tweetId: result.tweetId ?? null }, { status: 200 });
}
