import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import { getMongoDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import crypto from "crypto";

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

type TwitterUserLookupResponse = {
  data?: {
    id?: string;
    name?: string;
    username?: string;
    profile_image_url?: string;
  };
};

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let stage: string = "init";
  try {
    stage = "auth";
    const auth = await withTimeout(getUserFromRequest(req), 10_000, "auth_timeout");
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized", debug: { requestId, stage, elapsedMs: Date.now() - startedAt } },
        { status: 401, headers: { "x-request-id": requestId } }
      );
    }

    stage = "db_connect";
    const db = await withTimeout(getMongoDb(), 15_000, "db_connect_timeout");
    const col = db.collection("social_accounts");
    stage = "db_query";
    const docs = await withTimeout(
      col
        .find({ userId: auth.user.id, provider: "twitter" })
        .sort({ createdAt: 1, _id: 1 })
        .toArray(),
      10_000,
      "db_query_timeout"
    );

    if (!docs || docs.length === 0) {
      return NextResponse.json(
        { connected: false, accounts: [], requestId },
        { status: 200, headers: { "x-request-id": requestId } }
      );
    }

    const accounts = docs.map((doc) => {
      const profile = doc.profile ?? {};
      const id =
        (typeof doc.providerAccountId === "string" && doc.providerAccountId) ||
        (typeof profile.id === "string" && profile.id) ||
        (typeof doc._id === "string" ? doc._id : String(doc._id));
      const lastUsernameUpdatedAt =
        doc.lastUsernameUpdatedAt instanceof Date
          ? doc.lastUsernameUpdatedAt.toISOString()
          : null;
      return {
        id,
        username: profile.username ?? null,
        name: profile.name ?? null,
        profileImageUrl: profile.profileImageUrl ?? null,
        lastUsernameUpdatedAt,
      };
    });

    const primary = accounts[0];
    const primaryDoc = docs[0];

    return NextResponse.json(
      {
        connected: true,
        username: primary.username,
        name: primary.name,
        profileImageUrl: primary.profileImageUrl,
        expiresAt: primaryDoc.expiresAt ?? null,
        requestId,
        accounts,
      },
      { status: 200, headers: { "x-request-id": requestId } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = message.includes("timeout") ? 504 : 500;
    console.error("[integrations:x:status]", { requestId, stage, message });
    return NextResponse.json(
      { error: message, debug: { requestId, stage, elapsedMs: Date.now() - startedAt } },
      { status, headers: { "x-request-id": requestId } }
    );
  }
}

export async function DELETE(req: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let stage: string = "init";
  try {
    stage = "auth";
    const auth = await withTimeout(getUserFromRequest(req), 10_000, "auth_timeout");
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized", debug: { requestId, stage, elapsedMs: Date.now() - startedAt } },
        { status: 401, headers: { "x-request-id": requestId } }
      );
    }

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("id");

    stage = "db_connect";
    const db = await withTimeout(getMongoDb(), 15_000, "db_connect_timeout");
    const col = db.collection("social_accounts");

    stage = "db_delete";
    const filter: Record<string, unknown> = { userId: auth.user.id, provider: "twitter" };

    if (accountId) {
      const orConditions: Array<Record<string, unknown>> = [
        { providerAccountId: accountId },
        { "profile.id": accountId },
      ];

      if (ObjectId.isValid(accountId)) {
        orConditions.push({ _id: new ObjectId(accountId) });
      }

      filter.$or = orConditions;
    }

    await withTimeout(
      col.deleteMany(filter),
      10_000,
      "db_delete_timeout"
    );

    return NextResponse.json(
      { disconnected: true, requestId },
      { status: 200, headers: { "x-request-id": requestId } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = message.includes("timeout") ? 504 : 500;
    console.error("[integrations:x:disconnect]", { requestId, stage, message });
    return NextResponse.json(
      { error: message, debug: { requestId, stage, elapsedMs: Date.now() - startedAt } },
      { status, headers: { "x-request-id": requestId } }
    );
  }
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let stage: string = "init";
  try {
    stage = "auth";
    const auth = await withTimeout(getUserFromRequest(req), 10_000, "auth_timeout");
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized", debug: { requestId, stage, elapsedMs: Date.now() - startedAt } },
        { status: 401, headers: { "x-request-id": requestId } }
      );
    }

    stage = "parse_body";
    const body = await req.json().catch(() => null);
    const usernameField = (body as { username?: unknown })?.username;
    const rawUsername = typeof usernameField === "string" ? usernameField : "";
    const username = rawUsername.replace(/^@+/, "").trim();
    if (!username) {
      return NextResponse.json(
        { error: "Username is required", debug: { requestId, stage, elapsedMs: Date.now() - startedAt } },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    stage = "env";
    const bearer = (process.env.X_USER_LOOKUP_BEARER_TOKEN ?? "").toString().trim();
    if (!bearer) {
      return NextResponse.json(
        {
          error: "X user lookup token is not configured",
          debug: { requestId, stage, elapsedMs: Date.now() - startedAt },
        },
        { status: 500, headers: { "x-request-id": requestId } }
      );
    }

    stage = "x_fetch";
    const url = `https://api.x.com/2/users/by/username/${encodeURIComponent(
      username
    )}?user.fields=profile_image_url,name,username`;
    const xRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    });
    const xText = await xRes.text().catch(() => "");
    let xJson: TwitterUserLookupResponse | null = null;
    try {
      xJson = xText ? (JSON.parse(xText) as TwitterUserLookupResponse) : null;
    } catch {
      xJson = null;
    }

    const hasUserId = Boolean(xJson && xJson.data && xJson.data.id);
    if (!xRes.ok || !hasUserId) {
      console.error("[integrations:x:status:lookup]", {
        requestId,
        stage,
        status: xRes.status,
        body: xText ? xText.slice(0, 300) : "",
      });
      const message =
        xRes.status === 404
          ? "User not found on X"
          : "Failed to fetch user from X";
      return NextResponse.json(
        { error: message, debug: { requestId, stage, status: xRes.status } },
        {
          status: xRes.status === 404 ? 404 : 502,
          headers: { "x-request-id": requestId },
        }
      );
    }

    stage = "db_connect";
    const db = await withTimeout(getMongoDb(), 15_000, "db_connect_timeout");
    const col = db.collection("social_accounts");
    stage = "db_update";
    const now = new Date();
    const profile = {
      id: xJson?.data?.id ?? null,
      username: xJson?.data?.username ?? username,
      name: xJson?.data?.name ?? null,
      profileImageUrl: xJson?.data?.profile_image_url ?? null,
    };

    const providerAccountId = profile.id ? profile.id.toString() : null;

    const existingDocs = await withTimeout(
      col
        .find({ userId: auth.user.id, provider: "twitter" })
        .project({ _id: 1, providerAccountId: 1, profile: 1, lastUsernameUpdatedAt: 1 })
        .toArray(),
      10_000,
      "db_query_timeout"
    );

    let targetFilter: Record<string, unknown> | null = null;

    if (existingDocs.length === 1 && !providerAccountId) {
      targetFilter = { userId: auth.user.id, provider: "twitter", _id: existingDocs[0]._id };
    } else if (providerAccountId) {
      const byProviderAccount = existingDocs.find(
        (d) => typeof d.providerAccountId === "string" && d.providerAccountId === providerAccountId
      );
      if (byProviderAccount) {
        targetFilter = {
          userId: auth.user.id,
          provider: "twitter",
          _id: byProviderAccount._id,
        };
      } else {
        const byProfileId = existingDocs.find(
          (d) => d.profile && d.profile.id && d.profile.id === providerAccountId
        );
        if (byProfileId) {
          targetFilter = {
            userId: auth.user.id,
            provider: "twitter",
            _id: byProfileId._id,
          };
        }
      }
    }

    if (!targetFilter) {
      targetFilter = {
        userId: auth.user.id,
        provider: "twitter",
        providerAccountId: providerAccountId ?? null,
      };
    }

    const existing = existingDocs.find((d) => {
      if (!targetFilter) return false;
      if (targetFilter._id && d._id === targetFilter._id) return true;
      if (!targetFilter._id && providerAccountId && d.providerAccountId === providerAccountId) return true;
      return false;
    });

    if (existing && existing.lastUsernameUpdatedAt instanceof Date) {
      const last = existing.lastUsernameUpdatedAt.getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      if (now.getTime() - last < sevenDaysMs) {
        return NextResponse.json(
          {
            error: "Username can only be changed once every 7 days",
            debug: { requestId, stage: "rate_limited", elapsedMs: Date.now() - startedAt },
          },
          { status: 429, headers: { "x-request-id": requestId } }
        );
      }
    }

    await withTimeout(
      col.updateOne(
        targetFilter,
        {
          $set: {
            profile,
            updatedAt: now,
            providerAccountId: providerAccountId ?? null,
            lastUsernameUpdatedAt: now,
          },
          $setOnInsert: {
            userId: auth.user.id,
            provider: "twitter",
            createdAt: now,
          },
        },
        { upsert: true }
      ),
      10_000,
      "db_update_timeout"
    );

    return NextResponse.json(
      {
        success: true,
        username: profile.username,
        name: profile.name,
        profileImageUrl: profile.profileImageUrl,
        requestId,
      },
      { status: 200, headers: { "x-request-id": requestId } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = message.includes("timeout") ? 504 : 500;
    console.error("[integrations:x:status:lookup]", { requestId, stage, message });
    return NextResponse.json(
      { error: message, debug: { requestId, stage, elapsedMs: Date.now() - startedAt } },
      { status, headers: { "x-request-id": requestId } }
    );
  }
}
