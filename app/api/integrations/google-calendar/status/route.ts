import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import { getMongoDb } from "@/lib/mongodb";
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

type ScheduleItemDoc = {
  _id: string;
  userId: string;
  personaId: string | null;
  content: string;
  status: "draft" | "scheduled" | "published";
  type: "post" | "story" | "reel";
  accounts: string[];
  eventAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

async function googleRequest<T>({
  token,
  method,
  url,
  body,
}: {
  token: string;
  method: "GET" | "POST" | "DELETE";
  url: string;
  body?: unknown;
}): Promise<{ ok: boolean; status: number; json: T | null; text: string }> {
  const res = await fetch(url, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  let json: T | null = null;
  try {
    json = text ? (JSON.parse(text) as T) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function refreshGoogleAccessToken({
  refreshToken,
}: {
  refreshToken: string;
}): Promise<{ accessToken: string | null; expiresAt: Date | null; scope: string | null; tokenType: string | null; error: string | null }> {
  const clientId = (process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "").toString().trim();
  const clientSecret = (process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "").toString().trim();
  if (!clientId || !clientSecret) return { accessToken: null, expiresAt: null, scope: null, tokenType: null, error: "missing_client_credentials" };

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text().catch(() => "");
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  const accessToken = json && typeof json.access_token === "string" ? json.access_token : null;
  const tokenType = json && typeof json.token_type === "string" ? json.token_type : null;
  const scope = json && typeof json.scope === "string" ? json.scope : null;
  const expiresIn = json && typeof json.expires_in === "number" ? json.expires_in : null;
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
  if (!res.ok || !accessToken) {
    const err = json && typeof json.error === "string" ? json.error : "refresh_failed";
    const errDesc = json && typeof json.error_description === "string" ? json.error_description : null;
    return { accessToken: null, expiresAt: null, scope: null, tokenType: null, error: errDesc || err };
  }
  return { accessToken, expiresAt, scope, tokenType, error: null };
}

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let stage = "init";
  try {
    const configured =
      (process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "").toString().trim().length > 0 &&
      (process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "").toString().trim().length > 0;

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
    const doc = await withTimeout(
      col.findOne({ userId: auth.user.id, provider: "google_calendar" }),
      10_000,
      "db_query_timeout"
    );

    if (!doc) {
      return NextResponse.json(
        {
          configured,
          connected: false,
          expiresAt: null,
          scope: null,
          calendarId: null,
          syncToEnabled: false,
          importEnabled: false,
          requestId,
        },
        { status: 200, headers: { "x-request-id": requestId } }
      );
    }

    const profile = (doc.profile ?? null) as { calendarId?: unknown; syncToEnabled?: unknown; importEnabled?: unknown } | null;
    return NextResponse.json(
      {
        configured,
        connected: true,
        expiresAt: doc.expiresAt ?? null,
        scope: doc.scope ?? null,
        calendarId: typeof profile?.calendarId === "string" ? profile.calendarId : null,
        syncToEnabled: Boolean(profile?.syncToEnabled),
        importEnabled: Boolean(profile?.importEnabled),
        requestId,
      },
      { status: 200, headers: { "x-request-id": requestId } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = message.includes("timeout") ? 504 : 500;
    console.error("[integrations:google-calendar:status]", { requestId, stage, message });
    return NextResponse.json(
      { error: message, debug: { requestId, stage, elapsedMs: Date.now() - startedAt } },
      { status, headers: { "x-request-id": requestId } }
    );
  }
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let stage = "init";
  try {
    const payload = await req.json().catch(() => null);
    const body = (payload ?? {}) as Record<string, unknown>;
    const action = (body.action ?? "").toString().trim();
    const enabled = Boolean(body.enabled);
    const modeRaw = (body.mode ?? "auto").toString().trim();
    const mode = modeRaw === "run_once" ? "run_once" : "auto";
    const runOnce = mode === "run_once";
    const calendarIdRaw = typeof body.calendarId === "string" ? body.calendarId : null;

    if (action !== "sync_to" && action !== "import_from") {
      console.error("[integrations:google-calendar:sync_action]", { requestId, stage: "validate", message: "Invalid action", action });
      return NextResponse.json({ error: "Invalid action", requestId }, { status: 400, headers: { "x-request-id": requestId } });
    }

    stage = "auth";
    const auth = await withTimeout(getUserFromRequest(req), 10_000, "auth_timeout");
    if (!auth) {
      console.error("[integrations:google-calendar:sync_action]", { requestId, stage, message: "Unauthorized" });
      return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401, headers: { "x-request-id": requestId } });
    }

    stage = "db_connect";
    const db = await withTimeout(getMongoDb(), 15_000, "db_connect_timeout");
    const socialCol = db.collection("social_accounts");
    stage = "db_query_account";
    const account = await withTimeout(
      socialCol.findOne({ userId: auth.user.id, provider: "google_calendar" }),
      10_000,
      "db_query_timeout"
    );

    const refreshToken = account && typeof account.refreshToken === "string" ? account.refreshToken : null;
    let accessToken = account && typeof account.accessToken === "string" ? account.accessToken : null;
    const expiresAt = account && account.expiresAt instanceof Date ? (account.expiresAt as Date) : null;
    const existingScope = account && typeof account.scope === "string" ? account.scope : null;
    const existingTokenType = account && typeof account.tokenType === "string" ? account.tokenType : null;

    if (!accessToken) {
      console.error("[integrations:google-calendar:sync_action]", { requestId, stage: "db_query_account", message: "Google Calendar is not connected" });
      return NextResponse.json({ error: "Google Calendar is not connected", requestId }, { status: 400, headers: { "x-request-id": requestId } });
    }

    const needsRefresh = expiresAt ? expiresAt.getTime() - Date.now() < 60_000 : false;
    if (needsRefresh && refreshToken) {
      stage = "token_refresh";
      const refreshed = await withTimeout(refreshGoogleAccessToken({ refreshToken }), 15_000, "token_refresh_timeout");
      if (refreshed.error || !refreshed.accessToken) {
        console.error("[integrations:google-calendar:sync] refresh_failed", { requestId, error: refreshed.error });
        return NextResponse.json({ error: "Failed to refresh Google token", requestId }, { status: 502, headers: { "x-request-id": requestId } });
      }
      accessToken = refreshed.accessToken;
      await withTimeout(
        socialCol.updateOne(
          { userId: auth.user.id, provider: "google_calendar" },
          {
            $set: {
              accessToken: refreshed.accessToken,
              expiresAt: refreshed.expiresAt,
              scope: refreshed.scope ?? existingScope ?? null,
              tokenType: refreshed.tokenType ?? existingTokenType ?? null,
              updatedAt: new Date(),
            },
          }
        ),
        10_000,
        "db_update_timeout"
      );
    }

    if (!enabled && !runOnce) {
      stage = "db_disable";
      await withTimeout(
        socialCol.updateOne(
          { userId: auth.user.id, provider: "google_calendar" },
          { $set: { [`profile.${action === "sync_to" ? "syncToEnabled" : "importEnabled"}`]: false, updatedAt: new Date() } }
        ),
        10_000,
        "db_update_timeout"
      );
      return NextResponse.json({ ok: true, enabled: false, requestId }, { status: 200, headers: { "x-request-id": requestId } });
    }

    const profile = (account?.profile ?? null) as Record<string, unknown> | null;
    let calendarId =
      (calendarIdRaw ?? (typeof profile?.calendarId === "string" ? (profile.calendarId as string) : null)) ?? null;

    if (!calendarId) {
      stage = "google_create_calendar";
      const createRes = await withTimeout(
        googleRequest<{ id?: unknown }>({
          token: accessToken,
          method: "POST",
          url: "https://www.googleapis.com/calendar/v3/calendars",
          body: { summary: "AI Persona Schedule" },
        }),
        20_000,
        "google_create_calendar_timeout"
      );
      calendarId = createRes.json && typeof createRes.json.id === "string" ? (createRes.json.id as string) : null;
      if (!createRes.ok || !calendarId) {
        console.error("[integrations:google-calendar:sync] create_calendar_failed", { requestId, status: createRes.status, body: createRes.text.slice(0, 800) });
        return NextResponse.json({ error: "Failed to create Google Calendar", requestId }, { status: 502, headers: { "x-request-id": requestId } });
      }
      await withTimeout(
        socialCol.updateOne(
          { userId: auth.user.id, provider: "google_calendar" },
          { $set: { "profile.calendarId": calendarId, updatedAt: new Date() } }
        ),
        10_000,
        "db_update_timeout"
      );
    }

    const now = new Date();
    const horizon = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    if (action === "sync_to") {
      stage = "google_delete_existing";
      const listUrl = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
      listUrl.searchParams.set("timeMin", now.toISOString());
      listUrl.searchParams.set("timeMax", horizon.toISOString());
      listUrl.searchParams.set("singleEvents", "true");
      listUrl.searchParams.set("maxResults", "2500");
      listUrl.searchParams.set("privateExtendedProperty", "aipersonaManaged=1");

      const existingRes = await withTimeout(
        googleRequest<{ items?: Array<{ id?: unknown }> }>({
          token: accessToken,
          method: "GET",
          url: listUrl.toString(),
        }),
        20_000,
        "google_list_timeout"
      );
      const existingIds =
        existingRes.json && Array.isArray(existingRes.json.items)
          ? existingRes.json.items
              .map((i) => (i && typeof i.id === "string" ? i.id : null))
              .filter((id): id is string => Boolean(id))
          : [];
      for (const id of existingIds) {
        const delUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`;
        const delRes = await withTimeout(
          googleRequest<Record<string, unknown>>({ token: accessToken, method: "DELETE", url: delUrl }),
          15_000,
          "google_delete_timeout"
        );
        if (!delRes.ok) {
          console.error("[integrations:google-calendar:sync] delete_event_failed", { requestId, status: delRes.status, body: delRes.text.slice(0, 500) });
        }
      }

      stage = "db_load_schedule";
      const scheduleCol = db.collection<ScheduleItemDoc>("schedule_items");
      const items = await withTimeout(
        scheduleCol
          .find({ userId: auth.user.id, status: "scheduled", eventAt: { $ne: null, $gte: now, $lte: horizon } })
          .sort({ eventAt: 1 })
          .toArray(),
        20_000,
        "db_query_schedule_timeout"
      );

      let synced = 0;
      for (const item of items) {
        const eventAt = item.eventAt instanceof Date ? item.eventAt : null;
        if (!eventAt) continue;
        const endAt = new Date(eventAt.getTime() + 30 * 60 * 1000);
        const createUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
        const createRes = await withTimeout(
          googleRequest<Record<string, unknown>>({
            token: accessToken,
            method: "POST",
            url: createUrl,
            body: {
              summary: (item.content ?? "").toString().slice(0, 100) || "Scheduled post",
              description: (item.content ?? "").toString().slice(0, 4000),
              start: { dateTime: eventAt.toISOString() },
              end: { dateTime: endAt.toISOString() },
              extendedProperties: { private: { aipersonaManaged: "1", aipersonaScheduleItemId: item._id } },
            },
          }),
          20_000,
          "google_create_event_timeout"
        );
        if (!createRes.ok) {
          console.error("[integrations:google-calendar:sync] create_event_failed", { requestId, status: createRes.status, body: createRes.text.slice(0, 800) });
          continue;
        }
        synced += 1;
      }

      if (!runOnce) {
        stage = "db_enable_sync";
        await withTimeout(
          socialCol.updateOne(
            { userId: auth.user.id, provider: "google_calendar" },
            { $set: { "profile.syncToEnabled": true, "profile.calendarId": calendarId, updatedAt: new Date() } }
          ),
          10_000,
          "db_update_timeout"
        );
      }
      return NextResponse.json(
        { ok: true, action, enabled: true, calendarId, synced, requestId },
        { status: 200, headers: { "x-request-id": requestId } }
      );
    }

    stage = "google_import_events";
    const listUrl = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    listUrl.searchParams.set("timeMin", now.toISOString());
    listUrl.searchParams.set("timeMax", horizon.toISOString());
    listUrl.searchParams.set("singleEvents", "true");
    listUrl.searchParams.set("maxResults", "2500");

    const eventsRes = await withTimeout(
      googleRequest<{
        items?: Array<{
          summary?: unknown;
          description?: unknown;
          start?: { dateTime?: unknown; date?: unknown } | null;
        }>;
      }>({ token: accessToken, method: "GET", url: listUrl.toString() }),
      20_000,
      "google_list_timeout"
    );
    if (!eventsRes.ok || !eventsRes.json || !Array.isArray(eventsRes.json.items)) {
      console.error("[integrations:google-calendar:import] list_failed", { requestId, status: eventsRes.status, body: eventsRes.text.slice(0, 800) });
      return NextResponse.json({ error: "Failed to list Google Calendar events", requestId }, { status: 502, headers: { "x-request-id": requestId } });
    }

    const scheduleCol = db.collection<ScheduleItemDoc>("schedule_items");
    let imported = 0;
    for (const ev of eventsRes.json.items) {
      const summary = ev && typeof ev.summary === "string" ? ev.summary : "";
      const description = ev && typeof ev.description === "string" ? ev.description : "";
      const start = (ev?.start ?? null) as Record<string, unknown> | null;
      const startDateTime = typeof start?.dateTime === "string" ? (start.dateTime as string) : null;
      const startDate = typeof start?.date === "string" ? (start.date as string) : null;
      const dateStr = startDateTime ?? (startDate ? `${startDate}T09:00:00.000Z` : null);
      if (!dateStr) continue;
      const eventAt = new Date(dateStr);
      if (!Number.isFinite(eventAt.getTime())) continue;

      const content = (description || summary || "").toString().trim();
      if (!content) continue;

      const exists = await withTimeout(
        scheduleCol.findOne({ userId: auth.user.id, content, status: "scheduled", eventAt }),
        10_000,
        "db_query_schedule_timeout"
      );
      if (exists) continue;

      await withTimeout(
        scheduleCol.insertOne({
          _id: crypto.randomUUID(),
          userId: auth.user.id,
          personaId: null,
          content,
          status: "scheduled",
          type: "post",
          accounts: [],
          eventAt,
          createdAt: now,
          updatedAt: now,
        }),
        15_000,
        "db_insert_timeout"
      );
      imported += 1;
    }

    if (!runOnce) {
      stage = "db_enable_import";
      await withTimeout(
        socialCol.updateOne(
          { userId: auth.user.id, provider: "google_calendar" },
          { $set: { "profile.importEnabled": true, "profile.calendarId": calendarId, updatedAt: new Date() } }
        ),
        10_000,
        "db_update_timeout"
      );
    }
    return NextResponse.json(
      { ok: true, action, enabled: true, calendarId, imported, requestId },
      { status: 200, headers: { "x-request-id": requestId } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = message.includes("timeout") ? 504 : 500;
    console.error("[integrations:google-calendar:sync_action]", { requestId, stage, message, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ error: message, requestId }, { status, headers: { "x-request-id": requestId } });
  }
}

export async function DELETE(req: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let stage = "init";
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
    stage = "db_delete";
    await withTimeout(col.deleteOne({ userId: auth.user.id, provider: "google_calendar" }), 10_000, "db_delete_timeout");

    return NextResponse.json({ disconnected: true, requestId }, { status: 200, headers: { "x-request-id": requestId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = message.includes("timeout") ? 504 : 500;
    console.error("[integrations:google-calendar:disconnect]", { requestId, stage, message });
    return NextResponse.json(
      { error: message, debug: { requestId, stage, elapsedMs: Date.now() - startedAt } },
      { status, headers: { "x-request-id": requestId } }
    );
  }
}
