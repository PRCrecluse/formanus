import { getMongoDb } from "@/lib/mongodb";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import { removeAutomationJob, syncAutomationScheduler, type AutomationDoc } from "@/lib/automationScheduler";

export const runtime = "nodejs";

type TodoItemPayload = {
  id: string;
  text: string;
  done: boolean;
};

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeStringOrNull(value: unknown): string | null {
  const s = normalizeString(value);
  return s ? s : null;
}

function normalizeTodos(value: unknown): TodoItemPayload[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null))
    .filter((v): v is Record<string, unknown> => Boolean(v))
    .map((v) => ({
      id: normalizeString(v.id) || crypto.randomUUID(),
      text: normalizeString(v.text),
      done: Boolean(v.done),
    }))
    .filter((t) => t.text.trim().length > 0);
}

function toApi(doc: AutomationDoc) {
  return {
    id: doc._id,
    user_id: doc.userId,
    name: doc.name,
    enabled: doc.enabled,
    cron: doc.cron,
    timezone: (doc.timezone ?? null) as string | null,
    webhook_url: (doc.webhookUrl ?? null) as string | null,
    todos: (doc.todos ?? []).map((t) => ({ id: t._id, text: t.text, done: t.done })),
    last_run_at: doc.lastRunAt ? doc.lastRunAt.toISOString() : null,
    last_run_ok: typeof doc.lastRunOk === "boolean" ? doc.lastRunOk : null,
    last_error: (doc.lastError ?? null) as string | null,
    created_at: doc.createdAt.toISOString(),
    updated_at: doc.updatedAt.toISOString(),
  };
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
  const payload = (body ?? {}) as Record<string, unknown>;

  const db = await getMongoDb();
  const doc = await db.collection<AutomationDoc>("automations").findOne({ _id: id, userId: auth.user.id });
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const update: Partial<AutomationDoc> & { updatedAt: Date } = { updatedAt: now };

  if (payload.name !== undefined) update.name = normalizeString(payload.name) || "Automation";
  if (payload.enabled !== undefined) update.enabled = Boolean(payload.enabled);
  if (payload.cron !== undefined) update.cron = normalizeString(payload.cron) || doc.cron || "*/5 * * * *";
  if (payload.timezone !== undefined) update.timezone = normalizeStringOrNull(payload.timezone);
  if (payload.webhook_url !== undefined) update.webhookUrl = normalizeStringOrNull(payload.webhook_url);
  if (payload.todos !== undefined) {
    const todos = normalizeTodos(payload.todos);
    update.todos = todos.map((t) => ({
      _id: normalizeString(t.id) || crypto.randomUUID(),
      text: t.text,
      done: Boolean(t.done),
      createdAt: now,
    }));
  }

  await db
    .collection<AutomationDoc>("automations")
    .updateOne({ _id: id, userId: auth.user.id }, { $set: update });

  const next = await db.collection<AutomationDoc>("automations").findOne({ _id: id, userId: auth.user.id });
  if (!next) return Response.json({ error: "Not found" }, { status: 404 });

  void syncAutomationScheduler().catch(() => null);

  return Response.json(toApi(next));
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getUserFromRequest(_req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await context.params;
  const id = decodeURIComponent(rawId);

  const db = await getMongoDb();
  await db.collection<AutomationDoc>("automations").deleteOne({ _id: id, userId: auth.user.id });

  removeAutomationJob(id);
  void syncAutomationScheduler().catch(() => null);

  return Response.json({ ok: true });
}
