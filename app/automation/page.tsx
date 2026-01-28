"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2, Play, Plus, Settings, Trash2, X } from "lucide-react";
import { getMembershipStatusWithTimeout, getSessionWithTimeout, isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

type TodoItem = {
  id: string;
  text: string;
  done: boolean;
};

type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  cron: string;
  timezone: string | null;
  webhook_url: string | null;
  todos: TodoItem[];
  last_run_at: string | null;
  last_run_ok: boolean | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type ScheduleKind = "every_n_days" | "weekly";

type ScheduleDraft = {
  kind: ScheduleKind;
  everyDays: number;
  weekday: number;
  hour: number;
  minute: number;
  timezone: string;
};

type BlockKind = "send_message" | "file_reference" | "add_text_to_platform" | "save_to_place" | "post_to_social_media";

type BlockConfig = {
  id: string;
  kind: BlockKind;
  message?: string;
  model?: string;
  platform?: string;
  place?: string;
  placeScope?: "Draft" | "Workspace";
  socialAccount?: string;
};

type BlocksTodoPayload = {
  version: "blocks_v1";
  blocks: BlockConfig[];
};

type ModelOption = {
  id: string;
  name: string;
};

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBlocksPayload(raw: string): BlocksTodoPayload | null {
  const parsed = safeJsonParse(raw);
  if (!isRecord(parsed)) return null;
  if (parsed.version !== "blocks_v1") return null;
  const blocksRaw = parsed.blocks;
  if (!Array.isArray(blocksRaw)) return null;
  const blocks: BlockConfig[] = [];
  for (const item of blocksRaw) {
    if (!isRecord(item)) continue;
    const kind = item.kind;
    if (
      kind !== "send_message" &&
      kind !== "file_reference" &&
      kind !== "add_text_to_platform" &&
      kind !== "save_to_place" &&
      kind !== "post_to_social_media"
    ) {
      continue;
    }
    const id = typeof item.id === "string" && item.id ? item.id : crypto.randomUUID();
    const message = typeof item.message === "string" ? item.message : "";
    const model = typeof item.model === "string" ? item.model : "";
    const platform = typeof item.platform === "string" ? item.platform : "Notion";
    const place = typeof item.place === "string" ? item.place : "";
    const placeScope =
      item.placeScope === "Draft" || item.placeScope === "Workspace" ? item.placeScope : "Workspace";
    const socialAccount = typeof item.socialAccount === "string" ? item.socialAccount : "";
    blocks.push({
      id,
      kind,
      message,
      model,
      platform,
      place,
      placeScope,
      socialAccount,
    });
  }
  if (!blocks.length) return null;
  return { version: "blocks_v1", blocks };
}

function createDefaultBlocks(): BlockConfig[] {
  return [
    {
      id: crypto.randomUUID(),
      kind: "send_message",
      message: "",
      model: "",
    },
  ];
}

function loadBlocksFromAutomation(a: Automation): BlockConfig[] {
  const first = (a.todos ?? [])[0];
  if (first && typeof first.text === "string" && first.text.trim()) {
    const payload = parseBlocksPayload(first.text);
    if (payload) return payload.blocks;
  }
  return createDefaultBlocks();
}

function buildBlocksTodoText(blocks: BlockConfig[]): string {
  const payload: BlocksTodoPayload = {
    version: "blocks_v1",
    blocks,
  };
  return JSON.stringify(payload);
}

async function apiRequest<T>(token: string, input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text().catch(() => "");
  const parsed = text ? safeJsonParse(text) : null;
  const json = isRecord(parsed) ? parsed : null;
  if (!res.ok) {
    const msg =
      (json && typeof json.error === "string" && json.error) ||
      (typeof text === "string" && text.trim()) ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return (json as unknown) as T;
}

function formatLastRun(a: Automation) {
  if (!a.last_run_at) return "—";
  const d = new Date(a.last_run_at);
  if (Number.isNaN(d.getTime())) return a.last_run_at;
  return d.toLocaleString();
}

function getStatusLabel(a: Automation) {
  if (a.last_run_ok === null) return "—";
  return a.last_run_ok ? "OK" : "Error";
}

function buildPayloadPreview(a: Automation) {
  return {
    automation_id: a.id,
    name: a.name,
    cron: a.cron,
    timezone: a.timezone,
    todos: (a.todos ?? []).map((t) => ({ id: t.id, text: t.text, done: t.done })),
    fired_at: new Date().toISOString(),
  };
}

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function clampInt(v: number, min: number, max: number) {
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

function buildCronFromDraft(d: ScheduleDraft) {
  const minute = clampInt(d.minute, 0, 59);
  const hour = clampInt(d.hour, 0, 23);

  if (d.kind === "weekly") {
    const weekday = clampInt(d.weekday, 0, 6);
    return `${minute} ${hour} * * ${weekday}`;
  }

  const every = clampInt(d.everyDays, 1, 31);
  return `${minute} ${hour} */${every} * *`;
}

function initScheduleDraft(a: Automation): ScheduleDraft {
  const localTz = getLocalTimezone();
  const timezone = a.timezone?.trim() ? a.timezone.trim() : localTz;
  const cron = (a.cron || "").trim();

  const daily = cron.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\/(\d{1,2})\s+\*\s+\*$/);
  if (daily) {
    return {
      kind: "every_n_days",
      minute: clampInt(Number(daily[1]), 0, 59),
      hour: clampInt(Number(daily[2]), 0, 23),
      everyDays: clampInt(Number(daily[3]), 1, 31),
      weekday: 1,
      timezone,
    };
  }

  const weekly = cron.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+(\d{1,2})$/);
  if (weekly) {
    const weekday = clampInt(Number(weekly[3]), 0, 6);
    return {
      kind: "weekly",
      minute: clampInt(Number(weekly[1]), 0, 59),
      hour: clampInt(Number(weekly[2]), 0, 23),
      everyDays: 1,
      weekday,
      timezone,
    };
  }

  return {
    kind: "every_n_days",
    minute: 0,
    hour: 9,
    everyDays: 1,
    weekday: 1,
    timezone,
  };
}

export default function AutomationPage() {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [blocksByAutomation, setBlocksByAutomation] = useState<Record<string, BlockConfig[]>>({});
  const [scheduleByAutomation, setScheduleByAutomation] = useState<Record<string, ScheduleDraft>>({});
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [pendingAddKindByAutomation, setPendingAddKindByAutomation] = useState<Record<string, BlockKind | "">>({});
  const [testPanelAutomationId, setTestPanelAutomationId] = useState<string | null>(null);
  const [testPanelHeight, setTestPanelHeight] = useState(360);
  const testPanelDragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const handleTestPanelDragMove = useCallback((event: PointerEvent) => {
    const state = testPanelDragStateRef.current;
    if (!state) return;
    const delta = state.startY - event.clientY;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight || 0 : 0;
    const maxHeight = viewportHeight > 0 ? viewportHeight - 80 : 600;
    const minHeight = 240;
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, state.startHeight + delta));
    setTestPanelHeight(nextHeight);
  }, []);

  const handleTestPanelDragEnd = useCallback(() => {
    testPanelDragStateRef.current = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("pointermove", handleTestPanelDragMove);
      window.removeEventListener("pointerup", handleTestPanelDragEnd);
    }
  }, [handleTestPanelDragMove]);

  const openUpgradeModal = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("aipersona:open-upgrade"));
  }, []);

  const handleTestPanelDragStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (typeof window === "undefined") return;
      testPanelDragStateRef.current = { startY: event.clientY, startHeight: testPanelHeight };
      window.addEventListener("pointermove", handleTestPanelDragMove);
      window.addEventListener("pointerup", handleTestPanelDragEnd);
    },
    [handleTestPanelDragEnd, handleTestPanelDragMove, testPanelHeight]
  );

  const canUseSupabase = isSupabaseConfigured;

  const loadAutomations = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      if (!canUseSupabase) {
        setAutomations([]);
        setError("Supabase is not configured. Automations cannot be loaded.");
        return;
      }
      const { session } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
      const token = session?.access_token ?? null;
      if (!token) {
        setAutomations([]);
        setError("You are not signed in. Automations cannot be loaded.");
        return;
      }
      const data = await apiRequest<{ items: Automation[] }>(token, "/api/automations");
      setAutomations(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [canUseSupabase]);

  useEffect(() => {
    void loadAutomations();
  }, [loadAutomations]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch("/api/models", { headers: { Accept: "application/json" } });
        const text = await res.text().catch(() => "");
        const parsed = text ? safeJsonParse(text) : null;
        if (!res.ok) return;
        if (!isRecord(parsed)) return;
        const raw = parsed.models;
        if (!Array.isArray(raw)) return;
        const next: ModelOption[] = raw
          .map((m) => {
            if (!isRecord(m)) return null;
            const id = typeof m.id === "string" ? m.id.trim() : "";
            const name = typeof m.name === "string" ? m.name.trim() : "";
            if (!id) return null;
            return { id, name: name || id } satisfies ModelOption;
          })
          .filter((x): x is ModelOption => Boolean(x));
        if (!cancelled) setModelOptions(next);
      } catch {
        if (!cancelled) setModelOptions([]);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setScheduleByAutomation((prev) => {
      const next = { ...prev };
      for (const a of automations) {
        if (!next[a.id]) next[a.id] = initScheduleDraft(a);
      }
      for (const id of Object.keys(next)) {
        if (!automations.some((a) => a.id === id)) delete next[id];
      }
      return next;
    });
    setBlocksByAutomation((prev) => {
      const next = { ...prev };
      for (const a of automations) {
        if (!next[a.id]) next[a.id] = loadBlocksFromAutomation(a);
      }
      for (const id of Object.keys(next)) {
        if (!automations.some((a) => a.id === id)) delete next[id];
      }
      return next;
    });
  }, [automations]);

  const byId = useMemo(() => {
    return new Map(automations.map((a) => [a.id, a]));
  }, [automations]);

  const updateLocal = useCallback((id: string, patch: Partial<Automation>) => {
    setAutomations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  const setBlocksForAutomation = useCallback(
    (automationId: string, blocks: BlockConfig[]) => {
      setBlocksByAutomation((prev) => ({ ...prev, [automationId]: blocks }));
      const current = byId.get(automationId);
      if (!current) return;
      const text = buildBlocksTodoText(blocks);
      const existingBlocksTodo = (current.todos ?? []).find((t) => {
        if (!t || typeof t.text !== "string") return false;
        const payload = parseBlocksPayload(t.text);
        return Boolean(payload);
      });
      const todoId = existingBlocksTodo ? existingBlocksTodo.id : crypto.randomUUID();
      const done = existingBlocksTodo ? existingBlocksTodo.done : false;
      const todo: TodoItem = { id: todoId, text, done };
      const nextTodos = [todo];
      updateLocal(automationId, { todos: nextTodos });
    },
    [byId, updateLocal]
  );

  const createAutomation = useCallback(async () => {
    setMessage(null);
    setError(null);
    try {
      if (!canUseSupabase) {
        setMessage({ type: "error", text: "Supabase is not configured." });
        return;
      }
      const { session } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
      const token = session?.access_token ?? null;
      if (!token) {
        setMessage({ type: "error", text: "Please sign in first." });
        return;
      }
      const res = await apiRequest<{ id: string }>(token, "/api/automations", {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadAutomations();
      setMessage({ type: "success", text: `Created: ${res.id}` });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to create." });
    }
  }, [canUseSupabase, loadAutomations]);

  const saveAutomation = useCallback(
    async (id: string, patch?: Partial<Automation>) => {
      const current = byId.get(id);
      if (!current) return;
      const merged = patch ? { ...current, ...patch } : current;
      const schedule = scheduleByAutomation[id];
      const timezoneToSend =
        merged.timezone ??
        (schedule && schedule.timezone !== "__server__" && schedule.timezone.trim() ? schedule.timezone.trim() : null);
      setMessage(null);
      setError(null);
      try {
        if (!canUseSupabase) throw new Error("Supabase is not configured.");
        const { session } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
        const token = session?.access_token ?? null;
        if (!token) throw new Error("Please sign in first.");
        const plan = await getMembershipStatusWithTimeout({
          sessionTimeoutMs: 2500,
          sessionRetries: 2,
          sessionRetryDelayMs: 120,
        });
        if (plan === "free") {
          openUpgradeModal();
          return;
        }
        setSavingId(id);
        if (patch) updateLocal(id, patch);
        await apiRequest<Automation>(token, `/api/automations/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: merged.name,
            enabled: merged.enabled,
            cron: merged.cron,
            timezone: timezoneToSend,
            webhook_url: merged.webhook_url,
            todos: merged.todos,
          }),
        });
        await loadAutomations();
        setMessage({ type: "success", text: "Saved." });
      } catch (e) {
        setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to save." });
      } finally {
        setSavingId(null);
      }
    },
    [byId, canUseSupabase, loadAutomations, openUpgradeModal, scheduleByAutomation, updateLocal]
  );

  const deleteAutomation = useCallback(
    async (id: string) => {
      setMessage(null);
      setError(null);
      setSavingId(id);
      try {
        if (!canUseSupabase) throw new Error("Supabase is not configured.");
        const { session } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
        const token = session?.access_token ?? null;
        if (!token) throw new Error("Please sign in first.");
        await apiRequest<{ ok: true }>(token, `/api/automations/${encodeURIComponent(id)}`, {
          method: "DELETE",
          body: JSON.stringify({}),
        });
        await loadAutomations();
        setMessage({ type: "success", text: "Deleted." });
      } catch (e) {
        setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to delete." });
      } finally {
        setSavingId(null);
      }
    },
    [canUseSupabase, loadAutomations]
  );

  const runAutomationNow = useCallback(
    async (id: string) => {
      setMessage(null);
      setError(null);
      setRunningId(id);
      try {
        if (!canUseSupabase) throw new Error("Supabase is not configured.");
        const { session } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
        const token = session?.access_token ?? null;
        if (!token) throw new Error("Please sign in first.");
        await apiRequest<{ ok: true }>(token, `/api/automations/${encodeURIComponent(id)}/run`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        await loadAutomations();
        setMessage({ type: "success", text: "Triggered." });
      } catch (e) {
        setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to trigger." });
      } finally {
        setRunningId(null);
      }
    },
    [canUseSupabase, loadAutomations]
  );

  const testAutomationNow = useCallback(
    async (id: string) => {
      const current = byId.get(id);
      if (!current) return;
      const schedule = scheduleByAutomation[id];
      const timezoneToSend =
        current.timezone ??
        (schedule && schedule.timezone !== "__server__" && schedule.timezone.trim() ? schedule.timezone.trim() : null);
      setMessage(null);
      setError(null);
      try {
        if (!canUseSupabase) throw new Error("Supabase is not configured.");
        const { session } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
        const token = session?.access_token ?? null;
        if (!token) throw new Error("Please sign in first.");
        const plan = await getMembershipStatusWithTimeout({
          sessionTimeoutMs: 2500,
          sessionRetries: 2,
          sessionRetryDelayMs: 120,
        });
        if (plan === "free") {
          openUpgradeModal();
          return;
        }
        setSavingId(id);
        setRunningId(id);
        await apiRequest<Automation>(token, `/api/automations/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: current.name,
            enabled: current.enabled,
            cron: current.cron,
            timezone: timezoneToSend,
            webhook_url: current.webhook_url,
            todos: current.todos,
          }),
        });
        await apiRequest<{ ok: true }>(token, `/api/automations/${encodeURIComponent(id)}/run`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        await loadAutomations();
        setMessage({ type: "success", text: "Test triggered with current settings." });
      } catch (e) {
        setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to test." });
      } finally {
        setSavingId(null);
        setRunningId(null);
      }
    },
    [byId, canUseSupabase, loadAutomations, openUpgradeModal, scheduleByAutomation]
  );

  const createFromTemplate = useCallback(
    async (template: "daily_post" | "xhs_batch" | "coming_soon_1" | "coming_soon_2") => {
      if (template === "coming_soon_1" || template === "coming_soon_2") return;
      setMessage(null);
      setError(null);
      try {
        if (!canUseSupabase) {
          setMessage({ type: "error", text: "Supabase is not configured." });
          return;
        }
        const { session } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
        const token = session?.access_token ?? null;
        if (!token) {
          setMessage({ type: "error", text: "Please sign in first." });
          return;
        }

        const tz = getLocalTimezone();
        const base = {
          enabled: false,
          timezone: tz,
          webhook_url: null as string | null,
        };

        const payload =
          template === "daily_post"
            ? {
                ...base,
                name: "Write post every day",
                cron: "0 9 */1 * *",
                todos: [{ id: crypto.randomUUID(), text: "Write a post", done: false }],
              }
            : {
                ...base,
                name: "Scheduled batch write Xiaohongshu",
                cron: "0 10 * * 1",
                todos: [{ id: crypto.randomUUID(), text: "Generate Xiaohongshu posts in batch", done: false }],
              };

        const res = await apiRequest<{ id: string }>(token, "/api/automations", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        await loadAutomations();
        setMessage({ type: "success", text: `Created from template: ${res.id}` });
      } catch (e) {
        setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to create template." });
      }
    },
    [canUseSupabase, loadAutomations]
  );

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Automation</h1>
        </div>
        <button
          type="button"
          onClick={createAutomation}
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <Plus className="h-4 w-4" />
          New automation
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-stretch gap-3">
        <button
          type="button"
          onClick={() => createFromTemplate("daily_post")}
          className="group flex w-full items-center justify-between rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-left shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50 sm:w-[calc(50%-0.375rem)] lg:w-[calc(25%-0.5625rem)]"
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Write post every day</div>
            <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Daily template</div>
          </div>
          <Plus className="h-4 w-4 text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-50" />
        </button>
        <button
          type="button"
          onClick={() => createFromTemplate("xhs_batch")}
          className="group flex w-full items-center justify-between rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-left shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50 sm:w-[calc(50%-0.375rem)] lg:w-[calc(25%-0.5625rem)]"
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Scheduled batch write Xiaohongshu</div>
            <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Weekly template</div>
          </div>
          <Plus className="h-4 w-4 text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-50" />
        </button>
        <button
          type="button"
          onClick={() => createFromTemplate("coming_soon_1")}
          className="flex w-full cursor-not-allowed items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-left text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/30 sm:w-[calc(50%-0.375rem)] lg:w-[calc(25%-0.5625rem)]"
          disabled
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold">Coming soon</div>
            <div className="mt-0.5 text-xs">Template</div>
          </div>
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => createFromTemplate("coming_soon_2")}
          className="flex w-full cursor-not-allowed items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-left text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/30 sm:w-[calc(50%-0.375rem)] lg:w-[calc(25%-0.5625rem)]"
          disabled
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold">Coming soon</div>
            <div className="mt-0.5 text-xs">Template</div>
          </div>
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {message && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
            message.type === "success"
              ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-200"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          )}
          <div className="min-w-0 whitespace-pre-wrap break-words">{message.text}</div>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          <div className="min-w-0 whitespace-pre-wrap break-words">{error}</div>
        </div>
      )}

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : automations.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300">
          No automations yet. Create one from the top-right button or a template.
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {automations.map((a, index) => {
            const isSaving = savingId === a.id;
            const isRunning = runningId === a.id;
            const schedule = scheduleByAutomation[a.id] ?? initScheduleDraft(a);
            const displayIndex = index + 1;
            const blocks = blocksByAutomation[a.id] ?? createDefaultBlocks();
            const addBlockValue = pendingAddKindByAutomation[a.id] ?? "";
            return (
              <div
                key={a.id}
                className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900">
                      {displayIndex}
                    </div>
                    <div className="min-w-0 flex-1">
                      <input
                        value={a.name}
                        onChange={(e) => updateLocal(a.id, { name: e.target.value })}
                        className="w-full truncate rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-700"
                        placeholder="Automation name"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-200">
                      <input
                        type="checkbox"
                        checked={a.enabled}
                        onChange={(e) => updateLocal(a.id, { enabled: e.target.checked })}
                        className="h-5 w-5 rounded border-zinc-300 dark:border-zinc-700"
                      />
                      Enabled
                    </label>
                    <button
                      type="button"
                      onClick={() => setTestPanelAutomationId(a.id)}
                      disabled={isSaving || isRunning}
                      className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                    >
                      {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      Test
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
                    <div className="text-xs font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">WORKFLOW</div>

                    <div className="mt-4 space-y-3">
                      <div className="rounded-2xl p-4">
                        <div className="mt-3 flex flex-col gap-3">
                          <div className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">When</div>
                          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
                            <Select
                              value={schedule.kind}
                              onValueChange={(value) => {
                                const kind: ScheduleKind = value === "weekly" ? "weekly" : "every_n_days";
                                const nextDraft: ScheduleDraft = { ...schedule, kind };
                                setScheduleByAutomation((prev) => ({ ...prev, [a.id]: nextDraft }));
                                const nextCron = buildCronFromDraft(nextDraft);
                                updateLocal(a.id, { cron: nextCron });
                              }}
                            >
                              <SelectTrigger className="h-9 w-auto min-w-[180px] rounded-xl border-0 bg-zinc-100 text-base focus:ring-2 focus:ring-zinc-200 focus:ring-offset-0 dark:bg-zinc-800 dark:focus:ring-zinc-700">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl">
                                <SelectItem value="every_n_days">Every X days</SelectItem>
                                <SelectItem value="weekly">Weekly</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="text-lg font-semibold text-zinc-500 dark:text-zinc-400">Do</div>

                          {blocks.map((block, idx) => (
                            <div key={block.id} className="contents">
                              {idx > 0 && (
                                <div className="text-lg font-semibold text-zinc-500 dark:text-zinc-400">Then</div>
                              )}

                              {block.kind === "send_message" ? (
                                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
                                  <div className="text-base font-semibold text-zinc-800 dark:text-zinc-100">Send message</div>
                                  <input
                                    value={block.message ?? ""}
                                    onChange={(e) => {
                                      const next = blocks.map((b) => (b.id === block.id ? { ...b, message: e.target.value } : b));
                                      setBlocksForAutomation(a.id, next);
                                    }}
                                    className="w-44 rounded-lg bg-zinc-100 px-2 py-1 text-base text-zinc-900 outline-none placeholder:text-zinc-600 focus:ring-2 focus:ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-400 dark:focus:ring-zinc-700"
                                    placeholder="message"
                                  />
                                  <div className="text-base font-semibold text-zinc-800 dark:text-zinc-100">to Agent</div>
                                  <div className="flex items-center gap-2">
                                    <Settings className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
                                    {(() => {
                                      const raw = (block.model ?? "").trim();
                                      const normalized = raw === "default" ? "" : raw;
                                      const hasNormalized = Boolean(normalized);
                                      const isKnown =
                                        !hasNormalized || modelOptions.some((m) => m.id === normalized);
                                      const value = hasNormalized ? normalized : "__default__";
                                      return (
                                    <Select
                                      value={value}
                                      onValueChange={(value) => {
                                        const model = value === "__default__" ? "" : value;
                                        const next = blocks.map((b) => (b.id === block.id ? { ...b, model } : b));
                                        setBlocksForAutomation(a.id, next);
                                      }}
                                    >
                                      <SelectTrigger className="h-9 w-auto min-w-[180px] rounded-lg border-0 bg-zinc-100 text-base focus:ring-2 focus:ring-zinc-200 focus:ring-offset-0 dark:bg-zinc-800 dark:focus:ring-zinc-700">
                                        <SelectValue placeholder="Model" />
                                      </SelectTrigger>
                                      <SelectContent className="rounded-xl">
                                        <SelectItem value="__default__">Default</SelectItem>
                                        {!isKnown && (
                                          <SelectItem value={normalized}>{normalized}</SelectItem>
                                        )}
                                        {modelOptions.map((m) => (
                                          <SelectItem key={m.id} value={m.id}>
                                            {m.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                      );
                                    })()}
                                  </div>
                                </div>
                              ) : block.kind === "file_reference" ? (
                                <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-base font-semibold text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
                                  File reference
                                </div>
                              ) : block.kind === "add_text_to_platform" ? (
                                <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
                                  <div className="text-base font-semibold text-zinc-800 dark:text-zinc-100">Add text to</div>
                                  <Select
                                    value={block.platform ?? "Notion"}
                                    onValueChange={(value) => {
                                      const platform = value || "Notion";
                                      const next = blocks.map((b) => (b.id === block.id ? { ...b, platform } : b));
                                      setBlocksForAutomation(a.id, next);
                                    }}
                                  >
                                    <SelectTrigger className="h-9 w-auto min-w-[140px] rounded-lg border-0 bg-zinc-100 text-base focus:ring-2 focus:ring-zinc-200 focus:ring-offset-0 dark:bg-zinc-800 dark:focus:ring-zinc-700">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl">
                                      <SelectItem value="Notion">Notion</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              ) : block.kind === "save_to_place" ? (
                                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
                                  <div className="text-base font-semibold text-zinc-800 dark:text-zinc-100">Save to</div>
                                  <Select
                                    value={block.placeScope ?? "Workspace"}
                                    onValueChange={(value) => {
                                      const placeScope: "Draft" | "Workspace" = value === "Draft" ? "Draft" : "Workspace";
                                      const next = blocks.map((b) => (b.id === block.id ? { ...b, placeScope } : b));
                                      setBlocksForAutomation(a.id, next);
                                    }}
                                  >
                                    <SelectTrigger className="h-9 w-auto min-w-[160px] rounded-lg border-0 bg-zinc-100 text-base focus:ring-2 focus:ring-zinc-200 focus:ring-offset-0 dark:bg-zinc-800 dark:focus:ring-zinc-700">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl">
                                      <SelectItem value="Draft">Draft</SelectItem>
                                      <SelectItem value="Workspace">Workspace</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
                                  <div className="text-base font-semibold text-zinc-800 dark:text-zinc-100">Post to</div>
                                  <Select
                                    value={(block.socialAccount ?? "").trim() ? (block.socialAccount ?? "").trim() : undefined}
                                    onValueChange={(value) => {
                                      const next = blocks.map((b) => (b.id === block.id ? { ...b, socialAccount: value } : b));
                                      setBlocksForAutomation(a.id, next);
                                    }}
                                  >
                                    <SelectTrigger className="h-9 w-auto min-w-[200px] rounded-lg border-0 bg-zinc-100 text-base focus:ring-2 focus:ring-zinc-200 focus:ring-offset-0 dark:bg-zinc-800 dark:focus:ring-zinc-700">
                                      <SelectValue placeholder="Select account" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl">
                                      <SelectItem value="__none__" disabled>No connected accounts</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                            </div>
                          ))}

                          <div className="text-lg font-semibold text-zinc-500 dark:text-zinc-400">Then</div>
                          <Select
                            value={addBlockValue}
                            onValueChange={(value) => {
                              const kind = value as BlockKind;
                              if (!kind) return;
                              const next: BlockConfig[] = [
                                ...blocks,
                                kind === "send_message"
                                  ? { id: crypto.randomUUID(), kind, message: "", model: "" }
                                  : kind === "file_reference"
                                    ? { id: crypto.randomUUID(), kind }
                                    : kind === "add_text_to_platform"
                                      ? { id: crypto.randomUUID(), kind, platform: "Notion" }
                                      : kind === "save_to_place"
                                        ? { id: crypto.randomUUID(), kind, place: "", placeScope: "Workspace" as const }
                                        : { id: crypto.randomUUID(), kind, socialAccount: "" },
                              ];
                              setBlocksForAutomation(a.id, next);
                              setPendingAddKindByAutomation((prev) => ({ ...prev, [a.id]: "" }));
                            }}
                          >
                            <SelectTrigger className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-base font-semibold text-zinc-800 hover:bg-zinc-50 focus:ring-2 focus:ring-zinc-200 focus:ring-offset-0 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:focus:ring-zinc-700">
                              <SelectValue placeholder="Add block…" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl">
                              <SelectGroup>
                                <SelectLabel>A</SelectLabel>
                                <SelectItem value="send_message">Send message to Agent</SelectItem>
                              </SelectGroup>
                              <SelectGroup>
                                <SelectLabel>B</SelectLabel>
                                <SelectItem value="file_reference">File reference</SelectItem>
                                <SelectItem value="add_text_to_platform">Add text to Platform</SelectItem>
                                <SelectItem value="save_to_place">Save to place</SelectItem>
                                <SelectItem value="post_to_social_media">Post to SocialMedia</SelectItem>
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2" />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
                    <div className="text-xs font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">RESULTS</div>
                    <div className="mt-3 min-h-[80px]" />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => saveAutomation(a.id, { enabled: true })}
                    disabled={isSaving || isRunning}
                    className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save & enable
                  </button>
                  <button
                    type="button"
                    onClick={() => saveAutomation(a.id)}
                    disabled={isSaving || isRunning}
                    className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                  >
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save only
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isSaving || isRunning) return;
                      const ok = window.confirm("Delete this automation? This cannot be undone.");
                      if (!ok) return;
                      void deleteAutomation(a.id);
                    }}
                    disabled={isSaving || isRunning}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/40 dark:bg-zinc-950 dark:text-red-200 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {typeof document !== "undefined" &&
        testPanelAutomationId &&
        createPortal(
          (() => {
            const automation = byId.get(testPanelAutomationId);
            if (!automation) return null;
            const payload = buildPayloadPreview(automation);
            const statusLabel = getStatusLabel(automation);
            const isSaving = savingId === automation.id;
            const isRunning = runningId === automation.id;
            return (
              <div className="fixed inset-0 z-[100000] flex items-end justify-center bg-black/40 backdrop-blur-sm">
                <div
                  className="w-full max-w-6xl rounded-t-3xl border border-zinc-200 bg-white/90 shadow-2xl backdrop-blur-xl dark:border-zinc-700 dark:bg-zinc-900/90"
                  style={{ maxHeight: "80vh", height: `${testPanelHeight}px` }}
                >
                  <div
                    className="flex cursor-row-resize touch-none items-center justify-center border-b border-zinc-200 px-4 py-2 dark:border-zinc-700"
                    onPointerDown={handleTestPanelDragStart}
                  >
                    <div className="h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                  </div>

                  <div className="flex h-[calc(100%-44px)] flex-col gap-4 overflow-hidden px-4 pb-4 pt-2 sm:px-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                          Test panel
                        </div>
                        <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                          {automation.name || "Untitled automation"}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => testAutomationNow(automation.id)}
                          disabled={isSaving || isRunning}
                          className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                        >
                          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          Run test
                        </button>
                        <button
                          type="button"
                          onClick={() => runAutomationNow(automation.id)}
                          disabled={isSaving || isRunning}
                          className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/90 px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-white disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-100 dark:hover:bg-zinc-900"
                        >
                          Trigger (saved settings)
                        </button>
                        <button
                          type="button"
                          onClick={() => setTestPanelAutomationId(null)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 bg-white/80 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          aria-label="Close"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid flex-1 gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-700 dark:bg-zinc-900/60">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">Latest run</div>
                          <div
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                              automation.last_run_ok === null
                                ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                                : automation.last_run_ok
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200"
                                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200"
                            }`}
                          >
                            {statusLabel}
                          </div>
                        </div>
                        <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">{formatLastRun(automation)}</div>
                        {automation.last_error && (
                          <div className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-red-200 bg-red-50/90 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/40 dark:text-red-200">
                            {automation.last_error}
                          </div>
                        )}
                      </div>

                      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-700 dark:bg-zinc-900/60">
                        <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">Payload preview</div>
                        <pre className="mt-3 max-h-full flex-1 overflow-auto rounded-xl border border-zinc-200 bg-white/90 p-3 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950/90 dark:text-zinc-100">
                          {JSON.stringify(payload, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })(),
          document.body
        )}
    </div>
  );
}
