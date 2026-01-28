"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfToday,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { CalendarHeader } from "@/components/schedule/CalendarHeader";
import { CalendarToolbar } from "@/components/schedule/CalendarToolbar";
import { CalendarGrid } from "@/components/schedule/CalendarGrid";
import { CreatePostModal } from "@/components/schedule/CreatePostModal";
import { getSessionWithTimeout } from "@/lib/supabaseClient";
import { DayTimelinePanel } from "@/components/schedule/DayTimelinePanel";

type PublishResultState =
  | { open: false }
  | { open: true; status: "loading" }
  | { open: true; status: "success"; viewUrl: string | null }
  | { open: true; status: "error"; message: string };

function PublishResultModal({ state, onClose }: { state: PublishResultState; onClose: () => void }) {
  const canUseDOM = typeof document !== "undefined";
  if (!canUseDOM || !state.open) return null;

  const canDismiss = state.status !== "loading";

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/50 backdrop-blur-sm p-4 sm:p-8">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
            {state.status === "loading" ? "Publishing" : state.status === "success" ? "Published" : "Publish failed"}
          </div>
          <button
            type="button"
            onClick={canDismiss ? onClose : undefined}
            disabled={!canDismiss}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 disabled:opacity-60 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {state.status === "loading" ? (
            <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Publishing your post…</span>
            </div>
          ) : state.status === "success" ? (
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <div className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-50">Published</div>
              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const url = state.viewUrl;
                    if (!url) return;
                    window.open(url, "_blank", "noopener,noreferrer");
                  }}
                  disabled={!state.viewUrl}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
                >
                  View post
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                <div className="min-w-0 whitespace-pre-wrap break-words">{state.message}</div>
              </div>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function SchedulePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [currentDate, setCurrentDate] = useState(startOfToday());
  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("week");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [isDayPanelOpen, setIsDayPanelOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState<"sunday" | "monday">(() => {
    if (typeof window === "undefined") return "sunday";
    const stored = window.localStorage.getItem("schedule.weekStart");
    return stored === "monday" ? "monday" : "sunday";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const create = searchParams.get("create");
    if (create === "1" || create === "post") {
      setIsCreateModalOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("create");
      router.replace(url.pathname + url.search);
    }
  }, [searchParams, router]);

  const handleWeekStartChange = (value: "sunday" | "monday") => {
    setWeekStart(value);
    localStorage.setItem("schedule.weekStart", value);
  };

  const weekStartsOn = weekStart === "monday" ? 1 : 0;

  type ScheduleItem = {
    id: string;
    persona_id: string | null;
    content: string;
    status: "draft" | "scheduled" | "published";
    type: "post" | "story" | "reel";
    accounts: string[];
    target_platform?: string | null;
    target_account?: string | null;
    view_url?: string | null;
    event_at: string | null;
    created_at: string;
    updated_at: string;
  };

  type Persona = { id: string; name: string | null; avatar_url?: string | null };

  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [publishResult, setPublishResult] = useState<PublishResultState>({ open: false });
  const [editorContent, setEditorContent] = useState("");

  const handlePrev = () => {
    if (viewMode === "day") setCurrentDate((d) => subDays(d, 1));
    else if (viewMode === "week") setCurrentDate((d) => subWeeks(d, 1));
    else if (viewMode === "month") setCurrentDate((d) => subMonths(d, 1));
  };

  const handleNext = () => {
    if (viewMode === "day") setCurrentDate((d) => addDays(d, 1));
    else if (viewMode === "week") setCurrentDate((d) => addWeeks(d, 1));
    else if (viewMode === "month") setCurrentDate((d) => addMonths(d, 1));
  };

  const handleToday = () => {
    setCurrentDate(startOfToday());
  };

  const range = useMemo(() => {
    if (viewMode === "day") {
      return { from: startOfDay(currentDate), to: endOfDay(currentDate) };
    }
    if (viewMode === "week") {
      const from = startOfWeek(currentDate, { weekStartsOn });
      const to = endOfWeek(currentDate, { weekStartsOn });
      return { from: startOfDay(from), to: endOfDay(to) };
    }
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const from = startOfWeek(monthStart, { weekStartsOn });
    const to = endOfWeek(monthEnd, { weekStartsOn });
    return { from: startOfDay(from), to: endOfDay(to) };
  }, [currentDate, viewMode, weekStartsOn]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const { session } = await getSessionWithTimeout({ timeoutMs: 8000, retries: 2, retryDelayMs: 250 });
      const token = session?.access_token ?? null;
      if (!token) {
        if (!cancelled) {
          setItems([]);
          setPersonas([]);
        }
        return;
      }

      if (!cancelled) setItemsLoading(true);
      try {
        const [itemsRes, personasRes] = await Promise.all([
          fetch(
            `/api/schedule-items?${new URLSearchParams({
              from: range.from.toISOString(),
              to: range.to.toISOString(),
            }).toString()}`,
            { headers: { Authorization: `Bearer ${token}` } }
          ),
          fetch(`/api/personas`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        const nextItems = itemsRes.ok ? ((await itemsRes.json()) as ScheduleItem[]) : [];
        const nextPersonas = personasRes.ok ? ((await personasRes.json()) as Persona[]) : [];

        if (!cancelled) {
          setItems(Array.isArray(nextItems) ? nextItems : []);
          setPersonas(Array.isArray(nextPersonas) ? nextPersonas : []);
        }
      } finally {
        if (!cancelled) setItemsLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]);

  const calendarPosts = useMemo(() => {
    return items
      .filter((it) => it.event_at)
      .map((it) => ({
        id: it.id,
        content: it.content,
        scheduledAt: new Date(it.event_at as string),
        account: it.accounts?.[0] ?? "Unknown",
        type: it.type,
        status: it.status,
      }));
  }, [items]);

  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null;
    return items.find((it) => it.id === selectedItemId) ?? null;
  }, [items, selectedItemId]);

  useEffect(() => {
    if (!selectedItem) return;
    setEditorContent(selectedItem.content ?? "");
  }, [selectedItem?.id]);

  const selectedDayItems = useMemo(() => {
    if (!selectedDay) return [];
    const start = startOfDay(selectedDay);
    const end = endOfDay(selectedDay);
    return items
      .filter((it) => it.event_at && it.status !== "draft")
      .filter((it) => {
        const d = new Date(it.event_at as string);
        return d >= start && d <= end;
      })
      .sort((a, b) => (a.event_at ?? "").localeCompare(b.event_at ?? ""));
  }, [items, selectedDay]);

  const refreshRange = async () => {
    const { session } = await getSessionWithTimeout({ timeoutMs: 8000, retries: 2, retryDelayMs: 250 });
    const token = session?.access_token ?? null;
    if (!token) return;
    const res = await fetch(
      `/api/schedule-items?${new URLSearchParams({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      }).toString()}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return;
    const nextItems = (await res.json()) as ScheduleItem[];
    setItems(Array.isArray(nextItems) ? nextItems : []);
  };

  const openEditorForItem = (id: string) => {
    setSelectedItemId(id);
    setIsDayPanelOpen(false);
  };

  const closeEditor = () => setSelectedItemId(null);

  const patchItemInState = (updated: ScheduleItem) => {
    setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
  };

  const updateSelectedItem = async (next: Partial<Pick<ScheduleItem, "content" | "target_platform" | "target_account">>) => {
    if (!selectedItem) return;
    const { session } = await getSessionWithTimeout({ timeoutMs: 8000, retries: 2, retryDelayMs: 250 });
    const token = session?.access_token ?? null;
    if (!token) return;
    const res = await fetch(`/api/schedule-items/${encodeURIComponent(selectedItem.id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...(next.content !== undefined ? { content: next.content } : {}),
        ...(next.target_platform !== undefined ? { target_platform: next.target_platform } : {}),
        ...(next.target_account !== undefined ? { target_account: next.target_account } : {}),
      }),
    });
    if (!res.ok) return;
    const updated = (await res.json().catch(() => null)) as unknown;
    if (!updated || typeof updated !== "object") return;
    patchItemInState(updated as ScheduleItem);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900">
      <CalendarHeader
        onCreatePost={() => setIsCreateModalOpen(true)}
        weekStart={weekStart}
        onWeekStartChange={handleWeekStartChange}
      />
      
      <div className="flex flex-1 flex-col overflow-hidden relative">
        <CalendarToolbar
          currentDate={currentDate}
          onPrev={handlePrev}
          onNext={handleNext}
          onToday={handleToday}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          weekStartsOn={weekStartsOn}
        />
        
        <div className={`${isDayPanelOpen || selectedItem ? "pr-[380px]" : ""} flex flex-1 overflow-hidden`}>
          <CalendarGrid
            currentDate={currentDate}
            viewMode={viewMode}
            weekStartsOn={weekStartsOn}
            posts={calendarPosts}
            selectedDay={selectedDay}
            onDayClick={(day) => {
              closeEditor();
              setSelectedDay(day);
              setIsDayPanelOpen(true);
            }}
            onPostClick={(postId) => openEditorForItem(postId)}
          />
        </div>

        <DayTimelinePanel
          isOpen={isDayPanelOpen}
          date={selectedDay ?? currentDate}
          items={selectedDayItems}
          personas={personas}
          loading={itemsLoading}
          onClose={() => setIsDayPanelOpen(false)}
          onItemClick={(itemId) => openEditorForItem(itemId)}
        />

        {selectedItem ? (
          <div className="absolute right-0 top-0 h-full w-[380px] border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-start justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div className="min-w-0">
                <div className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                  {selectedItem.status === "published"
                    ? "Published"
                    : selectedItem.status === "scheduled"
                      ? "Scheduled"
                      : "Draft"}
                </div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Updated {selectedItem.updated_at ? new Date(selectedItem.updated_at).toLocaleString() : "-"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selectedItem.status === "published" ? (
                  <button
                    type="button"
                    onClick={() => {
                      const url = (selectedItem.view_url ?? "").toString().trim();
                      if (!url) return;
                      window.open(url, "_blank", "noopener,noreferrer");
                    }}
                    disabled={!selectedItem.view_url}
                    className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
                  >
                    View post
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="h-full overflow-y-auto p-4 pb-24">
              <div>
                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Content</div>
                {selectedItem.status === "published" ? (
                  <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-50">
                    {selectedItem.content || "Untitled"}
                  </div>
                ) : (
                  <textarea
                    value={editorContent}
                    onChange={(e) => setEditorContent(e.target.value)}
                    onBlur={() => {
                      const next = editorContent.toString();
                      const prev = (selectedItem.content ?? "").toString();
                      if (next === prev) return;
                      void updateSelectedItem({ content: next });
                    }}
                    className="mt-2 min-h-[120px] w-full resize-none rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-100"
                  />
                )}
              </div>

              <div className="mt-6 grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">Target platform</div>
                  {selectedItem.status === "published" ? (
                    <div className="h-9 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2 text-sm leading-9 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50">
                      {(selectedItem.target_platform ?? "-").toString() || "-"}
                    </div>
                  ) : (
                    <select
                      value={(selectedItem.target_platform ?? "").toString()}
                      onChange={(e) => {
                        const v = e.target.value || null;
                        void updateSelectedItem({ target_platform: v, target_account: null });
                      }}
                      className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-100"
                    >
                      <option value="">Select</option>
                      <option value="X">X</option>
                      <option value="Instagram">Instagram</option>
                      <option value="LinkedIn">LinkedIn</option>
                      <option value="TikTok">TikTok</option>
                      <option value="YouTube">YouTube</option>
                    </select>
                  )}
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">Target account</div>
                  {selectedItem.status === "published" ? (
                    <div className="h-9 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2 text-sm leading-9 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50">
                      {(selectedItem.target_account ?? "-").toString() || "-"}
                    </div>
                  ) : (
                    <select
                      value={(selectedItem.target_account ?? "").toString()}
                      onChange={(e) => void updateSelectedItem({ target_account: e.target.value || null })}
                      className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-100"
                    >
                      <option value="">Select</option>
                      {Array.from(
                        new Map(
                          [
                            ...((selectedItem.accounts ?? []) as string[]).map((a) => [a, a] as const),
                            ...(selectedItem.target_account ? [[selectedItem.target_account, selectedItem.target_account] as const] : []),
                          ].map(([id, name]) => [id, name])
                        ).entries()
                      ).map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <CreatePostModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={async (data) => {
          const toEnglishPublishError = (detail: string | null) => {
            const d = (detail ?? "").toString().trim();
            const lower = d.toLowerCase();
            if (!d) return "Publish failed. Please try again.";
            if (lower.includes("unauthorized") || lower.includes("sign in")) {
              return "You are not signed in. Please sign in and try again.";
            }
            if (lower.includes("timeout") || lower.includes("timed out")) {
              return "Publish failed due to a timeout. Please try again.";
            }
            return `Publish failed. ${d}`;
          };

          const { session } = await getSessionWithTimeout({ timeoutMs: 8000, retries: 2, retryDelayMs: 250 });
          const token = session?.access_token ?? null;
          if (!token) {
            if (data.action === "postNow") {
              setPublishResult({ open: true, status: "error", message: "You are not signed in. Please sign in and try again." });
            }
            return { ok: false, error: "Please sign in first." };
          }

          if (data.action === "postNow") {
            setPublishResult({ open: true, status: "loading" });
          }

          const now = new Date();
          const status =
            data.action === "draft" ? "draft" : data.action === "schedule" ? "scheduled" : "published";
          const eventAt =
            data.action === "draft"
              ? null
              : data.action === "schedule"
                ? data.scheduledAt ?? null
                : now;

          let viewUrl: string | null = null;
          if (data.action === "postNow" && (data.targetPlatform === "X" || data.accounts.length > 0)) {
            const xRes = await fetch("/api/integrations/x/post", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ text: data.content }),
            });
            if (!xRes.ok) {
              const msg = await xRes
                .json()
                .then((j: unknown) => {
                  const obj = (j ?? {}) as Record<string, unknown>;
                  const detail = obj.detail;
                  const error = obj.error;
                  if (typeof detail === "string" && detail.trim()) return detail;
                  if (typeof error === "string" && error.trim()) return error;
                  return null;
                })
                .catch(() => null);
              const display = toEnglishPublishError(msg ?? "Failed to publish to X. Please try again.");
              setPublishResult({ open: true, status: "error", message: display });
              return { ok: false, error: msg ?? "Failed to post to X. Please try again." };
            }

            const json = (await xRes.json().catch(() => null)) as unknown;
            const dataObj =
              json && typeof json === "object" ? ((json as Record<string, unknown>).data as unknown) : null;
            const tweetId =
              dataObj && typeof dataObj === "object" && typeof (dataObj as Record<string, unknown>).id === "string"
                ? ((dataObj as Record<string, unknown>).id as string)
                : null;
            const username = (data.targetAccount ?? data.accounts[0] ?? "").toString().trim().replace(/^@/, "");
            if (tweetId && username) viewUrl = `https://x.com/${username}/status/${tweetId}`;
            else if (tweetId) viewUrl = `https://x.com/i/web/status/${tweetId}`;
          }

          const res = await fetch("/api/schedule-items", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              persona_id: data.personaId,
              content: data.content,
              status,
              type: "post",
              accounts: data.accounts,
              target_platform: (data.targetPlatform ?? null) as string | null,
              target_account: (data.targetAccount ?? null) as string | null,
              view_url: viewUrl,
              event_at: eventAt ? eventAt.toISOString() : null,
            }),
          });

          if (!res.ok) {
            const msg = await res
              .json()
              .then((j: unknown) => {
                const obj = (j ?? {}) as Record<string, unknown>;
                return (obj.error as string | undefined) ?? null;
              })
              .catch(() => null);
            if (data.action === "postNow") {
              setPublishResult({ open: true, status: "error", message: toEnglishPublishError(msg) });
            }
            return { ok: false, error: msg ?? "Failed to save. Please try again." };
          }
          await refreshRange();
          if (data.action === "postNow") {
            setPublishResult({ open: true, status: "success", viewUrl });
          }
          return { ok: true, viewUrl };
        }}
      />
      <PublishResultModal state={publishResult} onClose={() => setPublishResult({ open: false })} />
    </div>
  );
}
