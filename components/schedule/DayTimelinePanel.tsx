"use client";

import { format } from "date-fns";
import { X } from "lucide-react";
import { useMemo } from "react";

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

type Persona = { id: string; name: string | null; avatar_url?: string | null };

export function DayTimelinePanel({
  isOpen,
  date,
  items,
  personas,
  loading,
  onClose,
  onItemClick,
}: {
  isOpen: boolean;
  date: Date;
  items: ScheduleItem[];
  personas: Persona[];
  loading: boolean;
  onClose: () => void;
  onItemClick?: (itemId: string) => void;
}) {
  const personaNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of personas) {
      map.set(p.id, (p.name ?? "Untitled Persona").toString());
    }
    return map;
  }, [personas]);

  if (!isOpen) return null;

  return (
    <div className="absolute right-0 top-0 h-full w-[380px] border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div>
          <div className="text-xs font-bold uppercase text-zinc-500"> {format(date, "EEE")} </div>
          <div className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">{format(date, "MMM d")}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="h-full overflow-y-auto p-4 pb-24">
        {loading ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
            Loading...
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
            No scheduled items.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((it) => {
              const when = it.event_at ? new Date(it.event_at) : null;
              const timeLabel = when ? format(when, "h:mmaaa") : "";
              const personaLabel = it.persona_id ? personaNameById.get(it.persona_id) ?? it.persona_id : "No persona";
              const statusLabel = it.status === "scheduled" ? "Scheduled" : it.status === "published" ? "Published" : "Draft";
              const badgeClass =
                it.status === "published"
                  ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                  : it.status === "scheduled"
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => onItemClick?.(it.id)}
                  className="w-full rounded-2xl border border-zinc-200 bg-white p-4 text-left shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-50">{personaLabel}</div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClass}`}>{statusLabel}</span>
                      </div>
                      <div className="mt-2 line-clamp-3 text-sm text-zinc-700 dark:text-zinc-200">{it.content}</div>
                    </div>
                    <div className="shrink-0 text-xs font-bold text-zinc-500">{timeLabel}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
