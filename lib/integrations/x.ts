import { getMongoDb } from "@/lib/mongodb";
import crypto from "crypto";
import OAuth from "oauth-1.0a";
import { ObjectId } from "mongodb";

type TwitterTokenResponse = {
  token_type?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function refreshAccessToken(args: { refreshToken: string; clientId: string; clientSecret: string }) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.clientId,
  });
  const basic = Buffer.from(`${args.clientId}:${args.clientSecret}`).toString("base64");
  const res = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await res.json().catch(() => null)) as TwitterTokenResponse | null;
  if (!res.ok || !json?.access_token) {
    throw new Error(json?.error_description || json?.error || "refresh_failed");
  }
  return json;
}

function extractPostErrorDetail(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as { detail?: unknown; errors?: { detail?: unknown }[] };
  if (typeof obj.detail === "string" && obj.detail.trim()) return obj.detail;
  if (Array.isArray(obj.errors) && obj.errors.length > 0) {
    const first = obj.errors[0];
    if (first && typeof first.detail === "string" && first.detail.trim()) return first.detail;
  }
  return null;
}

export async function postToXForUser(args: {
  userId: string;
  text: string;
  accountId?: string | null;
}): Promise<{
  ok: boolean;
  status?: number;
  tweetId?: string | null;
  raw?: unknown;
  error?: string;
  detail?: string | null;
}> {
  const text = args.text.trim();
  if (!text) return { ok: false, status: 400, error: "Missing text" };

  const consumerKey = (process.env.X_OAUTH_CONSUMER_KEY ?? "").toString().trim();
  const consumerSecret = (process.env.X_OAUTH_CONSUMER_SECRET ?? "").toString().trim();
  const userAccessToken = (process.env.X_OAUTH_ACCESS_TOKEN ?? "").toString().trim();
  const userAccessTokenSecret = (process.env.X_OAUTH_ACCESS_TOKEN_SECRET ?? "").toString().trim();
  if (consumerKey && consumerSecret && userAccessToken && userAccessTokenSecret) {
    const oauth = new OAuth({
      consumer: { key: consumerKey, secret: consumerSecret },
      signature_method: "HMAC-SHA1",
      hash_function(baseString: string, key: string) {
        return crypto.createHmac("sha1", key).update(baseString).digest("base64");
      },
    });
    const token = { key: userAccessToken, secret: userAccessTokenSecret };
    const url = "https://api.x.com/2/tweets";
    const authHeader = oauth.toHeader(oauth.authorize({ url, method: "POST" }, token)).Authorization;
    const postRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
    const postJson = await postRes.json().catch(() => null as unknown);
    const detail = extractPostErrorDetail(postJson);
    if (!postRes.ok) {
      const error = postRes.status === 401 || postRes.status === 403 ? "x_rejected_oauth1" : "post_failed";
      return { ok: false, status: postRes.status, error, detail, raw: postJson };
    }
    const dataObj =
      postJson && typeof postJson === "object" ? ((postJson as Record<string, unknown>).data as unknown) : null;
    const tweetId =
      dataObj && typeof dataObj === "object" && typeof (dataObj as Record<string, unknown>).id === "string"
        ? ((dataObj as Record<string, unknown>).id as string)
        : null;
    return { ok: true, status: 200, tweetId, raw: postJson };
  }

  const clientId = (process.env.X_CLIENT_ID ?? "").toString().trim();
  const clientSecret = (process.env.X_CLIENT_SECRET ?? "").toString().trim();
  if (!clientId || !clientSecret) {
    return { ok: false, status: 500, error: "Missing X client credentials" };
  }

  const db = await getMongoDb();
  const col = db.collection("social_accounts");
  const baseFilter: Record<string, unknown> = { userId: args.userId, provider: "twitter" };
  if (args.accountId) {
    const orConditions: Array<Record<string, unknown>> = [
      { providerAccountId: args.accountId },
      { "profile.id": args.accountId },
    ];
    if (ObjectId.isValid(args.accountId)) {
      orConditions.push({ _id: new ObjectId(args.accountId) });
    }
    baseFilter.$or = orConditions;
  }

  const doc = await col.find(baseFilter).sort({ createdAt: 1, _id: 1 }).limit(1).next();
  if (!doc?.accessToken) {
    return { ok: false, status: 400, error: "X account not connected" };
  }

  let accessToken = doc.accessToken as string;
  const expiresAt = doc.expiresAt ? new Date(doc.expiresAt as string) : null;
  const needsRefresh = expiresAt ? expiresAt.getTime() - Date.now() < 60_000 : false;

  if (needsRefresh && doc.refreshToken) {
    const refreshed = await refreshAccessToken({
      refreshToken: doc.refreshToken as string,
      clientId,
      clientSecret,
    });
    accessToken = refreshed.access_token as string;
    const nextExpiresAt =
      typeof refreshed.expires_in === "number" ? new Date(Date.now() + refreshed.expires_in * 1000) : null;
    await col.updateOne(
      { userId: args.userId, provider: "twitter" },
      {
        $set: {
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? doc.refreshToken ?? null,
          scope: refreshed.scope ?? doc.scope ?? null,
          tokenType: refreshed.token_type ?? doc.tokenType ?? "bearer",
          expiresAt: nextExpiresAt,
          updatedAt: new Date(),
        },
      }
    );
  }

  const postRes = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  const postJson = await postRes.json().catch(() => null as unknown);
  const detail = extractPostErrorDetail(postJson);
  if (!postRes.ok) {
    const error = postRes.status === 401 || postRes.status === 403 ? "x_rejected_oauth2" : "post_failed";
    return { ok: false, status: postRes.status, error, detail, raw: postJson };
  }

  const dataObj =
    postJson && typeof postJson === "object" ? ((postJson as Record<string, unknown>).data as unknown) : null;
  const tweetId =
    dataObj && typeof dataObj === "object" && typeof (dataObj as Record<string, unknown>).id === "string"
      ? ((dataObj as Record<string, unknown>).id as string)
      : null;
  return { ok: true, status: 200, tweetId, raw: postJson };
}
