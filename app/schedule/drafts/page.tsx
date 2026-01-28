"use client";

import { useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import { addDays, addWeeks, format, getDaysInMonth, getMonth, getYear, isSameDay, startOfToday, startOfWeek, subWeeks } from "date-fns";
import { ChevronDown, ChevronLeft, ChevronRight, Send, X } from "lucide-react";
import { CalendarHeader } from "@/components/schedule/CalendarHeader";
import { CreatePostModal } from "@/components/schedule/CreatePostModal";
import { getSessionWithTimeout } from "@/lib/supabaseClient";

type WeekStart = "sunday" | "monday";

export default function ScheduleDraftsPage() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const monthPickerRef = useRef<HTMLDivElement | null>(null);
  type DraftComment = {
    id: string;
    author_id: string;
    content: string;
    created_at: string;
  };
  type DraftMediaItem = {
    id: string;
    kind: "image" | "video";
    url: string;
    duration_sec?: number | null;
  };

  type DraftItem = {
    id: string;
    persona_id: string | null;
    content: string;
    status: "draft" | "scheduled" | "published";
    accounts: string[];
    target_platform?: string | null;
    target_account?: string | null;
    view_url?: string | null;
    media: DraftMediaItem[];
    event_at: string | null;
    updated_at: string;
    comments: DraftComment[];
  };

  const mockAccounts = [
    { id: "PRCrecluse674", name: "PRCrecluse674", platform: "X" },
    { id: "AIPersona_IG", name: "AIPersona Official", platform: "Instagram" },
    { id: "TechDaily", name: "Tech Daily News", platform: "LinkedIn" },
  ];

  const [unscheduledDrafts, setUnscheduledDrafts] = useState<DraftItem[]>([]);
  const [scheduledDrafts, setScheduledDrafts] = useState<DraftItem[]>([]);
  const [selectedDay, setSelectedDay] = useState<Date>(() => startOfToday());
  const [weekAnchor, setWeekAnchor] = useState<Date>(() => startOfToday());
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [monthPickerYear, setMonthPickerYear] = useState(() => getYear(startOfToday()));
  const [loading, setLoading] = useState(false);
  const [weekStart, setWeekStart] = useState<WeekStart>(() => {
    if (typeof window === "undefined") return "sunday";
    const stored = window.localStorage.getItem("schedule.weekStart");
    return stored === "monday" ? "monday" : "sunday";
  });

  const handleWeekStartChange = (value: WeekStart) => {
    setWeekStart(value);
    localStorage.setItem("schedule.weekStart", value);
  };

  const weekStartsOn = weekStart === "monday" ? 1 : 0;

  const selectedDayKey = useMemo(() => format(selectedDay, "yyyy-MM-dd"), [selectedDay]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(weekAnchor, { weekStartsOn });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [weekAnchor, weekStartsOn]);

  const parseRows = (rows: unknown): DraftItem[] => {
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => {
      const obj = (r ?? {}) as Record<string, unknown>;
      const rawStatus = String(obj.status ?? "draft");
      const status: DraftItem["status"] =
        rawStatus === "scheduled" || rawStatus === "published" || rawStatus === "draft" ? rawStatus : "draft";
      const accountsRaw = (obj.accounts ?? []) as unknown;
      const accounts = Array.isArray(accountsRaw) ? accountsRaw.map((a) => String(a ?? "")).filter(Boolean) : [];
      const mediaRaw = (obj.media ?? []) as unknown;
      const media: DraftMediaItem[] = Array.isArray(mediaRaw)
        ? mediaRaw
            .map((m) => {
              const mo = (m ?? {}) as Record<string, unknown>;
              const kindRaw = String(mo.kind ?? "");
              const kind: DraftMediaItem["kind"] = kindRaw === "video" ? "video" : "image";
              const durationRaw = mo.duration_sec;
              const durationSec =
                typeof durationRaw === "number" && Number.isFinite(durationRaw) ? durationRaw : null;
              return {
                id: String(mo.id ?? ""),
                kind,
                url: String(mo.url ?? ""),
                duration_sec: durationSec,
              };
            })
            .filter((m) => Boolean(m.id) && Boolean(m.url))
        : [];
      const commentsRaw = (obj.comments ?? []) as unknown;
      const comments: DraftComment[] = Array.isArray(commentsRaw)
        ? commentsRaw.map((c) => {
            const co = (c ?? {}) as Record<string, unknown>;
            return {
              id: String(co.id ?? ""),
              author_id: String(co.author_id ?? ""),
              content: String(co.content ?? ""),
              created_at: String(co.created_at ?? ""),
            };
          }).filter((c) => Boolean(c.id))
        : [];
      return {
        id: String(obj.id),
        persona_id: (obj.persona_id as string | null | undefined) ?? null,
        content: String(obj.content ?? ""),
        status,
        accounts,
        target_platform: (obj.target_platform as string | null | undefined) ?? null,
        target_account: (obj.target_account as string | null | undefined) ?? null,
        view_url: (obj.view_url as string | null | undefined) ?? null,
        media,
        event_at: (obj.event_at as string | null | undefined) ?? null,
        updated_at: String(obj.updated_at ?? ""),
        comments,
      };
    });
  };

  const refreshUnscheduledDrafts = async () => {
    const { session } = await getSessionWithTimeout({ timeoutMs: 8000, retries: 2, retryDelayMs: 250 });
    const token = session?.access_token ?? null;
    if (!token) {
      setUnscheduledDrafts([]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/schedule-items?${new URLSearchParams({ status: "draft" }).toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setUnscheduledDrafts([]);
        return;
      }
      setUnscheduledDrafts(parseRows((await res.json()) as unknown));
    } finally {
      setLoading(false);
    }
  };

  const refreshScheduledDraftsForDay = async (dayKey: string) => {
    const { session } = await getSessionWithTimeout({ timeoutMs: 8000, retries: 2, retryDelayMs: 250 });
    const token = session?.access_token ?? null;
    if (!token) {
      setScheduledDrafts([]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `/api/schedule-items?${new URLSearchParams({ status: "scheduled", day: dayKey }).toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!res.ok) {
        setScheduledDrafts([]);
        return;
      }
      setScheduledDrafts(parseRows((await res.json()) as unknown));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshUnscheduledDrafts();
    void refreshScheduledDraftsForDay(selectedDayKey);
  }, []);

  useEffect(() => {
    void refreshScheduledDraftsForDay(selectedDayKey);
  }, [selectedDayKey]);

  const selectedDraft = useMemo(() => {
    if (!selectedDraftId) return null;
    return (
      unscheduledDrafts.find((d) => d.id === selectedDraftId) ??
      scheduledDrafts.find((d) => d.id === selectedDraftId) ??
      null
    );
  }, [scheduledDrafts, selectedDraftId, unscheduledDrafts]);

  useEffect(() => {
    setCommentText("");
  }, [selectedDraftId]);

  useEffect(() => {
    setDraftContent(selectedDraft?.content ?? "");
  }, [selectedDraft?.id]);

  useEffect(() => {
    if (!isMonthPickerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const host = monthPickerRef.current;
      if (!host) return;
      if (!(e.target instanceof Node)) return;
      if (!host.contains(e.target)) setIsMonthPickerOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [isMonthPickerOpen]);

  useEffect(() => {
    if (!selectedDraftId) return;
    const stillExists =
      unscheduledDrafts.some((d) => d.id === selectedDraftId) || scheduledDrafts.some((d) => d.id === selectedDraftId);
    if (!stillExists) setSelectedDraftId(null);
  }, [scheduledDrafts, selectedDraftId, unscheduledDrafts]);

  const patchDraftInLists = (updated: DraftItem) => {
    setUnscheduledDrafts((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    setScheduledDrafts((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  };

  const getDraftMediaType = (draft: DraftItem): string => {
    const media = Array.isArray(draft.media) ? draft.media : [];
    const videos = media.filter((m) => m.kind === "video");
    const images = media.filter((m) => m.kind === "image");
    if (videos.length > 0) {
      const durations = videos.map((v) => (typeof v.duration_sec === "number" ? v.duration_sec : null)).filter((v) => v !== null);
      const max = durations.length > 0 ? Math.max(...(durations as number[])) : null;
      if (max === null) return "Short video";
      return max <= 60 ? "Short video" : "Long video";
    }
    if (images.length > 0) return "Image";
    return "Text";
  };

  const updateDraftTarget = async (next: { target_platform?: string | null; target_account?: string | null }) => {
    if (!selectedDraft) return;
    try {
      const { session } = await getSessionWithTimeout({ timeoutMs: 8000, retries: 2, retryDelayMs: 250 });
      const token = session?.access_token ?? null;
      if (!token) return;
      const res = await fetch(`/api/schedule-items/${encodeURIComponent(selectedDraft.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(next),
      });
      if (!res.ok) return;
      const updated = (await res.json()) as unknown;
      const updatedArr = parseRows([updated]);
      const row = updatedArr[0];
      if (!row) return;
      patchDraftInLists(row);
    } catch {
      void 0;
    }
  };

  const updateDraftContent = async (content: string) => {
    if (!selectedDraft) return;
    const next = content.toString();
    const prev = (selectedDraft.content ?? "").toString();
    if (next === prev) return;
    try {
      const { session } = await getSessionWithTimeout({ timeoutMs: 8000, retries: 2, retryDelayMs: 250 });
      const token = session?.access_token ?? null;
      if (!token) return;
      const res = await fetch(`/api/schedule-items/${encodeURIComponent(selectedDraft.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: next }),
      });
      if (!res.ok) return;
      const updated = (await res.json()) as unknown;
      const updatedArr = parseRows([updated]);
      const row = updatedArr[0];
      if (!row) return;
      patchDraftInLists(row);
    } catch {
      void 0;
    }
  };

  const handleSendComment = async () => {
    if (!selectedDraft) return;
    const text = commentText.trim();
    if (!text) return;
    if (sendingComment) return;
    setSendingComment(true);
    try {
      const { session } = await getSessionWithTimeout({ timeoutMs: 8000, retries: 2, retryDelayMs: 250 });
      const token = session?.access_token ?? null;
      if (!token) return;
      const res = await fetch(`/api/schedule-items/${encodeURIComponent(selectedDraft.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ comment: text }),
      });
      if (!res.ok) return;
      const updated = (await res.json()) as unknown;
      const updatedArr = parseRows([updated]);
      const next = updatedArr[0];
      if (!next) return;
      patchDraftInLists(next);
      setCommentText("");
    } finally {
      setSendingComment(false);
    }
  };

  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900">
      <CalendarHeader
        onCreatePost={() => setIsCreateModalOpen(true)}
        weekStart={weekStart}
        onWeekStartChange={handleWeekStartChange}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWeekAnchor((d) => subWeeks(d, 1))}
                  className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                  aria-label="Previous week"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setWeekAnchor((d) => addWeeks(d, 1))}
                  className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                  aria-label="Next week"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <div ref={monthPickerRef} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setMonthPickerYear(getYear(selectedDay));
                      setIsMonthPickerOpen((v) => !v);
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <span>{format(selectedDay, "MMM yyyy")}</span>
                    <ChevronDown className="h-4 w-4 text-zinc-400" />
                  </button>
                  {isMonthPickerOpen ? (
                    <div className="absolute left-0 top-full z-50 mt-3 w-[360px] rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_20px_50px_rgba(0,0,0,0.12)] dark:border-zinc-800 dark:bg-zinc-950">
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setMonthPickerYear((y) => y - 1)}
                          className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                          aria-label="Previous year"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <div className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{monthPickerYear}</div>
                        <button
                          type="button"
                          onClick={() => setMonthPickerYear((y) => y + 1)}
                          className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                          aria-label="Next year"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-4 grid grid-cols-4 gap-2">
                        {monthLabels.map((label, idx) => {
                          const active = monthPickerYear === getYear(selectedDay) && idx === getMonth(selectedDay);
                          return (
                            <button
                              key={label}
                              type="button"
                              onClick={() => {
                                const currentDay = selectedDay.getDate();
                                const max = getDaysInMonth(new Date(monthPickerYear, idx, 1));
                                const next = new Date(monthPickerYear, idx, Math.min(currentDay, max));
                                setSelectedDay(next);
                                setWeekAnchor(next);
                                setIsMonthPickerOpen(false);
                              }}
                              className={`rounded-full px-3 py-2 text-sm font-semibold transition-colors ${
                                active
                                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                                  : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const today = startOfToday();
                  setSelectedDay(today);
                  setWeekAnchor(today);
                }}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-zinc-900"
              >
                Today
              </button>
            </div>
            <div className="mt-3 grid grid-cols-7 gap-2">
              {weekDays.map((day) => {
                const isSelected = isSameDay(day, selectedDay);
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => {
                      setSelectedDay(day);
                      setWeekAnchor(day);
                    }}
                    className={`rounded-xl border px-2 py-2 text-left transition-colors ${
                      isSelected
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900"
                        : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <div className={`text-[11px] font-semibold ${isSelected ? "text-white/90 dark:text-zinc-900/80" : "text-zinc-500 dark:text-zinc-400"}`}>
                      {format(day, "EEE")}
                    </div>
                    <div className="text-sm font-bold">{format(day, "d")}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {loading && unscheduledDrafts.length === 0 && scheduledDrafts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                Loading...
              </div>
            ) : (
              <div className="flex flex-col gap-8">
                <section>
                  <div className="mb-4 flex items-baseline justify-between">
                    <div className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Unscheduled Drafts</div>
                    <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{unscheduledDrafts.length}</div>
                  </div>
                  {unscheduledDrafts.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                      No drafts yet.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {unscheduledDrafts.map((d) => {
                        const active = selectedDraftId === d.id;
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => setSelectedDraftId(d.id)}
                            className={`flex flex-col justify-between rounded-2xl border bg-white p-4 text-left shadow-[0_10px_20px_rgba(0,0,0,0.06)] transition-colors hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800 ${
                              active ? "border-zinc-900 dark:border-white" : "border-zinc-100 dark:border-zinc-800"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50 line-clamp-4">
                                {d.content || "Untitled"}
                              </div>
                              <span className="shrink-0 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                                {getDraftMediaType(d)}
                              </span>
                            </div>
                            <div className="mt-4 text-xs text-zinc-400">
                              Updated {d.updated_at ? new Date(d.updated_at).toLocaleString() : "-"}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section>
                  <div className="mb-4 flex items-baseline justify-between">
                    <div className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                      Drafts on {format(selectedDay, "MMM d")}
                    </div>
                    <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{scheduledDrafts.length}</div>
                  </div>
                  {scheduledDrafts.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                      No drafts scheduled for this day.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {scheduledDrafts.map((d) => {
                        const active = selectedDraftId === d.id;
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => setSelectedDraftId(d.id)}
                            className={`flex flex-col justify-between rounded-2xl border bg-white p-4 text-left shadow-[0_10px_20px_rgba(0,0,0,0.06)] transition-colors hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800 ${
                              active ? "border-zinc-900 dark:border-white" : "border-zinc-100 dark:border-zinc-800"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50 line-clamp-4">
                                {d.content || "Untitled"}
                              </div>
                              <span className="shrink-0 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                                {getDraftMediaType(d)}
                              </span>
                            </div>
                            <div className="mt-4 text-xs text-zinc-400">
                              Updated {d.updated_at ? new Date(d.updated_at).toLocaleString() : "-"}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>

        <div
          className={`shrink-0 overflow-hidden border-l border-zinc-200 bg-white transition-[width] duration-200 dark:border-zinc-800 dark:bg-zinc-900 ${
            selectedDraft ? "w-[380px]" : "w-0"
          }`}
        >
          <div className={`flex h-full flex-col ${selectedDraft ? "opacity-100" : "opacity-0"} transition-opacity duration-150`}>
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Draft</div>
                {selectedDraft ? (
                  <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                    {getDraftMediaType(selectedDraft)}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {selectedDraft?.status === "published" ? (
                  <button
                    type="button"
                    onClick={() => {
                      const url = (selectedDraft.view_url ?? "").toString().trim();
                      if (!url) return;
                      window.open(url, "_blank", "noopener,noreferrer");
                    }}
                    disabled={!selectedDraft.view_url}
                    className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
                  >
                    View post
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSelectedDraftId(null)}
                  className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {selectedDraft ? (
              <>
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <div>
                      <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Content</div>
                      {selectedDraft.status === "published" ? (
                        <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-50">
                          {selectedDraft.content || "Untitled"}
                        </div>
                      ) : (
                        <textarea
                          value={draftContent}
                          onChange={(e) => setDraftContent(e.target.value)}
                          onBlur={() => void updateDraftContent(draftContent)}
                          className="mt-2 min-h-[120px] w-full resize-none rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-100"
                        />
                      )}
                      <div className="mt-3 text-xs text-zinc-400">
                        Updated {selectedDraft.updated_at ? new Date(selectedDraft.updated_at).toLocaleString() : "-"}
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-2 gap-2">
                      <div>
                        <div className="mb-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">Target platform</div>
                        {selectedDraft.status === "published" ? (
                          <div className="h-9 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2 text-sm leading-9 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50">
                            {(selectedDraft.target_platform ?? "-").toString() || "-"}
                          </div>
                        ) : (
                          <select
                            value={(selectedDraft.target_platform ?? "").toString()}
                            onChange={(e) => {
                              const v = e.target.value || null;
                              const account = mockAccounts.find((a) => a.platform === v)?.id ?? null;
                              void updateDraftTarget({ target_platform: v, target_account: account });
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
                        {selectedDraft.status === "published" ? (
                          <div className="h-9 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2 text-sm leading-9 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50">
                            {(selectedDraft.target_account ?? "-").toString() || "-"}
                          </div>
                        ) : (
                          <select
                            value={(selectedDraft.target_account ?? "").toString()}
                            onChange={(e) => void updateDraftTarget({ target_account: e.target.value || null })}
                            className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-100"
                          >
                            <option value="">Select</option>
                            {Array.from(
                              new Map(
                                [
                                  ...mockAccounts
                                    .filter((a) => !selectedDraft.target_platform || a.platform === selectedDraft.target_platform)
                                    .map((a) => [a.id, a.name]),
                                  ...(selectedDraft.target_account ? [[selectedDraft.target_account, selectedDraft.target_account]] : []),
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

                    <div className="mt-6">
                      <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Comments</div>
                      <div className="mt-2 flex flex-col gap-3">
                        {selectedDraft.comments.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                            No comments yet.
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {selectedDraft.comments
                              .slice()
                              .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))
                              .map((c) => (
                                <div key={c.id} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                                  <div className="text-xs text-zinc-400">
                                    {c.created_at ? new Date(c.created_at).toLocaleString() : "-"}
                                  </div>
                                  <div className="mt-1 whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-50">
                                    {c.content}
                                  </div>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 border-t border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
                    <div className="relative">
                      <textarea
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          if (e.shiftKey) return;
                          if ((e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) return;
                          if (sendingComment || commentText.trim().length === 0) return;
                          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                            e.preventDefault();
                            void handleSendComment();
                            return;
                          }
                          e.preventDefault();
                          void handleSendComment();
                        }}
                        placeholder="Write a comment…"
                        className="h-24 w-full resize-none rounded-xl border border-zinc-200 bg-white p-3 pr-12 pb-12 text-sm text-zinc-900 shadow-[0_12px_30px_rgba(0,0,0,0.10)] outline-none focus:border-zinc-500 focus:ring-0 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:shadow-[0_12px_30px_rgba(0,0,0,0.35)] dark:focus:border-zinc-600"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSendComment()}
                        disabled={sendingComment || commentText.trim().length === 0}
                        className="absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
                        aria-label="Send comment"
                        title="Send (Enter)"
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 p-4 text-sm text-zinc-500 dark:text-zinc-400">Select a draft to preview.</div>
            )}
          </div>
        </div>
      </div>

      <CreatePostModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={async (data) => {
          const { session } = await getSessionWithTimeout({ timeoutMs: 8000, retries: 2, retryDelayMs: 250 });
          const token = session?.access_token ?? null;
          if (!token) return { ok: false, error: "Please sign in first." };

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
              target_platform: data.targetPlatform ?? null,
              target_account: data.targetAccount ?? null,
              media: data.media ?? [],
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
            return { ok: false, error: msg ?? "Failed to save. Please try again." };
          }
          await refreshUnscheduledDrafts();
          await refreshScheduledDraftsForDay(selectedDayKey);
          return { ok: true, viewUrl };
        }}
      />
    </div>
  );
}
