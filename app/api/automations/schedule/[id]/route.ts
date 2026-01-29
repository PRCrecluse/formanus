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

function parseDateInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getUserFromRequest(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await context.params;
  const id = decodeURIComponent(rawId);

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const payload = (body ?? {}) as Partial<{
    persona_id: string | null;
    content: string;
    status: ScheduleStatus;
    type: ScheduleType;
    accounts: string[];
    event_at: string | null;
    comment: string;
    target_platform: string | null;
    target_account: string | null;
    view_url: string | null;
  }>;

  const now = new Date();
  const setUpdate: Partial<ScheduleItemDoc> & { updatedAt: Date } = { updatedAt: now };
  const commentText = payload.comment !== undefined ? payload.comment.toString() : null;
  const shouldAddComment = commentText !== null && commentText.trim().length > 0;

  if (payload.persona_id !== undefined) {
    setUpdate.personaId = payload.persona_id === null ? null : payload.persona_id.toString();
  }
  if (payload.content !== undefined) {
    const content = payload.content.toString();
    if (!content.trim()) return Response.json({ error: "Content is required" }, { status: 400 });
    setUpdate.content = content;
  }
  if (payload.type !== undefined) {
    if (payload.type !== "post" && payload.type !== "story" && payload.type !== "reel") {
      return Response.json({ error: "Invalid type" }, { status: 400 });
    }
    setUpdate.type = payload.type;
  }
  if (payload.accounts !== undefined) {
    if (!Array.isArray(payload.accounts)) return Response.json({ error: "Invalid accounts" }, { status: 400 });
    setUpdate.accounts = payload.accounts.map((a) => a.toString());
  }
  if (payload.status !== undefined) {
    if (payload.status !== "draft" && payload.status !== "scheduled" && payload.status !== "published") {
      return Response.json({ error: "Invalid status" }, { status: 400 });
    }
    setUpdate.status = payload.status;
  }
  if (payload.target_platform !== undefined) {
    setUpdate.targetPlatform = payload.target_platform === null ? null : payload.target_platform.toString();
  }
  if (payload.target_account !== undefined) {
    setUpdate.targetAccount = payload.target_account === null ? null : payload.target_account.toString();
  }
  if (payload.view_url !== undefined) {
    setUpdate.viewUrl = payload.view_url === null ? null : payload.view_url.toString();
  }
  if (payload.event_at !== undefined) {
    setUpdate.eventAt = payload.event_at === null ? null : parseDateInput(payload.event_at);
    if (payload.event_at !== null && !setUpdate.eventAt) {
      return Response.json({ error: "Invalid event_at" }, { status: 400 });
    }
  }

  if (setUpdate.status === "draft" && setUpdate.eventAt) {
    return Response.json({ error: "event_at must be null for draft" }, { status: 400 });
  }
  if ((setUpdate.status === "scheduled" || setUpdate.status === "published") && setUpdate.eventAt === null) {
    return Response.json({ error: "event_at is required for scheduled/published" }, { status: 400 });
  }

  const db = await getMongoDb();
  const updateOps: Record<string, unknown> = {};
  updateOps.$set = setUpdate;
  if (shouldAddComment) {
    updateOps.$push = {
      comments: {
        _id: crypto.randomUUID(),
        authorId: auth.user.id,
        content: commentText!.trim(),
        createdAt: now,
      },
    };
  }
  const res = await db.collection<ScheduleItemDoc>("schedule_items").findOneAndUpdate(
    { _id: id, userId: auth.user.id },
    updateOps,
    { returnDocument: "after" }
  );

  const doc = res ?? null;
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({
    id: doc._id,
    user_id: doc.userId,
    persona_id: doc.personaId ?? null,
    content: doc.content,
    status: doc.status,
    type: doc.type,
    accounts: doc.accounts ?? [],
    target_platform: (doc.targetPlatform ?? null) as string | null,
    target_account: (doc.targetAccount ?? null) as string | null,
    view_url: (doc.viewUrl ?? null) as string | null,
    media: (doc.media ?? []).map((m) => ({
      id: m._id,
      kind: m.kind,
      url: m.url,
      duration_sec: m.durationSec ?? null,
      created_at: m.createdAt.toISOString(),
    })),
    event_at: doc.eventAt ? doc.eventAt.toISOString() : null,
    comments: (doc.comments ?? []).map((c) => ({
      id: c._id,
      author_id: c.authorId,
      content: c.content,
      created_at: c.createdAt.toISOString(),
    })),
    created_at: doc.createdAt.toISOString(),
    updated_at: doc.updatedAt.toISOString(),
  });
}
