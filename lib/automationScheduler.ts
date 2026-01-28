import { Cron } from "croner";
import { getMongoDb } from "@/lib/mongodb";
import type { Document } from "mongodb";

type TodoItemDoc = {
  _id: string;
  text: string;
  done: boolean;
  createdAt: Date;
};

export type AutomationDoc = Document & {
  _id: string;
  userId: string;
  name: string;
  enabled: boolean;
  cron: string;
  timezone?: string | null;
  webhookUrl?: string | null;
  todos?: TodoItemDoc[];
  lastRunAt?: Date | null;
  lastRunOk?: boolean | null;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type CronJob = InstanceType<typeof Cron>;

type SchedulerState = {
  jobs: Map<string, { signature: string; job: CronJob | null }>;
  syncing: Promise<void> | null;
};

const globalRef = globalThis as unknown as { __aipersona_automation_scheduler_state?: SchedulerState };

function getState(): SchedulerState {
  if (!globalRef.__aipersona_automation_scheduler_state) {
    globalRef.__aipersona_automation_scheduler_state = { jobs: new Map(), syncing: null };
  }
  return globalRef.__aipersona_automation_scheduler_state;
}

function normalizeStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function getSignature(a: AutomationDoc) {
  const cron = (a.cron ?? "").toString().trim();
  const tz = normalizeStringOrNull(a.timezone) ?? "";
  const webhook = normalizeStringOrNull(a.webhookUrl) ?? "";
  const enabled = a.enabled ? "1" : "0";
  return `${enabled}|${cron}|${tz}|${webhook}`;
}

function stopJob(job: CronJob | null) {
  try {
    job?.stop?.();
  } catch {
    return;
  }
}

async function executeAutomation(automation: AutomationDoc) {
  const webhookUrl = normalizeStringOrNull(automation.webhookUrl);
  if (!webhookUrl) throw new Error("Missing webhookUrl");

  const body = {
    automation_id: automation._id,
    user_id: automation.userId,
    name: automation.name,
    cron: automation.cron,
    timezone: normalizeStringOrNull(automation.timezone),
    todos: (automation.todos ?? []).map((t) => ({
      id: t._id,
      text: t.text,
      done: t.done,
    })),
    fired_at: new Date().toISOString(),
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const compact = text && text.length > 800 ? `${text.slice(0, 800)}…` : text;
    throw new Error(`Webhook failed (${res.status})${compact ? `: ${compact}` : ""}`);
  }
}

async function runAndPersist(automation: AutomationDoc) {
  const db = await getMongoDb();
  const now = new Date();
  try {
    await executeAutomation(automation);
    await db.collection<AutomationDoc>("automations").updateOne(
      { _id: automation._id },
      {
        $set: {
          lastRunAt: now,
          lastRunOk: true,
          lastError: null,
          updatedAt: now,
        },
      }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Execution failed";
    await db.collection<AutomationDoc>("automations").updateOne(
      { _id: automation._id },
      {
        $set: {
          lastRunAt: now,
          lastRunOk: false,
          lastError: message,
          updatedAt: now,
        },
      }
    );
    throw e;
  }
}

export async function syncAutomationScheduler(): Promise<void> {
  const state = getState();
  if (state.syncing) return state.syncing;
  state.syncing = (async () => {
    const db = await getMongoDb();
    const automationsCol = db.collection<AutomationDoc>("automations");
    const enabled = await automationsCol.find({ enabled: true }).toArray();

    const nextIds = new Set(enabled.map((a) => a._id));

    for (const [id, entry] of state.jobs.entries()) {
      if (!nextIds.has(id)) {
        stopJob(entry.job);
        state.jobs.delete(id);
      }
    }

    for (const a of enabled) {
      const signature = getSignature(a);
      const current = state.jobs.get(a._id);
      if (current && current.signature === signature) continue;
      if (current) stopJob(current.job);

      const cronExpr = (a.cron ?? "").toString().trim();
      const tz = normalizeStringOrNull(a.timezone);
      let job: CronJob | null = null;
      try {
        job = new Cron(cronExpr || "* * * * *", tz ? { timezone: tz } : undefined, async () => {
          try {
            const latest = await automationsCol.findOne({ _id: a._id });
            if (!latest || !latest.enabled) return;
            await runAndPersist(latest);
          } catch {
            return;
          }
        });
      } catch (e) {
        const now = new Date();
        const message = e instanceof Error ? e.message : "Invalid cron";
        await automationsCol.updateOne(
          { _id: a._id },
          { $set: { lastRunAt: now, lastRunOk: false, lastError: message, updatedAt: now } }
        );
        job = null;
      }

      state.jobs.set(a._id, { signature, job });
    }
  })().finally(() => {
    const s = getState();
    s.syncing = null;
  });

  return state.syncing;
}

export async function runAutomationOnce(id: string, userId?: string | null): Promise<void> {
  const db = await getMongoDb();
  const filter: Record<string, unknown> = { _id: id };
  if (userId) filter.userId = userId;
  const doc = await db.collection<AutomationDoc>("automations").findOne(filter);
  if (!doc) throw new Error("Not found");
  await runAndPersist(doc);
}
