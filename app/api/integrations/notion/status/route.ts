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

function extractNotionUuid(input: string) {
  const raw = (input ?? "").toString().trim();
  if (!raw) return null;
  const uuidMatch = raw.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (uuidMatch) return uuidMatch[0].toLowerCase();
  const compactMatch = raw.replace(/-/g, "").match(/[0-9a-fA-F]{32}/);
  if (!compactMatch) return null;
  const s = compactMatch[0].toLowerCase();
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function extractDataSourceIdFromDatabaseJson(json: Record<string, unknown> | null) {
  const dataSources = (json?.data_sources ?? null) as Array<Record<string, unknown>> | null;
  if (!Array.isArray(dataSources) || dataSources.length === 0) return null;
  const first = dataSources[0];
  const idRaw = first && typeof first.id === "string" ? (first.id as string) : "";
  return extractNotionUuid(idRaw);
}

function extractDatabaseIdFromDataSourceJson(json: Record<string, unknown> | null) {
  const dbParent = (json?.database_parent ?? null) as Record<string, unknown> | null;
  if (!dbParent) return null;
  const idRaw =
    (typeof dbParent.database_id === "string" ? dbParent.database_id : null) ??
    (typeof dbParent.id === "string" ? dbParent.id : null) ??
    null;
  return idRaw ? extractNotionUuid(idRaw) : null;
}

type NotionRequestArgs = {
  token: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
};

type NotionResponse<T> = { ok: boolean; status: number; json: T | null; text: string; retryAfterMs: number | null };

async function notionRequest<T>({
  token,
  method,
  path,
  body,
}: NotionRequestArgs): Promise<NotionResponse<T>> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": "2025-09-03",
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
  const retryAfterRaw = res.headers.get("retry-after");
  const retryAfterMs = retryAfterRaw && /^\d+(\.\d+)?$/.test(retryAfterRaw) ? Math.ceil(Number(retryAfterRaw) * 1000) : null;
  return { ok: res.ok, status: res.status, json, text, retryAfterMs };
}

async function notionRequestWithRetry<T>(
  args: NotionRequestArgs,
  opts?: { attempts?: number; minBackoffMs?: number; maxBackoffMs?: number }
): Promise<NotionResponse<T>> {
  const attempts = Math.max(1, opts?.attempts ?? 4);
  const minBackoffMs = Math.max(50, opts?.minBackoffMs ?? 600);
  const maxBackoffMs = Math.max(minBackoffMs, opts?.maxBackoffMs ?? 5000);
  let last = await notionRequest<T>(args);
  for (let i = 1; i < attempts; i += 1) {
    if (last.ok) return last;
    const retryable = last.status === 429 || last.status >= 500;
    if (!retryable) return last;
    const baseDelay = last.retryAfterMs ?? Math.min(maxBackoffMs, minBackoffMs * Math.pow(2, i - 1));
    const jitter = Math.floor(Math.random() * 250);
    const delayMs = Math.min(maxBackoffMs, baseDelay + jitter);
    await new Promise((r) => setTimeout(r, delayMs));
    last = await notionRequest<T>(args);
  }
  return last;
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

const PAST_SYNC_DAYS = 365;
const FUTURE_SYNC_DAYS = 365;

function normalizeScheduleStatus(value: string | null | undefined): ScheduleItemDoc["status"] {
  const raw = (value ?? "").toString().trim().toLowerCase();
  if (raw === "scheduled" || raw === "published") return raw;
  return "draft";
}

function normalizeScheduleType(value: string | null | undefined): ScheduleItemDoc["type"] {
  const raw = (value ?? "").toString().trim().toLowerCase();
  if (raw === "story" || raw === "reel") return raw;
  return "post";
}

function coerceEventDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (!value) return null;
  const d = new Date(value as string);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseDateInput(value: string) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatNotionDateFilterInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let stage = "init";
  try {
    const configured =
      (process.env.NOTION_CLIENT_ID ?? "").toString().trim().length > 0 &&
      (process.env.NOTION_CLIENT_SECRET ?? "").toString().trim().length > 0;
    const debugEnabled = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEBUG_INTEGRATIONS === "1";

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
    const doc = await withTimeout(col.findOne({ userId: auth.user.id, provider: "notion" }), 10_000, "db_query_timeout");

    if (!doc) {
      return NextResponse.json(
        {
          configured,
          connected: false,
          workspaceId: null,
          workspaceName: null,
          botId: null,
          syncToEnabled: false,
          importEnabled: false,
          parentPageId: null,
          databaseId: null,
          requestId,
        },
        { status: 200, headers: { "x-request-id": requestId } }
      );
    }

    const profile = (doc.profile ?? null) as
      | {
          workspaceId?: unknown;
          workspaceName?: unknown;
          botId?: unknown;
          botName?: unknown;
          botAvatarUrl?: unknown;
          syncToEnabled?: unknown;
          importEnabled?: unknown;
          parentPageId?: unknown;
          databaseId?: unknown;
        }
      | null;

    const accessToken = (() => {
      const v = (doc as unknown as Record<string, unknown> | null)?.accessToken;
      return typeof v === "string" ? v : null;
    })();
    let botAvatarUrl = typeof profile?.botAvatarUrl === "string" ? profile.botAvatarUrl : null;
    let botName = typeof profile?.botName === "string" ? profile.botName : null;

    if ((!botAvatarUrl || !botName) && accessToken) {
      stage = "notion_me";
      const meRes = await withTimeout(
        notionRequestWithRetry<Record<string, unknown>>({
          token: accessToken,
          method: "GET",
          path: "/users/me",
        }),
        8_000,
        "notion_me_timeout"
      );
      const fetchedAvatarUrl = meRes.json && typeof meRes.json.avatar_url === "string" ? (meRes.json.avatar_url as string) : null;
      const fetchedName = meRes.json && typeof meRes.json.name === "string" ? (meRes.json.name as string) : null;
      botAvatarUrl = botAvatarUrl ?? fetchedAvatarUrl;
      botName = botName ?? fetchedName;
      if (debugEnabled) {
        console.log("[integrations:notion:status] me", {
          requestId,
          ok: meRes.ok,
          status: meRes.status,
          hasAvatarUrl: Boolean(fetchedAvatarUrl),
          hasName: Boolean(fetchedName),
        });
        if (!meRes.ok) {
          console.log("[integrations:notion:status] me_body", { requestId, body: meRes.text ? meRes.text.slice(0, 500) : "" });
        }
      }
      if (meRes.ok && (fetchedAvatarUrl || fetchedName)) {
        stage = "db_update_profile";
        await withTimeout(
          col.updateOne(
            { userId: auth.user.id, provider: "notion" },
            { $set: { "profile.botAvatarUrl": fetchedAvatarUrl, "profile.botName": fetchedName, updatedAt: new Date() } }
          ),
          10_000,
          "db_update_timeout"
        );
      }
    }
    return NextResponse.json(
      {
        configured,
        connected: true,
        workspaceId: typeof profile?.workspaceId === "string" ? profile.workspaceId : null,
        workspaceName: typeof profile?.workspaceName === "string" ? profile.workspaceName : null,
        botId: typeof profile?.botId === "string" ? profile.botId : null,
        botName,
        botAvatarUrl,
        syncToEnabled: Boolean(profile?.syncToEnabled),
        importEnabled: Boolean(profile?.importEnabled),
        parentPageId: typeof profile?.parentPageId === "string" ? profile.parentPageId : null,
        databaseId: typeof profile?.databaseId === "string" ? profile.databaseId : null,
        requestId,
      },
      { status: 200, headers: { "x-request-id": requestId } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = message.includes("timeout") ? 504 : 500;
    console.error("[integrations:notion:status]", { requestId, stage, message });
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
    const parentPageIdRaw = typeof body.parentPageId === "string" ? body.parentPageId : null;
    const databaseIdRaw = typeof body.databaseId === "string" ? body.databaseId : null;

    if (action !== "sync_to" && action !== "import_from") {
      console.error("[integrations:notion:sync_action]", { requestId, stage: "validate", message: "Invalid action", action });
      return NextResponse.json({ error: "Invalid action", requestId }, { status: 400, headers: { "x-request-id": requestId } });
    }

    stage = "auth";
    const auth = await withTimeout(getUserFromRequest(req), 10_000, "auth_timeout");
    if (!auth) {
      console.error("[integrations:notion:sync_action]", { requestId, stage, message: "Unauthorized" });
      return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401, headers: { "x-request-id": requestId } });
    }

    stage = "db_connect";
    const db = await withTimeout(getMongoDb(), 15_000, "db_connect_timeout");
    const socialCol = db.collection("social_accounts");
    stage = "db_query_account";
    const account = await withTimeout(
      socialCol.findOne({ userId: auth.user.id, provider: "notion" }),
      10_000,
      "db_query_timeout"
    );
    const accessToken = account && typeof account.accessToken === "string" ? account.accessToken : null;
    if (!accessToken) {
      console.error("[integrations:notion:sync_action]", { requestId, stage: "db_query_account", message: "Notion is not connected" });
      return NextResponse.json({ error: "Notion is not connected", requestId }, { status: 400, headers: { "x-request-id": requestId } });
    }

    if (!enabled && !runOnce) {
      stage = "db_disable";
      await withTimeout(
        socialCol.updateOne(
          { userId: auth.user.id, provider: "notion" },
          { $set: { [`profile.${action === "sync_to" ? "syncToEnabled" : "importEnabled"}`]: false, updatedAt: new Date() } }
        ),
        10_000,
        "db_update_timeout"
      );
      return NextResponse.json({ ok: true, enabled: false, requestId }, { status: 200, headers: { "x-request-id": requestId } });
    }

    const profile = (account?.profile ?? null) as Record<string, unknown> | null;
    const existingParentPageIdRaw = typeof profile?.parentPageId === "string" ? (profile.parentPageId as string) : null;
    const storedIdRaw = typeof profile?.databaseId === "string" ? (profile.databaseId as string) : null;
    const parentPageIdFromBody = extractNotionUuid(parentPageIdRaw ?? "");
    const existingParentPageId = extractNotionUuid(existingParentPageIdRaw ?? "");
    const parentPageId = parentPageIdFromBody || existingParentPageId || null;

    const idFromBody = extractNotionUuid(databaseIdRaw ?? "");
    const storedId = extractNotionUuid(storedIdRaw ?? "");

    let candidateId = idFromBody || storedId || null;
    if (action === "sync_to" && parentPageIdFromBody && !idFromBody && existingParentPageId && existingParentPageId !== parentPageIdFromBody) {
      candidateId = null;
    }

    if (action === "import_from" && !candidateId) {
      console.error("[integrations:notion:sync_action]", {
        requestId,
        stage: "validate",
        message: "Missing Notion source data source / database",
        databaseIdRaw: databaseIdRaw ?? null,
        storedIdRaw,
      });
      return NextResponse.json(
        { error: "Missing Notion database. Provide databaseId.", requestId },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    let ensuredDataSourceId: string | null = null;
    let ensuredDatabaseId: string | null = null;
    let dbMetaJson: Record<string, unknown> | null = null;

    if (!candidateId) {
      if (!parentPageId) {
        console.error("[integrations:notion:sync_action]", {
          requestId,
          stage: "validate",
          message: "Missing Notion destination page",
          parentPageIdRaw: parentPageIdRaw ?? null,
          existingParentPageId,
        });
        return NextResponse.json(
          { error: "Missing Notion destination page. Provide parentPageId.", requestId },
          { status: 400, headers: { "x-request-id": requestId } }
        );
      }

      stage = "notion_create_database";
      const createRes = await withTimeout(
        notionRequestWithRetry<{ id?: unknown }>({
          token: accessToken,
          method: "POST",
          path: "/databases",
          body: {
            parent: { type: "page_id", page_id: parentPageId },
            title: [{ type: "text", text: { content: "AI Persona Schedule" } }],
            properties: {
              Name: { title: {} },
              Date: { date: {} },
              Status: {
                select: {
                  options: [
                    { name: "scheduled", color: "blue" },
                    { name: "published", color: "green" },
                    { name: "draft", color: "gray" },
                  ],
                },
              },
              Type: {
                select: {
                  options: [
                    { name: "post", color: "purple" },
                    { name: "story", color: "orange" },
                    { name: "reel", color: "yellow" },
                  ],
                },
              },
              Content: { rich_text: {} },
              "AIPersona ID": { rich_text: {} },
            },
          },
        }),
        20_000,
        "notion_create_database_timeout"
      );
      const createdIdRaw = createRes.json && typeof createRes.json.id === "string" ? (createRes.json.id as string) : null;
      ensuredDatabaseId = extractNotionUuid(createdIdRaw ?? "");
      if (!createRes.ok || !ensuredDatabaseId) {
        console.error("[integrations:notion:sync] create_database_failed", {
          requestId,
          status: createRes.status,
          body: createRes.text ? createRes.text.slice(0, 800) : "",
        });
        return NextResponse.json(
          { error: "Failed to create Notion database", requestId },
          { status: 502, headers: { "x-request-id": requestId } }
        );
      }

      stage = "notion_get_database";
      const dbMetaRes = await withTimeout(
        notionRequestWithRetry<Record<string, unknown>>({
          token: accessToken,
          method: "GET",
          path: `/databases/${ensuredDatabaseId}`,
        }),
        20_000,
        "notion_get_database_timeout"
      );
      dbMetaJson = dbMetaRes.ok && dbMetaRes.json ? (dbMetaRes.json as Record<string, unknown>) : null;
      ensuredDataSourceId = extractDataSourceIdFromDatabaseJson(dbMetaJson);
      if (!ensuredDataSourceId) {
        console.error("[integrations:notion:sync] missing_data_source", {
          requestId,
          databaseId: ensuredDatabaseId,
          status: dbMetaRes.status,
          body: dbMetaRes.text.slice(0, 800),
        });
        return NextResponse.json(
          { error: "Failed to resolve Notion data source", requestId },
          { status: 502, headers: { "x-request-id": requestId } }
        );
      }
    } else {
      stage = "notion_get_data_source";
      const dsRes = await withTimeout(
        notionRequestWithRetry<Record<string, unknown>>({
          token: accessToken,
          method: "GET",
          path: `/data_sources/${candidateId}`,
        }),
        12_000,
        "notion_get_data_source_timeout"
      );
      if (dsRes.ok && dsRes.json) {
        ensuredDataSourceId = candidateId;
        ensuredDatabaseId = extractDatabaseIdFromDataSourceJson(dsRes.json as Record<string, unknown>);
      } else {
        stage = "notion_get_database";
        const dbRes = await withTimeout(
          notionRequestWithRetry<Record<string, unknown>>({
            token: accessToken,
            method: "GET",
            path: `/databases/${candidateId}`,
          }),
          20_000,
          "notion_get_database_timeout"
        );
        if (!dbRes.ok || !dbRes.json) {
          console.error("[integrations:notion:sync_action] invalid_target", {
            requestId,
            candidateId,
            status: dbRes.status,
            body: dbRes.text.slice(0, 800),
          });
          return NextResponse.json(
            { error: "Invalid Notion database. Please provide a database URL or ID.", requestId },
            { status: 400, headers: { "x-request-id": requestId } }
          );
        }
        ensuredDatabaseId = candidateId;
        dbMetaJson = dbRes.json as Record<string, unknown>;
        ensuredDataSourceId = extractDataSourceIdFromDatabaseJson(dbMetaJson);
        if (!ensuredDataSourceId) {
          console.error("[integrations:notion:sync_action] missing_data_source", { requestId, candidateId });
          return NextResponse.json(
            { error: "Invalid Notion database. Please provide a database URL or ID.", requestId },
            { status: 400, headers: { "x-request-id": requestId } }
          );
        }
      }
    }

    stage = "db_persist_targets";
    await withTimeout(
      socialCol.updateOne(
        { userId: auth.user.id, provider: "notion" },
        {
          $set: {
            "profile.parentPageId": parentPageId ?? null,
            "profile.databaseId": ensuredDataSourceId,
            updatedAt: new Date(),
          },
        }
      ),
      10_000,
      "db_update_timeout"
    );

    if (action === "sync_to" && ensuredDatabaseId) {
      stage = "notion_ensure_schema";
      const existingProperties = ((dbMetaJson?.properties ?? null) as Record<string, unknown> | null) ?? null;
      const propertiesToCheck = existingProperties
        ? existingProperties
        : (
            (await withTimeout(
              notionRequestWithRetry<{ properties?: Record<string, unknown> }>({
                token: accessToken,
                method: "GET",
                path: `/databases/${ensuredDatabaseId}`,
              }),
              20_000,
              "notion_get_database_timeout"
            )).json?.properties ?? {}
          );

      const ensureProps: Record<string, unknown> = {};
      if (!Object.prototype.hasOwnProperty.call(propertiesToCheck, "Name")) ensureProps.Name = { title: {} };
      if (!Object.prototype.hasOwnProperty.call(propertiesToCheck, "Date")) ensureProps.Date = { date: {} };
      if (!Object.prototype.hasOwnProperty.call(propertiesToCheck, "Status")) {
        ensureProps.Status = {
          select: {
            options: [
              { name: "scheduled", color: "blue" },
              { name: "published", color: "green" },
              { name: "draft", color: "gray" },
            ],
          },
        };
      }
      if (!Object.prototype.hasOwnProperty.call(propertiesToCheck, "Type")) {
        ensureProps.Type = {
          select: {
            options: [
              { name: "post", color: "purple" },
              { name: "story", color: "orange" },
              { name: "reel", color: "yellow" },
            ],
          },
        };
      }
      if (!Object.prototype.hasOwnProperty.call(propertiesToCheck, "Content")) ensureProps.Content = { rich_text: {} };
      if (!Object.prototype.hasOwnProperty.call(propertiesToCheck, "AIPersona ID")) ensureProps["AIPersona ID"] = { rich_text: {} };

      if (Object.keys(ensureProps).length > 0) {
        const updateRes = await withTimeout(
          notionRequestWithRetry<Record<string, unknown>>({
            token: accessToken,
            method: "PATCH",
            path: `/databases/${ensuredDatabaseId}`,
            body: { properties: ensureProps },
          }),
          20_000,
          "notion_update_database_timeout"
        );
        if (!updateRes.ok) {
          console.error("[integrations:notion:sync] update_database_failed", {
            requestId,
            status: updateRes.status,
            body: updateRes.text.slice(0, 800),
          });
          return NextResponse.json(
            { error: "Failed to update Notion database", requestId },
            { status: 502, headers: { "x-request-id": requestId } }
          );
        }
      }
    }

    if (action === "sync_to") {
      stage = "db_load_schedule";
      const scheduleCol = db.collection<ScheduleItemDoc>("schedule_items");
      const now = new Date();
      const past = new Date(now.getTime() - PAST_SYNC_DAYS * 24 * 60 * 60 * 1000);
      const future = new Date(now.getTime() + FUTURE_SYNC_DAYS * 24 * 60 * 60 * 1000);
      const pastFilter = formatNotionDateFilterInput(past);
      const futureFilter = formatNotionDateFilterInput(future);
      const items = await withTimeout(
        scheduleCol
          .find({
            userId: auth.user.id,
            status: { $in: ["scheduled", "published"] },
            eventAt: { $ne: null, $gte: past, $lte: future },
          })
          .sort({ eventAt: 1 })
          .toArray(),
        20_000,
        "db_query_schedule_timeout"
      );

      stage = "notion_existing_pages";
      const existingPageByAipersonaId = new Map<string, string>();
      {
        const queryParams = new URLSearchParams();
        for (const prop of ["AIPersona ID", "Date", "Content", "Name", "Status", "Type"]) queryParams.append("filter_properties[]", prop);
        const queryPath = `/data_sources/${ensuredDataSourceId}/query?${queryParams.toString()}`;
        let cursor: string | null = null;
        let pages = 0;
        while (pages < 10) {
          const listRes: NotionResponse<{
            results?: Array<{ id?: unknown; properties?: Record<string, unknown> }>;
            has_more?: unknown;
            next_cursor?: unknown;
          }> = await withTimeout(
            notionRequestWithRetry<{
              results?: Array<{ id?: unknown; properties?: Record<string, unknown> }>;
              has_more?: unknown;
              next_cursor?: unknown;
            }>({
              token: accessToken,
              method: "POST",
              path: queryPath,
              body: {
                page_size: 100,
                ...(cursor ? { start_cursor: cursor } : {}),
                filter: {
                  property: "Date",
                  date: {
                    on_or_after: pastFilter,
                    on_or_before: futureFilter,
                  },
                },
                sorts: [{ property: "Date", direction: "ascending" }],
              },
            }),
            20_000,
            "notion_query_timeout"
          );
          if (!listRes.ok || !listRes.json || !Array.isArray(listRes.json.results)) break;
          for (const row of listRes.json.results) {
            const pageIdRaw = typeof row.id === "string" ? row.id : null;
            const pageId = extractNotionUuid(pageIdRaw ?? "");
            if (!pageId) continue;
            const props = (row.properties ?? {}) as Record<string, unknown>;
            const idProp = (props["AIPersona ID"] ?? null) as Record<string, unknown> | null;
            const richText = (idProp?.rich_text ?? null) as Array<Record<string, unknown>> | null;
            const aipersonaId =
              Array.isArray(richText) && typeof richText[0]?.plain_text === "string"
                ? (richText[0].plain_text as string).trim()
                : "";
            if (!aipersonaId) continue;
            existingPageByAipersonaId.set(aipersonaId, pageId);
          }
          const hasMore = Boolean(listRes.json.has_more);
          const nextCursor: string | null = typeof listRes.json.next_cursor === "string" ? (listRes.json.next_cursor as string) : null;
          if (!hasMore || !nextCursor) break;
          cursor = nextCursor;
          pages += 1;
        }
      }

      let synced = 0;
      for (const item of items) {
        const eventAt = coerceEventDate(item.eventAt);
        if (!eventAt) continue;
        stage = "notion_upsert_page";
        const existingPageId = existingPageByAipersonaId.get(item._id) ?? null;
        const contentText = (item.content ?? "").toString().slice(0, 1800);
        const statusName = normalizeScheduleStatus(item.status);
        const typeName = normalizeScheduleType(item.type);
        const props = {
          Name: { title: [{ type: "text", text: { content: contentText.slice(0, 100) || "Scheduled item" } }] },
          Date: { date: { start: eventAt.toISOString() } },
          Status: { select: { name: statusName } },
          Type: { select: { name: typeName } },
          Content: { rich_text: contentText ? [{ type: "text", text: { content: contentText } }] : [] },
          "AIPersona ID": { rich_text: [{ type: "text", text: { content: item._id } }] },
        };

        if (existingPageId) {
          const patchRes = await withTimeout(
            notionRequestWithRetry<Record<string, unknown>>({
              token: accessToken,
              method: "PATCH",
              path: `/pages/${existingPageId}`,
              body: { properties: props },
            }),
            20_000,
            "notion_patch_timeout"
          );
          if (!patchRes.ok) {
            console.error("[integrations:notion:sync] patch_failed", { requestId, status: patchRes.status, body: patchRes.text.slice(0, 800) });
            continue;
          }
          synced += 1;
          continue;
        }

        const createPageRes = await withTimeout(
          notionRequestWithRetry<Record<string, unknown>>({
            token: accessToken,
            method: "POST",
            path: "/pages",
            body: {
              parent: { type: "data_source_id", data_source_id: ensuredDataSourceId },
              properties: props,
            },
          }),
          20_000,
          "notion_create_page_timeout"
        );
        if (!createPageRes.ok) {
          console.error("[integrations:notion:sync] create_page_failed", { requestId, status: createPageRes.status, body: createPageRes.text.slice(0, 800) });
          continue;
        }
        const createdPageIdRaw = createPageRes.json && typeof createPageRes.json.id === "string" ? (createPageRes.json.id as string) : null;
        const createdPageId = extractNotionUuid(createdPageIdRaw ?? "");
        if (createdPageId) existingPageByAipersonaId.set(item._id, createdPageId);
        synced += 1;
      }

      if (!runOnce) {
        stage = "db_enable_sync";
        await withTimeout(
          socialCol.updateOne(
            { userId: auth.user.id, provider: "notion" },
            { $set: { "profile.syncToEnabled": true, updatedAt: new Date() } }
          ),
          10_000,
          "db_update_timeout"
        );
      }
      return NextResponse.json(
        { ok: true, action, enabled: true, databaseId: ensuredDataSourceId, synced, requestId },
        { status: 200, headers: { "x-request-id": requestId } }
      );
    }

    stage = "notion_import_validate_data_source";
    const validateDsRes = await withTimeout(
      notionRequestWithRetry<Record<string, unknown>>({
        token: accessToken,
        method: "GET",
        path: `/data_sources/${ensuredDataSourceId}`,
      }),
      12_000,
      "notion_validate_data_source_timeout"
    );
    if (!validateDsRes.ok) {
      console.error("[integrations:notion:import] invalid_data_source", {
        requestId,
        status: validateDsRes.status,
        body: validateDsRes.text.slice(0, 800),
      });
      return NextResponse.json(
        { error: "Invalid Notion database. Please provide a database URL or ID.", requestId },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    stage = "notion_import_query";
    const scheduleCol = db.collection<ScheduleItemDoc>("schedule_items");
    const rows: Array<{ id?: unknown; properties?: Record<string, unknown> }> = [];
    {
      const now = new Date();
      const past = new Date(now.getTime() - PAST_SYNC_DAYS * 24 * 60 * 60 * 1000);
      const future = new Date(now.getTime() + FUTURE_SYNC_DAYS * 24 * 60 * 60 * 1000);
      const pastFilter = formatNotionDateFilterInput(past);
      const futureFilter = formatNotionDateFilterInput(future);
      const queryParams = new URLSearchParams();
      for (const prop of ["AIPersona ID", "Date", "Content", "Name", "Status", "Type"]) queryParams.append("filter_properties[]", prop);
      const queryPath = `/data_sources/${ensuredDataSourceId}/query?${queryParams.toString()}`;
      let cursor: string | null = null;
      let pages = 0;
      while (pages < 10) {
        const listRes: NotionResponse<{
          results?: Array<{
            id?: unknown;
            properties?: Record<string, unknown>;
          }>;
          has_more?: unknown;
          next_cursor?: unknown;
        }> = await withTimeout(
          notionRequestWithRetry<{
            results?: Array<{
              id?: unknown;
              properties?: Record<string, unknown>;
            }>;
            has_more?: unknown;
            next_cursor?: unknown;
          }>({
            token: accessToken,
            method: "POST",
            path: queryPath,
            body: {
              page_size: 100,
              ...(cursor ? { start_cursor: cursor } : {}),
              filter: {
                property: "Date",
                date: {
                  on_or_after: pastFilter,
                  on_or_before: futureFilter,
                },
              },
              sorts: [{ property: "Date", direction: "ascending" }],
            },
          }),
          20_000,
          "notion_query_timeout"
        );
        if (!listRes.ok || !listRes.json || !Array.isArray(listRes.json.results)) {
          console.error("[integrations:notion:import] query_failed", { requestId, status: listRes.status, body: listRes.text.slice(0, 800) });
          return NextResponse.json({ error: "Failed to query Notion database", requestId }, { status: 502, headers: { "x-request-id": requestId } });
        }
        rows.push(...listRes.json.results);
        const hasMore = Boolean(listRes.json.has_more);
        const nextCursor: string | null = typeof listRes.json.next_cursor === "string" ? (listRes.json.next_cursor as string) : null;
        if (!hasMore || !nextCursor) break;
        cursor = nextCursor;
        pages += 1;
      }
    }

    const now = new Date();
    let imported = 0;
    for (const row of rows) {
      const props = (row.properties ?? {}) as Record<string, unknown>;
      const dateProp = (props.Date ?? null) as Record<string, unknown> | null;
      const dateValue = (dateProp?.date ?? null) as Record<string, unknown> | null;
      const start = typeof dateValue?.start === "string" ? dateValue.start : null;
      const eventAt = start ? parseDateInput(start) : null;
      if (!eventAt) continue;

      const contentProp = (props.Content ?? null) as Record<string, unknown> | null;
      const richText = (contentProp?.rich_text ?? null) as Array<Record<string, unknown>> | null;
      const contentFromRichText =
        Array.isArray(richText) && typeof richText[0]?.plain_text === "string" ? (richText[0].plain_text as string) : "";

      const nameProp = (props.Name ?? null) as Record<string, unknown> | null;
      const title = (nameProp?.title ?? null) as Array<Record<string, unknown>> | null;
      const contentFromTitle =
        Array.isArray(title) && typeof title[0]?.plain_text === "string" ? (title[0].plain_text as string) : "";

      const content = (contentFromRichText || contentFromTitle).trim();
      if (!content) continue;

      const statusProp = (props.Status ?? null) as Record<string, unknown> | null;
      const statusSelect = (statusProp?.select ?? null) as Record<string, unknown> | null;
      const statusName = typeof statusSelect?.name === "string" ? (statusSelect.name as string) : null;
      const status = normalizeScheduleStatus(statusName);

      const typeProp = (props.Type ?? null) as Record<string, unknown> | null;
      const typeSelect = (typeProp?.select ?? null) as Record<string, unknown> | null;
      const typeName = typeof typeSelect?.name === "string" ? (typeSelect.name as string) : null;
      const type = normalizeScheduleType(typeName);

      const exists = await withTimeout(
        scheduleCol.findOne({ userId: auth.user.id, content, status, eventAt }),
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
          status,
          type,
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
          { userId: auth.user.id, provider: "notion" },
          { $set: { "profile.importEnabled": true, updatedAt: new Date() } }
        ),
        10_000,
        "db_update_timeout"
      );
    }
    return NextResponse.json(
      { ok: true, action, enabled: true, databaseId: ensuredDataSourceId, imported, requestId },
      { status: 200, headers: { "x-request-id": requestId } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = message.includes("timeout") ? 504 : 500;
    console.error("[integrations:notion:sync_action]", { requestId, stage, message, elapsedMs: Date.now() - startedAt });
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
    await withTimeout(col.deleteOne({ userId: auth.user.id, provider: "notion" }), 10_000, "db_delete_timeout");

    return NextResponse.json({ disconnected: true, requestId }, { status: 200, headers: { "x-request-id": requestId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = message.includes("timeout") ? 504 : 500;
    console.error("[integrations:notion:disconnect]", { requestId, stage, message });
    return NextResponse.json(
      { error: message, debug: { requestId, stage, elapsedMs: Date.now() - startedAt } },
      { status, headers: { "x-request-id": requestId } }
    );
  }
}
