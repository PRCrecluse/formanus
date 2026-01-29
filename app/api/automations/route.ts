import { getMongoDb } from "@/lib/mongodb";
import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import { syncAutomationScheduler, type AutomationDoc } from "@/lib/automationScheduler";

export const runtime = "nodejs";

type TodoItemPayload = {
  id: string;
  text: string;
  done: boolean;
};

type PreviewConfigDoc = {
  enabled: boolean;
  auto_confirm: boolean;
  confirm_timeout_seconds: number;
};

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeStringOrNull(value: unknown): string | null {
  const s = normalizeString(value);
  return s ? s : null;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
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

export async function GET(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getMongoDb();
  const docs = await db
    .collection<AutomationDoc>("automations")
    .find({ userId: auth.user.id })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  void syncAutomationScheduler().catch(() => null);

  return Response.json({ items: docs.map(toApi) });
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
  const payload = (body ?? {}) as Record<string, unknown>;

  const now = new Date();
  const id = crypto.randomUUID();
  const name = normalizeString(payload.name) || "New automation";
  const enabled = normalizeBoolean(payload.enabled, false);
  const cron = normalizeString(payload.cron) || "*/5 * * * *";
  const timezone = normalizeStringOrNull(payload.timezone);
  const webhookUrl = normalizeStringOrNull(payload.webhook_url);
  
  // 新增：预览配置
  let previewConfig: PreviewConfigDoc | null = null;
  if (payload.preview_config && typeof payload.preview_config === "object") {
    const cfg = payload.preview_config as Record<string, unknown>;
    previewConfig = {
      enabled: normalizeBoolean(cfg.enabled, false),
      auto_confirm: normalizeBoolean(cfg.auto_confirm, false),
      confirm_timeout_seconds: Number(cfg.confirm_timeout_seconds) || 10,
    };
  }

  const todos = normalizeTodos(payload.todos).map((t) => ({
    _id: normalizeString(t.id) || crypto.randomUUID(),
    text: t.text,
    done: Boolean(t.done),
    createdAt: now,
  }));

  const db = await getMongoDb();
  await db
    .collection<AutomationDoc & { previewConfig?: PreviewConfigDoc | null }>("automations")
    .insertOne({
    _id: id,
    userId: auth.user.id,
    name,
    enabled,
    cron,
    timezone,
    webhookUrl,
    previewConfig, // 存储预览配置
    todos,
    lastRunAt: null,
    lastRunOk: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    });

  void syncAutomationScheduler().catch(() => null);

  return Response.json({ id });
}
