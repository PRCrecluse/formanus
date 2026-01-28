"use client";

import { ChevronLeft, ChevronRight, Filter, LayoutGrid, List, Calendar as CalendarIcon, Check, X } from "lucide-react";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { useState } from "react";

interface CalendarToolbarProps {
  currentDate: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  viewMode: "day" | "week" | "month";
  onViewModeChange: (mode: "day" | "week" | "month") => void;
  weekStartsOn: 0 | 1;
}

export function CalendarToolbar({
  currentDate,
  onPrev,
  onNext,
  onToday,
  viewMode,
  onViewModeChange,
  weekStartsOn,
}: CalendarToolbarProps) {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterView, setFilterView] = useState<"main" | "accounts" | "status" | "tags" | "author">("main");
  const [selectedAccount, setSelectedAccount] = useState("Me");
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const handleAddTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()]);
      setNewTag("");
    }
  };

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter(t => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const dateRange = (() => {
    if (viewMode === "day") return format(currentDate, "MMM d, yyyy");
    if (viewMode === "month") return format(currentDate, "MMMM yyyy");
    
    const start = startOfWeek(currentDate, { weekStartsOn });
    const end = endOfWeek(currentDate, { weekStartsOn });
    
    if (start.getMonth() === end.getMonth()) {
      return `${format(start, "MMM d")} - ${format(end, "d, yyyy")}`;
    }
    return `${format(start, "MMM d")} - ${format(end, "MMM d, yyyy")}`;
  })();

  const renderFilterContent = () => {
    if (filterView === "main") {
      return (
        <div className="flex flex-col w-64">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <span className="font-bold text-zinc-900 dark:text-zinc-50">Filters</span>
            <button onClick={() => setIsFilterOpen(false)} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50">
              <X className="h-4 w-4" />
            </button>
          </div>
          
          {/* List */}
          <div className="flex flex-col py-2">
             <button 
               onClick={() => setFilterView("accounts")}
               className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
             >
               <div className="flex flex-col items-start">
                 <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Social accounts</span>
                 <span className="text-xs text-zinc-500">{selectedAccount}</span>
               </div>
               <ChevronRight className="h-4 w-4 text-zinc-400" />
             </button>
             
             <button 
               onClick={() => setFilterView("status")}
               className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
             >
               <div className="flex flex-col items-start">
                 <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Post status</span>
                 <span className="text-xs text-zinc-500">All</span>
               </div>
               <ChevronRight className="h-4 w-4 text-zinc-400" />
             </button>

             <button 
               onClick={() => setFilterView("tags")}
               className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
             >
               <div className="flex flex-col items-start">
                 <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Tags</span>
                 <span className="text-xs text-zinc-500">All</span>
               </div>
               <ChevronRight className="h-4 w-4 text-zinc-400" />
             </button>

             <button 
               onClick={() => setFilterView("author")}
               className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
             >
               <div className="flex flex-col items-start">
                 <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Author</span>
                 <span className="text-xs text-zinc-500">All</span>
               </div>
               <ChevronRight className="h-4 w-4 text-zinc-400" />
             </button>
          </div>
        </div>
      );
    }

    if (filterView === "accounts") {
        return (
            <div className="flex flex-col w-64">
                <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                    <button onClick={() => setFilterView("main")} className="hover:bg-zinc-100 rounded p-1 dark:hover:bg-zinc-800"><ChevronLeft className="h-4 w-4"/></button>
                    <span className="font-bold text-sm">Social accounts</span>
                </div>
                <div className="p-2">
                    <button onClick={() => { setSelectedAccount("Me"); setFilterView("main"); }} className="flex w-full items-center justify-between rounded-md p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                        <span className="text-sm">Me</span>
                        {selectedAccount === "Me" && <Check className="h-4 w-4 text-zinc-900 dark:text-zinc-50"/>}
                    </button>
                </div>
            </div>
        )
    }

    if (filterView === "status") {
        return (
            <div className="flex flex-col w-64 max-h-[400px] overflow-y-auto">
                <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sticky top-0 bg-white dark:bg-zinc-950 z-10">
                    <button onClick={() => setFilterView("main")} className="hover:bg-zinc-100 rounded p-1 dark:hover:bg-zinc-800"><ChevronLeft className="h-4 w-4"/></button>
                    <span className="font-bold text-sm">Post status</span>
                </div>
                <div className="p-2">
                    <div className="px-2 py-1 text-xs font-bold text-zinc-500 uppercase">Posts</div>
                    {["Drafts", "Scheduled", "Published", "Failed", "Disconnected"].map(status => (
                        <button key={status} className="flex w-full items-center gap-2 rounded-md p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                            <div className="h-4 w-4 rounded border border-zinc-300 dark:border-zinc-600" />
                            <span className="text-sm">{status}</span>
                        </button>
                    ))}
                    
                    <div className="mt-2 px-2 py-1 text-xs font-bold text-zinc-500 uppercase">Ads</div>
                    {["Scheduled", "Active", "Paused", "Completed", "With Issues"].map(status => (
                        <button key={status} className="flex w-full items-center gap-2 rounded-md p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                            <div className="h-4 w-4 rounded border border-zinc-300 dark:border-zinc-600" />
                            <span className="text-sm">{status}</span>
                        </button>
                    ))}
                </div>
            </div>
        )
    }

    if (filterView === "tags") {
        return (
             <div className="flex flex-col w-64">
                <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                    <button onClick={() => setFilterView("main")} className="hover:bg-zinc-100 rounded p-1 dark:hover:bg-zinc-800"><ChevronLeft className="h-4 w-4"/></button>
                    <span className="font-bold text-sm">Tags</span>
                </div>
                <div className="p-3">
                    <div className="mb-3 flex gap-2">
                        <input
                            type="text"
                            value={newTag}
                            onChange={(e) => setNewTag(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                            placeholder="Create a tag..."
                            className="flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                        />
                        <button 
                            onClick={handleAddTag}
                            disabled={!newTag.trim()}
                            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
                        >
                            Add
                        </button>
                    </div>
                    
                    {tags.length === 0 ? (
                        <div className="text-center text-sm text-zinc-500 py-2">
                            No tags created yet.
                        </div>
                    ) : (
                        <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
                            {tags.map(tag => (
                                <button
                                    key={tag}
                                    onClick={() => toggleTag(tag)}
                                    className="flex items-center justify-between rounded-md p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                >
                                    <span className="text-sm">{tag}</span>
                                    {selectedTags.includes(tag) && <Check className="h-3.5 w-3.5 text-zinc-900 dark:text-zinc-50" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        )
    }

    if (filterView === "author") {
        return (
             <div className="flex flex-col w-64">
                <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                    <button onClick={() => setFilterView("main")} className="hover:bg-zinc-100 rounded p-1 dark:hover:bg-zinc-800"><ChevronLeft className="h-4 w-4"/></button>
                    <span className="font-bold text-sm">Author</span>
                </div>
                <div className="p-2">
                     <button className="flex w-full items-center gap-2 rounded-md p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                        <div className="h-4 w-4 rounded border border-zinc-300 dark:border-zinc-600" />
                        <span className="text-sm">Current User</span>
                    </button>
                </div>
            </div>
        )
    }
  };

  return (
    <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={onToday}
            className="rounded-md px-3 py-1.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Today
          </button>
          <button
            onClick={onNext}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        
        <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
          {dateRange}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
          <button
            onClick={() => onViewModeChange("day")}
            className={`rounded-md p-1.5 transition-colors ${
              viewMode === "day"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
            }`}
            title="Day view"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={() => onViewModeChange("week")}
            className={`rounded-md p-1.5 transition-colors ${
              viewMode === "week"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
            }`}
            title="Week view"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => onViewModeChange("month")}
            className={`rounded-md p-1.5 transition-colors ${
              viewMode === "month"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
            }`}
            title="Month view"
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="relative">
          <button 
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              isFilterOpen 
                ? "border-blue-500 bg-blue-50 text-blue-600 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-400"
                : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            <Filter className="h-4 w-4" />
            <span>Filters</span>
          </button>
          
          {isFilterOpen && (
            <>
                <div className="fixed inset-0 z-10" onClick={() => setIsFilterOpen(false)} />
                <div className="absolute right-0 top-full z-20 mt-2 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
                    {renderFilterContent()}
                </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
