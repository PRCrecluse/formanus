"use client";

import { 
  startOfWeek, 
  endOfWeek, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  addDays, 
  format, 
  isSameDay, 
  isSameMonth 
} from "date-fns";
import { MoreHorizontal } from "lucide-react";
import { useMemo } from "react";

interface Post {
  id: string;
  content: string;
  scheduledAt: Date;
  account: string;
  type: "post" | "story" | "reel";
  status: "draft" | "scheduled" | "published";
}

interface CalendarGridProps {
  currentDate: Date;
  viewMode: "day" | "week" | "month";
  weekStartsOn: 0 | 1;
  posts?: Post[];
  selectedDay?: Date | null;
  onDayClick?: (day: Date) => void;
  onPostClick?: (postId: string) => void;
}

export function CalendarGrid({
  currentDate,
  viewMode,
  weekStartsOn,
  posts = [],
  selectedDay = null,
  onDayClick,
  onPostClick,
}: CalendarGridProps) {
  const days = useMemo(() => {
    if (viewMode === "day") return [currentDate];
    
    if (viewMode === "week") {
      const start = startOfWeek(currentDate, { weekStartsOn });
      return Array.from({ length: 7 }).map((_, i) => addDays(start, i));
    }
    
    if (viewMode === "month") {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      const start = startOfWeek(monthStart, { weekStartsOn });
      const end = endOfWeek(monthEnd, { weekStartsOn });
      return eachDayOfInterval({ start, end });
    }
    
    return [];
  }, [currentDate, viewMode, weekStartsOn]);

  const gridClassName = useMemo(() => {
    if (viewMode === "day") return "grid-cols-1";
    return "grid-cols-7";
  }, [viewMode]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-950" data-view-mode={viewMode}>
      {/* Header Row */}
      <div className={`grid ${gridClassName} border-b border-zinc-200 dark:border-zinc-800`}>
        {viewMode === "month" ? (
          // Month View Header: Just Day Names
          (weekStartsOn === 1
            ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
          ).map((dayName, i, all) => (
            <div
              key={dayName}
              className={`flex items-center justify-center border-r border-zinc-200 py-2 dark:border-zinc-800 ${
                i === all.length - 1 ? "border-r-0" : ""
              }`}
            >
              <span className="text-xs font-bold uppercase text-zinc-500 dark:text-zinc-400">
                {dayName}
              </span>
            </div>
          ))
        ) : (
          // Week/Day View Header: Day Name + Date
          days.map((day, i) => (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onDayClick?.(day)}
              className={`flex flex-col items-center justify-center border-r border-zinc-200 py-3 dark:border-zinc-800 ${
                i === days.length - 1 ? "border-r-0" : ""
              } hover:bg-zinc-50/60 dark:hover:bg-zinc-900/30`}
            >
              <span className="text-xs font-bold uppercase text-zinc-500 dark:text-zinc-400">
                {format(day, "EEE")}
              </span>
              <span className={`mt-1 text-xl font-bold ${
                isSameDay(day, new Date()) 
                  ? "text-blue-600 dark:text-blue-400" 
                  : "text-zinc-900 dark:text-zinc-50"
              }`}>
                {format(day, "d")}
              </span>
            </button>
          ))
        )}
      </div>

      {/* Grid Content */}
      <div className="flex flex-1 overflow-y-auto">
        <div className={`grid w-full ${gridClassName} ${viewMode === "month" ? "auto-rows-min" : ""}`}>
          {days.map((day, i) => {
            const dayPosts = posts
              .filter((p) => isSameDay(p.scheduledAt, day))
              .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
            const isCurrentMonth = viewMode !== "month" || isSameMonth(day, currentDate);
            const isMonth = viewMode === "month";
            const visiblePosts = isMonth ? dayPosts.slice(0, 3) : dayPosts;
            const remainingCount = isMonth ? Math.max(0, dayPosts.length - visiblePosts.length) : 0;
            const dotClassForStatus = (status: Post["status"]) => {
              if (status === "published") return "bg-green-500";
              if (status === "scheduled") return "bg-blue-500";
              return "bg-zinc-400";
            };
            
            return (
              <div
                key={day.toISOString()}
                onClick={() => onDayClick?.(day)}
                className={`
                  border-r border-zinc-200 p-2 transition-colors 
                  hover:bg-zinc-50/50 dark:border-zinc-800 dark:hover:bg-zinc-900/20
                  ${!isCurrentMonth ? "bg-zinc-50/30 dark:bg-zinc-900/10" : ""}
                  ${(i + 1) % 7 === 0 ? "border-r-0" : ""}
                  ${isMonth ? "min-h-[120px] border-b" : "min-h-[500px]"}
                  ${selectedDay && isSameDay(day, selectedDay) ? "ring-2 ring-blue-500 ring-inset" : ""}
                `}
              >
                {/* For Month view, show date number in cell */}
                {viewMode === "month" && (
                  <div className={`mb-2 text-right text-xs font-medium ${
                    isSameDay(day, new Date())
                      ? "text-blue-600 dark:text-blue-400"
                      : !isCurrentMonth
                        ? "text-zinc-400 dark:text-zinc-600"
                        : "text-zinc-700 dark:text-zinc-300"
                  }`}>
                    {format(day, "d")}
                  </div>
                )}

                {isMonth ? (
                  <div className="flex flex-col gap-1">
                    {visiblePosts.map((post) => (
                      <button
                        key={post.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPostClick?.(post.id);
                        }}
                        className="group flex items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                        title={post.content}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClassForStatus(post.status)}`} />
                        <span className="min-w-0 flex-1 truncate">{post.content || "Untitled"}</span>
                      </button>
                    ))}
                    {remainingCount > 0 ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDayClick?.(day);
                        }}
                        className="w-fit rounded-md px-2 py-1 text-[11px] font-semibold text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                      >
                        +{remainingCount}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {dayPosts.map((post) => (
                      <div
                        key={post.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onPostClick?.(post.id);
                        }}
                        className="group cursor-pointer rounded-lg border border-zinc-200 bg-white p-2 shadow-sm transition-all hover:border-blue-500 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800"
                      >
                        <div className="mb-1.5 flex items-center justify-between">
                          <div className={`h-1.5 w-1.5 rounded-full ${dotClassForStatus(post.status)}`} />
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            className="opacity-0 transition-opacity group-hover:opacity-100 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          >
                            <MoreHorizontal className="h-3 w-3" />
                          </button>
                        </div>
                        <p className="line-clamp-2 text-xs font-medium text-zinc-700 dark:text-zinc-200">
                          {post.content}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase">
                            {format(post.scheduledAt, "h:mm a")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
