"use client";

import { Calendar, FileText, Settings, Plus, Info, Check, Link2, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { getMembershipStatusWithTimeout, getSessionWithTimeout } from "@/lib/supabaseClient";

interface CalendarHeaderProps {
  onCreatePost: () => void;
  weekStart: "sunday" | "monday";
  onWeekStartChange: (value: "sunday" | "monday") => void;
}

type NotionStatus = {
  configured: boolean;
  connected: boolean;
  workspaceName: string | null;
  syncToEnabled: boolean;
  importEnabled: boolean;
  parentPageId: string | null;
  databaseId: string | null;
  requestId?: string | null;
};

type GoogleCalendarStatus = {
  configured: boolean;
  connected: boolean;
  calendarId: string | null;
  syncToEnabled: boolean;
  importEnabled: boolean;
  requestId?: string | null;
};

export function CalendarHeader({ onCreatePost, weekStart, onWeekStartChange }: CalendarHeaderProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showRecommendedTimes, setShowRecommendedTimes] = useState(true);
  const [showSocialPosts, setShowSocialPosts] = useState(true);
  const [isConnectionsOpen, setIsConnectionsOpen] = useState(false);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsMessage, setConnectionsMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [connectionsBusy, setConnectionsBusy] = useState<"notion_sync" | "notion_import" | "gcal_sync" | "gcal_import" | null>(null);
  const [notionParentPageIdInput, setNotionParentPageIdInput] = useState("");
  const [notionDatabaseIdInput, setNotionDatabaseIdInput] = useState("");
  const [membershipStatus, setMembershipStatus] = useState<string>("free");

  const [notionStatus, setNotionStatus] = useState<NotionStatus | null>(null);
  const [gcalStatus, setGcalStatus] = useState<GoogleCalendarStatus | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  const activeTab =
    pathname.startsWith("/schedule/content")
      ? "content"
      : pathname.startsWith("/schedule/drafts")
        ? "drafts"
        : "calendar";

  const tabs = [
    { id: "calendar", label: "Calendar", icon: Calendar, href: "/schedule" },
    { id: "content", label: "Content", icon: FileText, href: "/schedule/content" },
    { id: "drafts", label: "Drafts", icon: FileText, href: "/schedule/drafts" },
  ];

  const canInteract = useMemo(() => connectionsBusy === null, [connectionsBusy]);
  const connectionsLoadInFlightRef = useRef(false);
  const lastConnectionsLoadedAtRef = useRef<number | null>(null);
  const notionStatusRef = useRef<NotionStatus | null>(null);
  const gcalStatusRef = useRef<GoogleCalendarStatus | null>(null);
  const isFreeUser = membershipStatus === "free";

  const openUpgradeModal = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("aipersona:open-upgrade"));
  }, []);

  useEffect(() => {
    notionStatusRef.current = notionStatus;
  }, [notionStatus]);

  useEffect(() => {
    gcalStatusRef.current = gcalStatus;
  }, [gcalStatus]);

  const fetchWithTimeout = useCallback(async (input: RequestInfo | URL, init: RequestInit, timeoutMs: number) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  const loadConnections = useCallback(async (options?: { silent?: boolean; showLoading?: boolean; maxAgeMs?: number; hydrateInputs?: boolean }) => {
    if (connectionsLoadInFlightRef.current) return;
    const silent = Boolean(options?.silent);
    const maxAgeMs = options?.maxAgeMs ?? 20_000;
    const hydrateInputs = options?.hydrateInputs ?? true;
    const now = Date.now();
    const lastLoadedAt = lastConnectionsLoadedAtRef.current;
    const hasCached =
      Boolean(notionStatusRef.current) &&
      Boolean(gcalStatusRef.current) &&
      typeof lastLoadedAt === "number" &&
      now - lastLoadedAt < maxAgeMs;
    if (hasCached) return;

    connectionsLoadInFlightRef.current = true;
    if (options?.showLoading) setConnectionsLoading(true);
    if (!silent) setConnectionsMessage(null);
    try {
      const { session } = await getSessionWithTimeout({ timeoutMs: 8000, retries: 2, retryDelayMs: 250 });
      const token = session?.access_token ?? null;
      if (!token) {
        setNotionStatus(null);
        setGcalStatus(null);
        if (!silent) setConnectionsMessage({ type: "error", text: "Please sign in to manage connections." });
        return;
      }

      const [notionSettled, gcalSettled] = await Promise.allSettled([
        fetchWithTimeout("/api/integrations/notion/status", { headers: { Authorization: `Bearer ${token}` } }, 12_000),
        fetchWithTimeout("/api/integrations/google-calendar/status", { headers: { Authorization: `Bearer ${token}` } }, 12_000),
      ]);

      const notionRes = notionSettled.status === "fulfilled" ? notionSettled.value : null;
      const gcalRes = gcalSettled.status === "fulfilled" ? gcalSettled.value : null;

      const notionJson = (await notionRes?.json().catch(() => null)) as Record<string, unknown> | null;
      const gcalJson = (await gcalRes?.json().catch(() => null)) as Record<string, unknown> | null;

      if (!notionRes || !gcalRes || !notionRes.ok || !gcalRes.ok) {
        if (!silent) setConnectionsMessage({ type: "error", text: "Failed to load connections. Please try again." });
      }

      setNotionStatus({
        configured: Boolean(notionJson?.configured),
        connected: Boolean(notionJson?.connected),
        workspaceName: typeof notionJson?.workspaceName === "string" ? (notionJson.workspaceName as string) : null,
        syncToEnabled: Boolean(notionJson?.syncToEnabled),
        importEnabled: Boolean(notionJson?.importEnabled),
        parentPageId: typeof notionJson?.parentPageId === "string" ? (notionJson.parentPageId as string) : null,
        databaseId: typeof notionJson?.databaseId === "string" ? (notionJson.databaseId as string) : null,
        requestId: typeof notionJson?.requestId === "string" ? (notionJson.requestId as string) : null,
      });

      setGcalStatus({
        configured: Boolean(gcalJson?.configured),
        connected: Boolean(gcalJson?.connected),
        calendarId: typeof gcalJson?.calendarId === "string" ? (gcalJson.calendarId as string) : null,
        syncToEnabled: Boolean(gcalJson?.syncToEnabled),
        importEnabled: Boolean(gcalJson?.importEnabled),
        requestId: typeof gcalJson?.requestId === "string" ? (gcalJson.requestId as string) : null,
      });

      if (hydrateInputs) {
        if (typeof notionJson?.parentPageId === "string") {
          const value = notionJson.parentPageId as string;
          setNotionParentPageIdInput((prev) => (prev ? prev : value));
        }
        if (typeof notionJson?.databaseId === "string") {
          const value = notionJson.databaseId as string;
          setNotionDatabaseIdInput((prev) => (prev ? prev : value));
        }
      }
      lastConnectionsLoadedAtRef.current = Date.now();
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Failed to load connections.";
      if (!silent) setConnectionsMessage({ type: "error", text });
    } finally {
      if (options?.showLoading) setConnectionsLoading(false);
      connectionsLoadInFlightRef.current = false;
    }
  }, [fetchWithTimeout]);

  useEffect(() => {
    if (!isConnectionsOpen) return;
    void loadConnections({ showLoading: true, hydrateInputs: true });
  }, [isConnectionsOpen, loadConnections]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const status = await getMembershipStatusWithTimeout({
        sessionTimeoutMs: 2500,
        sessionRetries: 2,
        sessionRetryDelayMs: 120,
      });
      if (!cancelled) setMembershipStatus(status);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const notionTwoWayEnabled = Boolean(notionStatus?.syncToEnabled && notionStatus?.importEnabled);

  const runCalendarAction = async (
    provider: "notion" | "google-calendar",
    action: "sync_to" | "import_from",
    enabled: boolean,
    options?: { mode?: "auto" | "run_once"; body?: Record<string, unknown> }
  ) => {
    if (isFreeUser) {
      openUpgradeModal();
      return null;
    }
    setConnectionsMessage(null);
    const mode = options?.mode ?? "auto";
    const busyKey =
      provider === "notion"
        ? action === "sync_to"
          ? "notion_sync"
          : "notion_import"
        : action === "sync_to"
          ? "gcal_sync"
          : "gcal_import";

    if (provider === "notion" && enabled) {
      const hasStoredDatabase = Boolean(notionStatus?.databaseId);
      if (action === "sync_to") {
        const parent = notionParentPageIdInput.trim();
        if (!parent && !hasStoredDatabase) {
          setConnectionsMessage({ type: "error", text: "Please provide a Destination Notion page URL or ID." });
          return;
        }
      }
      if (action === "import_from") {
        const db = notionDatabaseIdInput.trim();
        if (!db && !hasStoredDatabase) {
          setConnectionsMessage({ type: "error", text: "Please provide a Notion database URL or ID." });
          return;
        }
      }
    }

    setConnectionsBusy(busyKey);
    try {
      const { session } = await getSessionWithTimeout({ timeoutMs: 8000, retries: 2, retryDelayMs: 250 });
      const token = session?.access_token ?? null;
      if (!token) throw new Error("Please sign in to manage connections.");

      const body: Record<string, unknown> = { action, enabled, mode };
      if (provider === "notion") {
        if (action === "sync_to") {
          const parentPageId = notionParentPageIdInput.trim();
          if (parentPageId) body.parentPageId = parentPageId;
        }
        if (action === "import_from") {
          const databaseId = notionDatabaseIdInput.trim();
          if (databaseId) body.databaseId = databaseId;
        }
      }
      if (provider === "google-calendar") {
        if (gcalStatus?.calendarId) body.calendarId = gcalStatus.calendarId;
      }
      if (options?.body) Object.assign(body, options.body);

      const res = await fetch(`/api/integrations/${provider}/status`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 403) {
        openUpgradeModal();
        return null;
      }
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const requestId =
        (json && typeof json.requestId === "string" ? (json.requestId as string) : null) ||
        res.headers.get("x-request-id") ||
        null;
      if (!res.ok) {
        const err = json && typeof json.error === "string" ? (json.error as string) : `Request failed (${res.status})`;
        throw new Error(`${err}${requestId ? ` (requestId: ${requestId})` : ""}`);
      }
      const verb =
        mode === "run_once"
          ? action === "sync_to"
            ? "Add"
            : "Add"
          : enabled
            ? action === "sync_to"
              ? "Sync"
              : "Import"
            : "Disable";
      const name = provider === "notion" ? "Notion" : "Google Calendar";
      const countSuffix =
        enabled && provider === "notion" && action === "sync_to" && typeof json?.synced === "number"
          ? ` Synced ${json.synced} items.`
          : enabled && provider === "notion" && action === "import_from" && typeof json?.imported === "number"
            ? ` Imported ${json.imported} items.`
            : "";
      setConnectionsMessage({
        type: "success",
        text: `${verb} completed for ${name}.${countSuffix}${requestId ? ` (requestId: ${requestId})` : ""}`,
      });
      await loadConnections({ silent: true, maxAgeMs: 0, hydrateInputs: false });
      return json;
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Request failed.";
      setConnectionsMessage({ type: "error", text });
    } finally {
      setConnectionsBusy(null);
    }
    return null;
  };

  const toggleNotionTwoWay = async () => {
    if (isFreeUser) {
      openUpgradeModal();
      return;
    }
    if (!notionStatus?.connected || !notionStatus?.configured) return;
    const hasStoredDatabase = Boolean(notionStatus?.databaseId);
    const parent = notionParentPageIdInput.trim();
    if (!notionTwoWayEnabled && !parent && !hasStoredDatabase) {
      setConnectionsMessage({ type: "error", text: "Please provide a Notion page URL or ID." });
      return;
    }
    if (!notionTwoWayEnabled) {
      const syncRes = await runCalendarAction("notion", "sync_to", true, { mode: "auto" });
      const createdDatabaseId = syncRes && typeof syncRes.databaseId === "string" ? (syncRes.databaseId as string) : null;
      const databaseOverride = createdDatabaseId ? { databaseId: createdDatabaseId } : undefined;
      await runCalendarAction("notion", "import_from", true, { mode: "auto", body: databaseOverride });
      return;
    }
    await runCalendarAction("notion", "sync_to", false, { mode: "auto" });
    await runCalendarAction("notion", "import_from", false, { mode: "auto" });
  };

  return (
    <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-6">
        <nav className="flex items-center gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => router.push(tab.href)}
              className={cn(
                "relative flex items-center gap-2 text-sm font-medium transition-colors hover:text-zinc-900 dark:hover:text-zinc-50",
                activeTab === tab.id
                  ? "text-zinc-900 dark:text-zinc-50"
                  : "text-zinc-500 dark:text-zinc-400"
              )}
            >
              <span>{tab.label}</span>
              {activeTab === tab.id && (
                <div className="absolute -bottom-[13px] left-0 h-[2px] w-full bg-zinc-900 dark:bg-zinc-50" />
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative">
            <button 
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                className={cn(
                    "rounded-lg p-2 transition-colors",
                    isSettingsOpen 
                        ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" 
                        : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                )}
            >
              <Settings className="h-5 w-5" />
            </button>
            
            {isSettingsOpen && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsSettingsOpen(false)} />
                    <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
                        <div className="mb-4">
                            <h3 className="mb-3 text-sm font-bold text-zinc-900 dark:text-zinc-50">Start my week on</h3>
                            <div className="flex flex-col gap-3">
                                <label className="flex cursor-pointer items-center gap-3">
                                    <div className={`flex h-5 w-5 items-center justify-center rounded-full border ${weekStart === "sunday" ? "border-zinc-900 bg-zinc-900 dark:border-zinc-50 dark:bg-zinc-50" : "border-zinc-300 dark:border-zinc-600"}`}>
                                        {weekStart === "sunday" && <div className="h-2 w-2 rounded-full bg-white dark:bg-zinc-900" />}
                                    </div>
                                    <input 
                                        type="radio" 
                                        name="weekStart" 
                                        className="hidden" 
                                        checked={weekStart === "sunday"} 
                                        onChange={() => onWeekStartChange("sunday")} 
                                    />
                                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Sunday</span>
                                </label>
                                <label className="flex cursor-pointer items-center gap-3">
                                    <div className={`flex h-5 w-5 items-center justify-center rounded-full border ${weekStart === "monday" ? "border-zinc-900 bg-zinc-900 dark:border-zinc-50 dark:bg-zinc-50" : "border-zinc-300 dark:border-zinc-600"}`}>
                                        {weekStart === "monday" && <div className="h-2 w-2 rounded-full bg-white dark:bg-zinc-900" />}
                                    </div>
                                    <input 
                                        type="radio" 
                                        name="weekStart" 
                                        className="hidden" 
                                        checked={weekStart === "monday"} 
                                        onChange={() => onWeekStartChange("monday")} 
                                    />
                                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Monday</span>
                                </label>
                            </div>
                        </div>

                        <div className="mb-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                          <h3 className="mb-3 text-sm font-bold text-zinc-900 dark:text-zinc-50">Advanced features</h3>
                          <div className="flex flex-col gap-4">
                            <label className="flex cursor-pointer items-center gap-3">
                              <div
                                className={`flex h-5 w-5 items-center justify-center rounded border ${
                                  showRecommendedTimes
                                    ? "border-zinc-900 bg-zinc-900 dark:border-zinc-50 dark:bg-zinc-50"
                                    : "border-zinc-300 dark:border-zinc-600"
                                }`}
                              >
                                {showRecommendedTimes && (
                                  <Check className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
                                )}
                              </div>
                              <input
                                type="checkbox"
                                className="hidden"
                                checked={showRecommendedTimes}
                                onChange={() => setShowRecommendedTimes(!showRecommendedTimes)}
                              />
                              <span className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                Show recommended times
                                <Info className="h-4 w-4 text-zinc-400" />
                              </span>
                            </label>

                            <label className="flex cursor-pointer items-center gap-3">
                              <div
                                className={`flex h-5 w-5 items-center justify-center rounded border ${
                                  showSocialPosts
                                    ? "border-zinc-900 bg-zinc-900 dark:border-zinc-50 dark:bg-zinc-50"
                                    : "border-zinc-300 dark:border-zinc-600"
                                }`}
                              >
                                {showSocialPosts && (
                                  <Check className="h-3.5 w-3.5 text-white dark:text-zinc-900" />
                                )}
                              </div>
                              <input
                                type="checkbox"
                                className="hidden"
                                checked={showSocialPosts}
                                onChange={() => setShowSocialPosts(!showSocialPosts)}
                              />
                              <span className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                Show posts published via social
                                <Info className="h-4 w-4 text-zinc-400" />
                              </span>
                            </label>
                          </div>
                        </div>
                    </div>
                </>
            )}
        </div>
        <button
          type="button"
          onMouseEnter={() => void loadConnections({ silent: true })}
          onFocus={() => void loadConnections({ silent: true })}
          onClick={() => {
            setIsConnectionsOpen(true);
            void loadConnections({ showLoading: true });
          }}
          className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          <Link2 className="h-4 w-4" />
          <span>Connections</span>
        </button>
        <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800" />
        <button
          onClick={onCreatePost}
          className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <Plus className="h-4 w-4" />
          <span>Create a post</span>
        </button>
      </div>

      {isConnectionsOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
            <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-[0_30px_80px_rgba(0,0,0,0.30)] dark:bg-zinc-950 dark:shadow-[0_30px_80px_rgba(0,0,0,0.70)]">
              <div className="flex items-center justify-between px-5 py-4">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Calendar Connections</div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Sync scheduled items to external calendars, or import events back into Schedule.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsConnectionsOpen(false)}
                  className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 p-5">
                {connectionsMessage && (
                  <div
                    className={`rounded-lg p-3 text-sm ${
                      connectionsMessage.type === "success"
                        ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                        : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                    }`}
                  >
                    {connectionsMessage.text}
                  </div>
                )}

                {connectionsLoading ? (
                  <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-3 text-xs font-semibold text-zinc-600 shadow-sm dark:bg-zinc-950 dark:text-zinc-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Refreshing connections...
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="rounded-xl bg-white p-4 shadow-sm dark:bg-zinc-950">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Notion</div>
                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            {notionStatus?.connected
                              ? `Connected${notionStatus.workspaceName ? ` (${notionStatus.workspaceName})` : ""}`
                              : notionStatus?.configured
                                ? "Not connected"
                                : "Not configured"}
                          </div>
                          {notionStatus?.configured && !notionStatus?.connected ? (
                            <div className="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">
                              Please connect your Notion first. Click Manage.
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setIsConnectionsOpen(false);
                            router.push("/integration?tab=platforms");
                          }}
                          className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                        >
                          Manage
                        </button>
                      </div>

                      <div className="mt-4 space-y-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Add to Notion page</div>
                            </div>
                            <button
                              type="button"
                              disabled={
                                !canInteract ||
                                (!isFreeUser &&
                                  (!notionStatus?.connected ||
                                    !notionStatus?.configured ||
                                    (!notionParentPageIdInput.trim() && !notionStatus?.databaseId)))
                              }
                              onClick={() => runCalendarAction("notion", "sync_to", true, { mode: "run_once" })}
                              className={cn(
                                "rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm",
                                !canInteract ||
                                  (!isFreeUser &&
                                    (!notionStatus?.connected ||
                                      !notionStatus?.configured ||
                                      (!notionParentPageIdInput.trim() && !notionStatus?.databaseId)))
                                  ? "cursor-not-allowed bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
                                  : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                              )}
                            >
                              Add
                            </button>
                          </div>
                          <input
                            value={notionParentPageIdInput}
                            onChange={(e) => setNotionParentPageIdInput(e.target.value)}
                            placeholder="Notion page URL or ID"
                            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:ring-zinc-700"
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                                Two-way sync with Notion page
                              </div>
                              <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                                {(connectionsBusy === "notion_sync" || connectionsBusy === "notion_import") && (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                )}
                                <span>
                                  {connectionsBusy === "notion_sync" || connectionsBusy === "notion_import"
                                    ? "Syncing..."
                                    : notionTwoWayEnabled
                                      ? "Two-way sync on"
                                      : "Two-way sync off"}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              aria-pressed={notionTwoWayEnabled}
                              disabled={
                                !canInteract ||
                                (!isFreeUser &&
                                  (!notionStatus?.connected ||
                                    !notionStatus?.configured ||
                                    (!notionTwoWayEnabled && !notionParentPageIdInput.trim() && !notionStatus?.databaseId)))
                              }
                              onClick={toggleNotionTwoWay}
                              className={`relative h-6 w-11 rounded-full transition-colors ${
                                !canInteract ||
                                (!isFreeUser && (!notionStatus?.connected || !notionStatus?.configured))
                                  ? "bg-zinc-300 opacity-60 dark:bg-zinc-800"
                                  : notionTwoWayEnabled
                                    ? "bg-zinc-900 dark:bg-zinc-50"
                                    : "bg-zinc-300 dark:bg-zinc-800"
                              }`}
                            >
                              <span
                                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all dark:bg-zinc-950 ${
                                  notionTwoWayEnabled ? "left-5" : "left-0.5"
                                }`}
                              />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                                Import from Notion page to VibePersona
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={
                                !canInteract ||
                                (!isFreeUser &&
                                  (!notionStatus?.connected ||
                                    !notionStatus?.configured ||
                                    (!notionDatabaseIdInput.trim() && !notionStatus?.databaseId)))
                              }
                              onClick={() => runCalendarAction("notion", "import_from", true, { mode: "run_once" })}
                              className={cn(
                                "rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm",
                                !canInteract ||
                                  (!isFreeUser &&
                                    (!notionStatus?.connected ||
                                      !notionStatus?.configured ||
                                      (!notionDatabaseIdInput.trim() && !notionStatus?.databaseId)))
                                  ? "cursor-not-allowed bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
                                  : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                              )}
                            >
                              Import
                            </button>
                          </div>
                          <input
                            value={notionDatabaseIdInput}
                            onChange={(e) => setNotionDatabaseIdInput(e.target.value)}
                            placeholder="Notion database URL or ID"
                            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:ring-zinc-700"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl bg-white p-4 shadow-sm dark:bg-zinc-950">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Google Calendar</div>
                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            {gcalStatus?.connected ? "Connected" : gcalStatus?.configured ? "Not connected" : "Not configured"}
                          </div>
                          {gcalStatus?.configured && !gcalStatus?.connected ? (
                            <div className="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">
                              Please connect your Google Calendar first. Click Manage.
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setIsConnectionsOpen(false);
                            router.push("/integration?tab=platforms");
                          }}
                          className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                        >
                          Manage
                        </button>
                      </div>

                      <div className="mt-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Sync to Google Calendar</div>
                            <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                              {connectionsBusy === "gcal_sync" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                              <span>
                                {connectionsBusy === "gcal_sync"
                                  ? "Syncing..."
                                  : gcalStatus?.syncToEnabled
                                    ? "Auto sync on"
                                    : "Auto sync off"}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={!canInteract || (!isFreeUser && (!gcalStatus?.connected || !gcalStatus?.configured))}
                              onClick={() => runCalendarAction("google-calendar", "sync_to", true, { mode: "run_once" })}
                              className={cn(
                                "rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm",
                                !canInteract || (!isFreeUser && (!gcalStatus?.connected || !gcalStatus?.configured))
                                  ? "cursor-not-allowed bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
                                  : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                              )}
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              aria-pressed={Boolean(gcalStatus?.syncToEnabled)}
                              disabled={!canInteract || (!isFreeUser && (!gcalStatus?.connected || !gcalStatus?.configured))}
                              onClick={() =>
                                runCalendarAction("google-calendar", "sync_to", !Boolean(gcalStatus?.syncToEnabled), { mode: "auto" })
                              }
                              className={`relative h-6 w-11 rounded-full transition-colors ${
                                !canInteract || (!isFreeUser && (!gcalStatus?.connected || !gcalStatus?.configured))
                                  ? "bg-zinc-300 opacity-60 dark:bg-zinc-800"
                                  : gcalStatus?.syncToEnabled
                                    ? "bg-zinc-900 dark:bg-zinc-50"
                                    : "bg-zinc-300 dark:bg-zinc-800"
                              }`}
                            >
                              <span
                                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all dark:bg-zinc-950 ${
                                  gcalStatus?.syncToEnabled ? "left-5" : "left-0.5"
                                }`}
                              />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Import Google Calendar</div>
                            <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                              {connectionsBusy === "gcal_import" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                              <span>
                                {connectionsBusy === "gcal_import"
                                  ? "Importing..."
                                  : gcalStatus?.importEnabled
                                    ? "Auto import on"
                                    : "Auto import off"}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={!canInteract || (!isFreeUser && (!gcalStatus?.connected || !gcalStatus?.configured))}
                              onClick={() => runCalendarAction("google-calendar", "import_from", true, { mode: "run_once" })}
                              className={cn(
                                "rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm",
                                !canInteract || (!isFreeUser && (!gcalStatus?.connected || !gcalStatus?.configured))
                                  ? "cursor-not-allowed bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
                                  : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                              )}
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              aria-pressed={Boolean(gcalStatus?.importEnabled)}
                              disabled={!canInteract || (!isFreeUser && (!gcalStatus?.connected || !gcalStatus?.configured))}
                              onClick={() =>
                                runCalendarAction("google-calendar", "import_from", !Boolean(gcalStatus?.importEnabled), { mode: "auto" })
                              }
                              className={`relative h-6 w-11 rounded-full transition-colors ${
                                !canInteract || (!isFreeUser && (!gcalStatus?.connected || !gcalStatus?.configured))
                                  ? "bg-zinc-300 opacity-60 dark:bg-zinc-800"
                                  : gcalStatus?.importEnabled
                                    ? "bg-zinc-900 dark:bg-zinc-50"
                                    : "bg-zinc-300 dark:bg-zinc-800"
                              }`}
                            >
                              <span
                                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all dark:bg-zinc-950 ${
                                  gcalStatus?.importEnabled ? "left-5" : "left-0.5"
                                }`}
                              />
                            </button>
                          </div>
                        </div>

                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          Sync writes scheduled items (next 90 days) into a dedicated calendar named “AI Persona Schedule”.
                        </div>
                      </div>
                    </div>
                  </div>

                <div className="flex items-center justify-end gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsConnectionsOpen(false)}
                    className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
