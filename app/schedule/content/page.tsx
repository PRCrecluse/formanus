"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarHeader } from "@/components/schedule/CalendarHeader";
import { CreatePostModal } from "@/components/schedule/CreatePostModal";
import { ChevronDown, Filter, Check, X } from "lucide-react";
import { getSessionWithTimeout } from "@/lib/supabaseClient";

type WeekStart = "sunday" | "monday";

type Persona = { id: string; name: string | null; avatar_url?: string | null };
type ScheduleItem = {
  id: string;
  persona_id: string | null;
  content: string;
  status: "draft" | "scheduled" | "published";
  type: "post" | "story" | "reel";
  accounts: string[];
  event_at: string | null;
  created_at: string;
  updated_at: string;
};

export default function ScheduleContentLibraryPage() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [weekStart, setWeekStart] = useState<WeekStart>(() => {
    if (typeof window === "undefined") return "sunday";
    const stored = window.localStorage.getItem("schedule.weekStart");
    return stored === "monday" ? "monday" : "sunday";
  });

  const [libraryScope, setLibraryScope] = useState<string>("Library");

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectedLibraries, setSelectedLibraries] = useState<string[]>([]);

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(false);

  const handleWeekStartChange = (value: WeekStart) => {
    setWeekStart(value);
    localStorage.setItem("schedule.weekStart", value);
  };

  const libraryOptions = useMemo(() => personas.map((p) => ({ id: p.id, label: (p.name ?? "Untitled Persona").toString() })), [personas]);

  const toggle = (arr: string[], value: string) => (arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]);

  const personaLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of personas) map.set(p.id, (p.name ?? "Untitled Persona").toString());
    return map;
  }, [personas]);

  const refresh = async () => {
    const { session } = await getSessionWithTimeout({ timeoutMs: 8000, retries: 2, retryDelayMs: 250 });
    const token = session?.access_token ?? null;
    if (!token) {
      setPersonas([]);
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const [personasRes, itemsRes] = await Promise.all([
        fetch("/api/personas", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/schedule-items", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const p = personasRes.ok ? ((await personasRes.json()) as Persona[]) : [];
      const it = itemsRes.ok ? ((await itemsRes.json()) as ScheduleItem[]) : [];
      setPersonas(Array.isArray(p) ? p : []);
      setItems(Array.isArray(it) ? it : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (item.type !== "post") return false;
      if (item.status !== "published") return false;
      if (selectedLibraries.length > 0 && !selectedLibraries.includes(item.persona_id ?? "no_persona")) return false;
      return true;
    });
  }, [items, selectedLibraries]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900">
      <CalendarHeader
        onCreatePost={() => setIsCreateModalOpen(true)}
        weekStart={weekStart}
        onWeekStartChange={handleWeekStartChange}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Content library</h1>
              <button
                type="button"
                onClick={() => setLibraryScope((v) => (v === "Library" ? "Default library" : "Library"))}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <span>{libraryScope}</span>
                <ChevronDown className="h-4 w-4 text-zinc-400" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Sort by Newest
                <ChevronDown className="h-4 w-4 text-zinc-400" />
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsFilterOpen((v) => !v)}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                    isFilterOpen
                      ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  }`}
                >
                  <Filter className="h-4 w-4" />
                  Filter
                  <ChevronDown className="h-4 w-4 opacity-70" />
                </button>

                {isFilterOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsFilterOpen(false)} />
                    <div className="absolute right-0 top-full z-20 mt-2 w-80 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
                      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                        <div className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Filter</div>
                        <button
                          type="button"
                          onClick={() => setIsFilterOpen(false)}
                          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="max-h-[420px] overflow-y-auto p-3">
                        <div className="mb-4">
                          <div className="mb-2 text-xs font-bold uppercase text-zinc-500">Library</div>
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              onClick={() => setSelectedLibraries((arr) => toggle(arr, "no_persona"))}
                              className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                            >
                              <span className="text-zinc-700 dark:text-zinc-200">No persona</span>
                              {selectedLibraries.includes("no_persona") && (
                                <Check className="h-4 w-4 text-zinc-900 dark:text-zinc-50" />
                              )}
                            </button>
                            {libraryOptions.map((opt) => {
                              const on = selectedLibraries.includes(opt.id);
                              return (
                                <button
                                  type="button"
                                  key={opt.id}
                                  onClick={() => setSelectedLibraries((arr) => toggle(arr, opt.id))}
                                  className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                                >
                                  <span className="text-zinc-700 dark:text-zinc-200">{opt.label}</span>
                                  {on && <Check className="h-4 w-4 text-zinc-900 dark:text-zinc-50" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedLibraries([]);
                          }}
                          className="text-sm font-semibold text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsFilterOpen(false)}
                          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
              Loading...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-950">
              <div className="text-xl font-bold text-zinc-900 dark:text-zinc-50">No items found</div>
              <div className="mt-2 text-sm text-zinc-500">Try adjusting your filters.</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  className="group flex flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_10px_20px_rgba(0,0,0,0.06)] transition-shadow hover:shadow-[0_10px_20px_rgba(0,0,0,0.08)] dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs font-bold uppercase text-zinc-500">
                        {item.persona_id ? personaLabelById.get(item.persona_id) ?? item.persona_id : "No persona"}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 line-clamp-3">{item.content}</div>
                  </div>
                  <div className="mt-4 text-xs text-zinc-400">Updated {new Date(item.updated_at).toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
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
          await refresh();
          return { ok: true, viewUrl: null };
        }}
      />
    </div>
  );
}
