import { getMongoDb } from "@/lib/mongodb";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";

type ScheduleStatus = "draft" | "scheduled" | "published";
type ScheduleType = "post" | "story" | "reel";

type ScheduleItemCommentDoc = {
  _id: string;
  authorId: string;
  content: string;
  createdAt: Date;
};

type ScheduleItemMediaDoc = {
  _id: string;
  kind: "image" | "video";
  url: string;
  durationSec?: number;
  createdAt: Date;
};

type ScheduleItemDoc = {
  _id: string;
  userId: string;
  personaId: string | null;
  content: string;
  status: ScheduleStatus;
  type: ScheduleType;
  accounts: string[];
  targetPlatform?: string | null;
  targetAccount?: string | null;
  viewUrl?: string | null;
  media?: ScheduleItemMediaDoc[];
  eventAt: Date | null;
  comments?: ScheduleItemCommentDoc[];
  createdAt: Date;
  updatedAt: Date;
};

function parseDateInput(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function parseDayInput(value: string | null): { start: Date; end: Date } | null {
  if (!value) return null;
  const start = new Date(`${value}T00:00:00`);
  const end = new Date(`${value}T23:59:59.999`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
}

function parseStatusList(value: string | null): ScheduleStatus[] | null {
  if (!value) return null;
  const raw = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed: ScheduleStatus[] = ["draft", "scheduled", "published"];
  const out = raw.filter((s): s is ScheduleStatus => (allowed as string[]).includes(s));
  return out.length > 0 ? out : null;
}

function parseTypeList(value: string | null): ScheduleType[] | null {
  if (!value) return null;
  const raw = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed: ScheduleType[] = ["post", "story", "reel"];
  const out = raw.filter((s): s is ScheduleType => (allowed as string[]).includes(s));
  return out.length > 0 ? out : null;
}

export async function GET(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const personaId = url.searchParams.get("personaId");

  const statusList = parseStatusList(url.searchParams.get("status"));
  const typeList = parseTypeList(url.searchParams.get("type"));

  const dayRange = parseDayInput(url.searchParams.get("day"));
  const from = parseDateInput(url.searchParams.get("from"));
  const to = parseDateInput(url.searchParams.get("to"));

  const filter: Record<string, unknown> = { userId: auth.user.id };
  if (personaId && personaId !== "all") filter.personaId = personaId;
  if (statusList) filter.status = { $in: statusList };
  if (typeList) filter.type = { $in: typeList };

  if (dayRange) {
    filter.eventAt = { $gte: dayRange.start, $lte: dayRange.end };
  } else if (from || to) {
    const range: Record<string, Date> = {};
    if (from) range.$gte = from;
    if (to) range.$lte = to;
    filter.eventAt = range;
  }

  const db = await getMongoDb();
  const docs = await db
    .collection<ScheduleItemDoc>("schedule_items")
    .find(filter)
    .sort({ eventAt: 1, createdAt: 1 })
    .toArray();

  return Response.json(
    docs.map((d) => ({
      id: d._id,
      user_id: d.userId,
      persona_id: d.personaId ?? null,
      content: d.content,
      status: d.status,
      type: d.type,
      accounts: d.accounts ?? [],
      target_platform: (d.targetPlatform ?? null) as string | null,
      target_account: (d.targetAccount ?? null) as string | null,
      view_url: (d.viewUrl ?? null) as string | null,
      media: (d.media ?? []).map((m) => ({
        id: m._id,
        kind: m.kind,
        url: m.url,
        duration_sec: m.durationSec ?? null,
        created_at: m.createdAt.toISOString(),
      })),
      event_at: d.eventAt ? d.eventAt.toISOString() : null,
      comments: (d.comments ?? []).map((c) => ({
        id: c._id,
        author_id: c.authorId,
        content: c.content,
        created_at: c.createdAt.toISOString(),
      })),
      created_at: d.createdAt.toISOString(),
      updated_at: d.updatedAt.toISOString(),
    }))
  );
}

export async function POST(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const payload = (body ?? {}) as Partial<{
    id: string;
    persona_id: string | null;
    content: string;
    status: ScheduleStatus;
    type: ScheduleType;
    accounts: string[];
    target_platform: string | null;
    target_account: string | null;
    view_url: string | null;
    media: Array<{ kind: "image" | "video"; url: string; duration_sec?: number | null }>;
    event_at: string | null;
  }>;

  const now = new Date();
  const content = (payload.content ?? "").toString();
  const status: ScheduleStatus =
    payload.status === "draft" || payload.status === "scheduled" || payload.status === "published"
      ? payload.status
      : "draft";
  const type: ScheduleType =
    payload.type === "story" || payload.type === "reel" || payload.type === "post" ? payload.type : "post";
  const accounts = Array.isArray(payload.accounts) ? payload.accounts.map((a) => a.toString()) : [];
  const targetPlatform = payload.target_platform === null || payload.target_platform === undefined ? null : payload.target_platform.toString();
  const targetAccount = payload.target_account === null || payload.target_account === undefined ? null : payload.target_account.toString();
  const viewUrl = payload.view_url === null || payload.view_url === undefined ? null : payload.view_url.toString();
  const mediaRaw = (payload.media ?? []) as unknown;
  const media: ScheduleItemMediaDoc[] = Array.isArray(mediaRaw)
    ? mediaRaw
        .map((m) => {
          const mo = (m ?? {}) as Record<string, unknown>;
          const kindRaw = String(mo.kind ?? "");
          const kind: ScheduleItemMediaDoc["kind"] = kindRaw === "video" ? "video" : "image";
          const url = String(mo.url ?? "");
          const durationRaw = mo.duration_sec;
          const durationSec = typeof durationRaw === "number" && Number.isFinite(durationRaw) ? durationRaw : undefined;
          if (!url) return null;
          return {
            _id: crypto.randomUUID(),
            kind,
            url,
            durationSec,
            createdAt: now,
          } as ScheduleItemMediaDoc;
        })
        .filter((m): m is ScheduleItemMediaDoc => Boolean(m))
    : [];

  const eventAt = payload.event_at ? parseDateInput(payload.event_at) : null;
  const personaId =
    payload.persona_id === null || payload.persona_id === undefined
      ? null
      : payload.persona_id.toString();

  if (!content.trim() && media.length === 0) return Response.json({ error: "Content is required" }, { status: 400 });
  if (status !== "draft" && !eventAt) {
    return Response.json({ error: "event_at is required for scheduled/published" }, { status: 400 });
  }
  if (status === "draft" && eventAt) {
    return Response.json({ error: "event_at must be null for draft" }, { status: 400 });
  }

  const id = (payload.id ?? crypto.randomUUID()).toString();

  const db = await getMongoDb();
  await db.collection<ScheduleItemDoc>("schedule_items").insertOne({
    _id: id,
    userId: auth.user.id,
    personaId,
    content,
    status,
    type,
    accounts,
    targetPlatform,
    targetAccount,
    viewUrl,
    media,
    eventAt: eventAt ?? null,
    comments: [],
    createdAt: now,
    updatedAt: now,
  });

  return Response.json({ id });
}
