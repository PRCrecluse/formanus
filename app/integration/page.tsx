"use client";

import { useMemo, useState, useEffect, type ReactNode } from "react";
import { Link2, Share2 } from "lucide-react";
import { getMembershipStatusWithTimeout, getSessionWithTimeout, isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

type Tab = "socialmedia" | "platforms";

function withTimeout<T>(promiseLike: PromiseLike<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promiseLike),
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`Request timeout (${label})`)), timeoutMs);
    }),
  ]);
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export default function IntegrationPage() {
  const [activeTab, setActiveTab] = useState<Tab>("socialmedia");
  const [connectLoading, setConnectLoading] = useState<"twitter" | "google_calendar" | "notion" | null>(null);
  const [connectMessage, setConnectMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [membershipStatus, setMembershipStatus] = useState<string>("free");
  const [xStatusLoading, setXStatusLoading] = useState(true);
  const [xStatusError, setXStatusError] = useState<string | null>(null);
  const [xStatus, setXStatus] = useState<{
    connected: boolean;
    username: string | null;
    name: string | null;
    profileImageUrl: string | null;
    requestId?: string | null;
    accounts?: {
      id: string;
      username: string | null;
      name: string | null;
      profileImageUrl: string | null;
      lastUsernameUpdatedAt: string | null;
    }[];
  } | null>(null);
  const [gcalStatusLoading, setGcalStatusLoading] = useState(false);
  const [gcalStatusError, setGcalStatusError] = useState<string | null>(null);
  const [gcalStatus, setGcalStatus] = useState<{
    connected: boolean;
    expiresAt: string | null;
    scope: string | null;
    requestId?: string | null;
  } | null>(null);
  const [notionStatusLoading, setNotionStatusLoading] = useState(false);
  const [notionStatusError, setNotionStatusError] = useState<string | null>(null);
  const [notionStatus, setNotionStatus] = useState<{
    connected: boolean;
    workspaceId: string | null;
    workspaceName: string | null;
    botId: string | null;
    requestId?: string | null;
  } | null>(null);
  const [justConnected, setJustConnected] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [xProfileSaving, setXProfileSaving] = useState(false);
  const [xProfileMessage, setXProfileMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [gcalDisconnectLoading, setGcalDisconnectLoading] = useState(false);
  const [notionDisconnectLoading, setNotionDisconnectLoading] = useState(false);

  const isFreeUser = membershipStatus === "free";

  const debugEnabled = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEBUG_INTEGRATIONS === "1";
  const debug = (event: string, data?: unknown) => {
    if (!debugEnabled) return;
    console.log(`[integration] ${event}`, data ?? "");
  };

  const title = useMemo(() => (activeTab === "socialmedia" ? "Social Media" : "Platforms"), [activeTab]);

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

  const openUpgradeModal = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("aipersona:open-upgrade"));
  };

  const loadXStatus = async () => {
    if (!isSupabaseConfigured) {
      setXStatus({ connected: false, username: null, name: null, profileImageUrl: null, requestId: null });
      setXStatusLoading(false);
      return;
    }
    setXStatusLoading(true);
    setXStatusError(null);
    try {
      const startedAt = Date.now();
      debug("x_status_start");
      const { session, timedOut } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
      debug("x_status_session", { hasSession: Boolean(session), timedOut });
      const token = session?.access_token ?? null;
      if (!token) {
        debug("x_status_no_session");
        setXStatus({ connected: false, username: null, name: null, profileImageUrl: null, requestId: null });
        return;
      }
      const res = await withTimeout(
        fetch("/api/integrations/x/status", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        15000,
        "GET /api/integrations/x/status"
      );
      const text = await res.text().catch(() => "");
      const parsed = text ? safeJsonParse(text) : null;
      const json = isRecord(parsed) ? parsed : null;
      debug("x_status_response", {
        ok: res.ok,
        status: res.status,
        requestId: res.headers.get("x-request-id"),
        elapsedMs: Date.now() - startedAt,
        body: json ?? (text ? text.slice(0, 400) : ""),
      });
      if (!res.ok) {
        const serverError =
          (json && typeof json.error === "string" && json.error) ||
          (typeof text === "string" && text) ||
          `Failed to load X status (${res.status})`;
        const debugInfo = json && "debug" in json ? ` debug=${JSON.stringify(json.debug)}` : "";
        throw new Error(`${serverError}${debugInfo}`);
      }
      const accounts = Array.isArray(json?.accounts)
        ? json.accounts.map((a) => ({
            id: asStringOrNull((a as { id?: unknown }).id) ?? "",
            username: asStringOrNull((a as { username?: unknown }).username),
            name: asStringOrNull((a as { name?: unknown }).name),
            profileImageUrl: asStringOrNull((a as { profileImageUrl?: unknown }).profileImageUrl),
            lastUsernameUpdatedAt: asStringOrNull((a as { lastUsernameUpdatedAt?: unknown }).lastUsernameUpdatedAt),
          }))
        : [];
      setXStatus({
        connected: Boolean(json && json.connected),
        username: asStringOrNull(json?.username),
        name: asStringOrNull(json?.name),
        profileImageUrl: asStringOrNull(json?.profileImageUrl),
        requestId: asStringOrNull(json?.requestId) ?? res.headers.get("x-request-id") ?? null,
        accounts,
      });
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Failed to load X status";
      debug("x_status_throw", { text, error });
      setConnectMessage({ type: "error", text });
      setXStatusError(text.includes("Request timeout") ? "Connection check timed out" : text);
      setXStatus({ connected: false, username: null, name: null, profileImageUrl: null, requestId: null });
    } finally {
      setXStatusLoading(false);
    }
  };

  const loadGoogleCalendarStatus = async () => {
    if (!isSupabaseConfigured) {
      setGcalStatus({ connected: false, expiresAt: null, scope: null, requestId: null });
      setGcalStatusLoading(false);
      return;
    }
    setGcalStatusLoading(true);
    setGcalStatusError(null);
    try {
      const startedAt = Date.now();
      debug("gcal_status_start");
      const { session, timedOut } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
      debug("gcal_status_session", { hasSession: Boolean(session), timedOut });
      const token = session?.access_token ?? null;
      if (!token) {
        debug("gcal_status_no_session");
        setGcalStatus({ connected: false, expiresAt: null, scope: null, requestId: null });
        return;
      }
      const res = await withTimeout(
        fetch("/api/integrations/google-calendar/status", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        15000,
        "GET /api/integrations/google-calendar/status"
      );
      const text = await res.text().catch(() => "");
      const parsed = text ? safeJsonParse(text) : null;
      const json = isRecord(parsed) ? parsed : null;
      debug("gcal_status_response", {
        ok: res.ok,
        status: res.status,
        requestId: res.headers.get("x-request-id"),
        elapsedMs: Date.now() - startedAt,
        body: json ?? (text ? text.slice(0, 400) : ""),
      });
      if (!res.ok) {
        const serverError =
          (json && typeof json.error === "string" && json.error) ||
          (typeof text === "string" && text) ||
          `Failed to load Google Calendar status (${res.status})`;
        const debugInfo = json && "debug" in json ? ` debug=${JSON.stringify(json.debug)}` : "";
        throw new Error(`${serverError}${debugInfo}`);
      }
      setGcalStatus({
        connected: Boolean(json && json.connected),
        expiresAt: asStringOrNull(json?.expiresAt),
        scope: asStringOrNull(json?.scope),
        requestId: asStringOrNull(json?.requestId) ?? res.headers.get("x-request-id") ?? null,
      });
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Failed to load Google Calendar status";
      debug("gcal_status_throw", { text, error });
      setGcalStatusError(text.includes("Request timeout") ? "Connection check timed out" : text);
      setGcalStatus({ connected: false, expiresAt: null, scope: null, requestId: null });
    } finally {
      setGcalStatusLoading(false);
    }
  };

  const loadNotionStatus = async () => {
    if (!isSupabaseConfigured) {
      setNotionStatus({ connected: false, workspaceId: null, workspaceName: null, botId: null, requestId: null });
      setNotionStatusLoading(false);
      return;
    }
    setNotionStatusLoading(true);
    setNotionStatusError(null);
    try {
      const startedAt = Date.now();
      debug("notion_status_start");
      const { session, timedOut } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
      debug("notion_status_session", { hasSession: Boolean(session), timedOut });
      const token = session?.access_token ?? null;
      if (!token) {
        debug("notion_status_no_session");
        setNotionStatus({ connected: false, workspaceId: null, workspaceName: null, botId: null, requestId: null });
        return;
      }
      const res = await withTimeout(
        fetch("/api/integrations/notion/status", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        15000,
        "GET /api/integrations/notion/status"
      );
      const text = await res.text().catch(() => "");
      const parsed = text ? safeJsonParse(text) : null;
      const json = isRecord(parsed) ? parsed : null;
      debug("notion_status_response", {
        ok: res.ok,
        status: res.status,
        requestId: res.headers.get("x-request-id"),
        elapsedMs: Date.now() - startedAt,
        body: json ?? (text ? text.slice(0, 400) : ""),
      });
      if (!res.ok) {
        const serverError =
          (json && typeof json.error === "string" && json.error) ||
          (typeof text === "string" && text) ||
          `Failed to load Notion status (${res.status})`;
        const debugInfo = json && "debug" in json ? ` debug=${JSON.stringify(json.debug)}` : "";
        throw new Error(`${serverError}${debugInfo}`);
      }
      setNotionStatus({
        connected: Boolean(json && json.connected),
        workspaceId: asStringOrNull(json?.workspaceId),
        workspaceName: asStringOrNull(json?.workspaceName),
        botId: asStringOrNull(json?.botId),
        requestId: asStringOrNull(json?.requestId) ?? res.headers.get("x-request-id") ?? null,
      });
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Failed to load Notion status";
      debug("notion_status_throw", { text, error });
      setNotionStatusError(text.includes("Request timeout") ? "Connection check timed out" : text);
      setNotionStatus({ connected: false, workspaceId: null, workspaceName: null, botId: null, requestId: null });
    } finally {
      setNotionStatusLoading(false);
    }
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    const tab = (url.searchParams.get("tab") ?? "").toString().trim().toLowerCase();
    if (tab === "platforms") setActiveTab("platforms");
    const connected = url.searchParams.get("connected");
    const note = url.searchParams.get("note");
    const error = url.searchParams.get("error");
    const requestId = url.searchParams.get("requestId");
    if (connected) {
      setJustConnected(true);
      const message = (() => {
        if (connected === "twitter") {
          return note === "user_profile_forbidden"
            ? "Connected to X, but current app permissions do not allow reading your profile image and name."
            : "Connected to X successfully.";
        }
        if (connected === "google_calendar") return "Connected to Google Calendar successfully.";
        if (connected === "notion") return "Connected to Notion successfully.";
        return "Connected successfully.";
      })();
      setConnectMessage({
        type: "success",
        text: message,
      });
    } else if (error) {
      setConnectMessage({
        type: "error",
        text: decodeURIComponent(error),
      });
    }
    if (connected || error || requestId || note) {
      url.searchParams.delete("connected");
      url.searchParams.delete("error");
      url.searchParams.delete("note");
      url.searchParams.delete("requestId");
      window.history.replaceState({}, "", url.toString());
    }
    void loadXStatus();
    void loadGoogleCalendarStatus();
    void loadNotionStatus();
  }, []);

  useEffect(() => {
    setXProfileMessage(null);
    if (xStatus?.username) {
      setUsernameInput(xStatus.username);
    }
  }, [xStatus?.username]);

  useEffect(() => {
    if (xStatus?.connected && !xStatus?.username && justConnected) {
      setShowUsernameModal(true);
    } else {
      setShowUsernameModal(false);
    }
  }, [xStatus?.connected, xStatus?.username, justConnected]);

  const usernameUpdateAllowed = useMemo(() => {
    if (!xStatus?.accounts || xStatus.accounts.length === 0) return true;
    const primary = xStatus.accounts[0];
    if (!primary.lastUsernameUpdatedAt) return true;
    const last = Date.parse(primary.lastUsernameUpdatedAt);
    if (!Number.isNaN(last)) {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      return Date.now() - last >= sevenDaysMs;
    }
    return true;
  }, [xStatus?.accounts]);

  const handleOAuthConnect = async () => {
    if (!isSupabaseConfigured) {
      setConnectMessage({
        type: "error",
        text: "Supabase is not configured. Please check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      });
      return;
    }
    if (isFreeUser) {
      setConnectMessage(null);
      openUpgradeModal();
      return;
    }
    try {
      setConnectMessage(null);
      setConnectLoading("twitter");
      debug("x_connect_start");
      const { session, timedOut } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
      debug("x_connect_session", { hasSession: Boolean(session), timedOut });
      const token = session?.access_token ?? null;
      if (!token) {
        throw new Error(
          timedOut
            ? "Session fetch timed out (Supabase getSession). Please refresh the page and try again or check console logs."
            : "Please sign in before connecting your X account."
        );
      }
      const res = await withTimeout(
        fetch("/api/integrations/x/start", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        15000,
        "GET /api/integrations/x/start"
      );
      const text = await res.text().catch(() => "");
      let json: { url?: unknown; error?: unknown } | null = null;
      try {
        json = text ? (JSON.parse(text) as { url?: unknown; error?: unknown }) : null;
      } catch {
        json = null;
      }
      debug("x_connect_response", { ok: res.ok, status: res.status, requestId: res.headers.get("x-request-id"), body: json ?? text });
      if (!res.ok) {
        if (res.status === 403) {
          openUpgradeModal();
          return;
        }
        const errText =
          (json && typeof json.error === "string" && json.error) ||
          text ||
          `Failed to start X OAuth (${res.status})`;
        throw new Error(errText);
      }
      const url = (json?.url ?? "").toString().trim();
      if (!url) {
        throw new Error("Missing OAuth redirect URL");
      }
      window.location.assign(url);
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Connect failed";
      debug("x_connect_throw", { text, error });
      setConnectMessage({ type: "error", text });
    } finally {
      setConnectLoading(null);
    }
  };

  const handleGoogleCalendarConnect = async () => {
    if (!isSupabaseConfigured) {
      setConnectMessage({
        type: "error",
        text: "Supabase is not configured. Please check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      });
      return;
    }
    if (isFreeUser) {
      setConnectMessage(null);
      openUpgradeModal();
      return;
    }
    try {
      setConnectMessage(null);
      setConnectLoading("google_calendar");
      debug("gcal_connect_start");
      const { session, timedOut } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
      debug("gcal_connect_session", { hasSession: Boolean(session), timedOut });
      const token = session?.access_token ?? null;
      if (!token) {
        throw new Error(
          timedOut
            ? "Session fetch timed out (Supabase getSession). Please refresh the page and try again or check console logs."
            : "Please sign in before connecting Google Calendar."
        );
      }
      const res = await withTimeout(
        fetch("/api/integrations/google-calendar/start", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        15000,
        "GET /api/integrations/google-calendar/start"
      );
      const text = await res.text().catch(() => "");
      let json: { url?: unknown; error?: unknown } | null = null;
      try {
        json = text ? (JSON.parse(text) as { url?: unknown; error?: unknown }) : null;
      } catch {
        json = null;
      }
      debug("gcal_connect_response", {
        ok: res.ok,
        status: res.status,
        requestId: res.headers.get("x-request-id"),
        body: json ?? text,
      });
      if (!res.ok) {
        if (res.status === 403) {
          openUpgradeModal();
          return;
        }
        const errText =
          (json && typeof json.error === "string" && json.error) ||
          text ||
          `Failed to start Google Calendar OAuth (${res.status})`;
        throw new Error(errText);
      }
      const url = (json?.url ?? "").toString().trim();
      if (!url) throw new Error("Missing OAuth redirect URL");
      window.location.assign(url);
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Connect failed";
      debug("gcal_connect_throw", { text, error });
      setConnectMessage({ type: "error", text });
    } finally {
      setConnectLoading(null);
    }
  };

  const handleNotionConnect = async () => {
    if (!isSupabaseConfigured) {
      setConnectMessage({
        type: "error",
        text: "Supabase is not configured. Please check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      });
      return;
    }
    if (isFreeUser) {
      setConnectMessage(null);
      openUpgradeModal();
      return;
    }
    try {
      setConnectMessage(null);
      setConnectLoading("notion");
      debug("notion_connect_start");
      const { session, timedOut } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
      debug("notion_connect_session", { hasSession: Boolean(session), timedOut });
      const token = session?.access_token ?? null;
      if (!token) {
        throw new Error(
          timedOut
            ? "Session fetch timed out (Supabase getSession). Please refresh the page and try again or check console logs."
            : "Please sign in before connecting Notion."
        );
      }
      const res = await withTimeout(
        fetch("/api/integrations/notion/start", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        15000,
        "GET /api/integrations/notion/start"
      );
      const text = await res.text().catch(() => "");
      let json: { url?: unknown; error?: unknown } | null = null;
      try {
        json = text ? (JSON.parse(text) as { url?: unknown; error?: unknown }) : null;
      } catch {
        json = null;
      }
      debug("notion_connect_response", {
        ok: res.ok,
        status: res.status,
        requestId: res.headers.get("x-request-id"),
        body: json ?? text,
      });
      if (!res.ok) {
        if (res.status === 403) {
          openUpgradeModal();
          return;
        }
        const errText =
          (json && typeof json.error === "string" && json.error) ||
          text ||
          `Failed to start Notion OAuth (${res.status})`;
        throw new Error(errText);
      }
      const url = (json?.url ?? "").toString().trim();
      if (!url) throw new Error("Missing OAuth redirect URL");
      window.location.assign(url);
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Connect failed";
      debug("notion_connect_throw", { text, error });
      setConnectMessage({ type: "error", text });
    } finally {
      setConnectLoading(null);
    }
  };

  const handleDisconnect = async (accountId?: string) => {
    if (!isSupabaseConfigured) {
      setConnectMessage({
        type: "error",
        text: "Supabase is not configured. Please check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      });
      return;
    }
    try {
      setConnectMessage(null);
      setDisconnectLoading(true);
      debug("x_disconnect_start");
      const { session, timedOut } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
      debug("x_disconnect_session", { hasSession: Boolean(session), timedOut });
      const token = session?.access_token ?? null;
      if (!token) {
        throw new Error(
          timedOut
            ? "Session fetch timed out (Supabase getSession). Please refresh the page and try again or check console logs."
            : "Please sign in before disconnecting your X account."
        );
      }
      const url = accountId ? `/api/integrations/x/status?id=${accountId}` : "/api/integrations/x/status";
      const res = await withTimeout(
        fetch(url, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }),
        15000,
        "DELETE /api/integrations/x/status"
      );
      const text = await res.text().catch(() => "");
      const parsed = text ? safeJsonParse(text) : null;
      const json = isRecord(parsed) ? parsed : null;
      debug("x_disconnect_response", {
        ok: res.ok,
        status: res.status,
        requestId: res.headers.get("x-request-id"),
        body: json ?? text,
      });
      if (!res.ok) {
        const serverError =
          (json && typeof json.error === "string" && json.error) ||
          (typeof text === "string" && text) ||
          `Disconnect failed (${res.status})`;
        const debugInfo = json && "debug" in json ? ` debug=${JSON.stringify(json.debug)}` : "";
        throw new Error(`${serverError}${debugInfo}`);
      }
      setConnectMessage({ type: "success", text: "X account disconnected." });
      await loadXStatus();
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Disconnect failed";
      debug("x_disconnect_throw", { text, error });
      setConnectMessage({ type: "error", text });
    } finally {
      setDisconnectLoading(false);
    }
  };

  const handleDisconnectGoogleCalendar = async () => {
    if (!isSupabaseConfigured) {
      setConnectMessage({
        type: "error",
        text: "Supabase is not configured. Please check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      });
      return;
    }
    try {
      setConnectMessage(null);
      setGcalDisconnectLoading(true);
      debug("gcal_disconnect_start");
      const { session, timedOut } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
      debug("gcal_disconnect_session", { hasSession: Boolean(session), timedOut });
      const token = session?.access_token ?? null;
      if (!token) {
        throw new Error(
          timedOut
            ? "Session fetch timed out (Supabase getSession). Please refresh the page and try again or check console logs."
            : "Please sign in before disconnecting Google Calendar."
        );
      }
      const res = await withTimeout(
        fetch("/api/integrations/google-calendar/status", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }),
        15000,
        "DELETE /api/integrations/google-calendar/status"
      );
      const text = await res.text().catch(() => "");
      const parsed = text ? safeJsonParse(text) : null;
      const json = isRecord(parsed) ? parsed : null;
      debug("gcal_disconnect_response", {
        ok: res.ok,
        status: res.status,
        requestId: res.headers.get("x-request-id"),
        body: json ?? text,
      });
      if (!res.ok) {
        const serverError =
          (json && typeof json.error === "string" && json.error) ||
          (typeof text === "string" && text) ||
          `Disconnect failed (${res.status})`;
        const debugInfo = json && "debug" in json ? ` debug=${JSON.stringify(json.debug)}` : "";
        throw new Error(`${serverError}${debugInfo}`);
      }
      setConnectMessage({ type: "success", text: "Google Calendar disconnected." });
      await loadGoogleCalendarStatus();
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Disconnect failed";
      debug("gcal_disconnect_throw", { text, error });
      setConnectMessage({ type: "error", text });
    } finally {
      setGcalDisconnectLoading(false);
    }
  };

  const handleDisconnectNotion = async () => {
    if (!isSupabaseConfigured) {
      setConnectMessage({
        type: "error",
        text: "Supabase is not configured. Please check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      });
      return;
    }
    try {
      setConnectMessage(null);
      setNotionDisconnectLoading(true);
      debug("notion_disconnect_start");
      const { session, timedOut } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
      debug("notion_disconnect_session", { hasSession: Boolean(session), timedOut });
      const token = session?.access_token ?? null;
      if (!token) {
        throw new Error(
          timedOut
            ? "Session fetch timed out (Supabase getSession). Please refresh the page and try again or check console logs."
            : "Please sign in before disconnecting Notion."
        );
      }
      const res = await withTimeout(
        fetch("/api/integrations/notion/status", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }),
        15000,
        "DELETE /api/integrations/notion/status"
      );
      const text = await res.text().catch(() => "");
      const parsed = text ? safeJsonParse(text) : null;
      const json = isRecord(parsed) ? parsed : null;
      debug("notion_disconnect_response", {
        ok: res.ok,
        status: res.status,
        requestId: res.headers.get("x-request-id"),
        body: json ?? text,
      });
      if (!res.ok) {
        const serverError =
          (json && typeof json.error === "string" && json.error) ||
          (typeof text === "string" && text) ||
          `Disconnect failed (${res.status})`;
        const debugInfo = json && "debug" in json ? ` debug=${JSON.stringify(json.debug)}` : "";
        throw new Error(`${serverError}${debugInfo}`);
      }
      setConnectMessage({ type: "success", text: "Notion disconnected." });
      await loadNotionStatus();
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Disconnect failed";
      debug("notion_disconnect_throw", { text, error });
      setConnectMessage({ type: "error", text });
    } finally {
      setNotionDisconnectLoading(false);
    }
  };

  const handleUpdateXProfile = async () => {
    if (!isSupabaseConfigured) {
      setXProfileMessage({
        type: "error",
        text: "Supabase is not configured. Please check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      });
      return;
    }
    const raw = usernameInput.replace(/^@+/, "").trim();
    if (!raw) {
      setXProfileMessage({
        type: "error",
        text: "Please enter your X username.",
      });
      return;
    }
    try {
      setXProfileMessage(null);
      setXProfileSaving(true);
      debug("x_profile_start");
      const { session, timedOut } = await getSessionWithTimeout({ timeoutMs: 2500, retries: 2, retryDelayMs: 120 });
      debug("x_profile_session", { hasSession: Boolean(session), timedOut });
      const token = session?.access_token ?? null;
      if (!token) {
        throw new Error(
          timedOut
            ? "Session fetch timed out. Refresh page and try again."
            : "Please sign in before updating your X profile."
        );
      }
      const res = await withTimeout(
        fetch("/api/integrations/x/status", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ username: raw }),
        }),
        15000,
        "POST /api/integrations/x/status"
      );
      const text = await res.text().catch(() => "");
      const parsed = text ? safeJsonParse(text) : null;
      const json = isRecord(parsed) ? parsed : null;
      debug("x_profile_response", {
        ok: res.ok,
        status: res.status,
        requestId: res.headers.get("x-request-id"),
        body: json ?? (text ? text.slice(0, 400) : ""),
      });
      if (!res.ok || !json) {
        const serverError =
          (json && typeof json.error === "string" && json.error) ||
          (typeof text === "string" && text) ||
          `Failed to update X profile (${res.status})`;
        if (json && "debug" in json) debug("x_profile_response_debug", (json as Record<string, unknown>).debug);
        throw new Error(serverError);
      }
      const username = asStringOrNull((json as { username?: unknown }).username) ?? raw;
      const name = asStringOrNull((json as { name?: unknown }).name);
      const profileImageUrl = asStringOrNull((json as { profileImageUrl?: unknown }).profileImageUrl);
      setXStatus((prev) => {
        const requestId =
          asStringOrNull((json as { requestId?: unknown }).requestId) ??
          prev?.requestId ??
          res.headers.get("x-request-id") ??
          null;
        const nextAccounts = prev?.accounts ?? [];
        const primaryIndex = nextAccounts.findIndex((a) => a.id && a.username === username);
        const updatedAccounts =
          primaryIndex >= 0
            ? nextAccounts.map((a, idx) =>
                idx === primaryIndex
                  ? {
                      ...a,
                      username,
                      name,
                      profileImageUrl,
                      lastUsernameUpdatedAt: new Date().toISOString(),
                    }
                  : a
              )
            : nextAccounts;
        if (prev) {
          return {
            ...prev,
            username,
            name,
            profileImageUrl,
            requestId,
            accounts: updatedAccounts,
          };
        }
        return {
          connected: true,
          username,
          name,
          profileImageUrl,
          requestId,
          accounts: updatedAccounts,
        };
      });
      setUsernameInput(username);
      setXProfileMessage({ type: "success", text: "X username saved successfully." });
      setShowUsernameModal(false);
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Failed to update X profile.";
      debug("x_profile_throw", { text, error });
      setXProfileMessage({ type: "error", text });
    } finally {
      setXProfileSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="mb-8 text-2xl font-bold">Integration</h1>

        <div className="flex flex-col gap-8 md:flex-row">
          <aside className="w-full md:w-64 shrink-0">
            <nav className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setActiveTab("socialmedia")}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === "socialmedia"
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                }`}
              >
                <Share2 className="h-4 w-4" />
                Social Media
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("platforms")}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === "platforms"
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                }`}
              >
                <Link2 className="h-4 w-4" />
                Platforms
              </button>
            </nav>
          </aside>

          <main className="flex-1">
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">{title}</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {activeTab === "socialmedia"
                        ? "Connect X (Twitter), Facebook, and more."
                        : "Connect tools like Notion, Slack, and other platforms (coming soon)."}
                    </p>
                  </div>
                </div>
                {connectMessage && (
                  <div
                    className={`mb-4 rounded-lg p-3 text-sm ${
                      connectMessage.type === "success"
                        ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                        : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                    }`}
                  >
                    {connectMessage.text}
                  </div>
                )}

                <div className="space-y-3">
                  {activeTab === "socialmedia" ? (
                    <>
                      <IntegrationCard
                        name="X (Twitter)"
                        status={
                          xStatusLoading
                            ? "Checking connection..."
                            : xStatusError
                              ? "Connection check failed"
                            : xStatus?.connected
                              ? `${
                                  xStatus.accounts && xStatus.accounts.length > 0
                                    ? xStatus.accounts.length
                                    : 1
                                } connected`
                              : "Not connected"
                        }
                        buttonLabel={
                          connectLoading === "twitter" ? "Connecting..." : "Add account"
                        }
                        disabled={!isSupabaseConfigured || connectLoading !== null}
                        onConnect={handleOAuthConnect}
                      />
                      {xStatus?.connected && (
                        <div className="relative mt-2 pl-6">
                          <div className="absolute left-3 top-0 bottom-4 w-px bg-zinc-200 dark:bg-zinc-800" />
                          <div className="flex flex-col gap-3">
                            {(xStatus.accounts && xStatus.accounts.length > 0
                              ? xStatus.accounts
                              : [
                                  {
                                    id: "primary",
                                    username: xStatus.username,
                                    name: xStatus.name,
                                    profileImageUrl: xStatus.profileImageUrl,
                                  },
                                ]
                            ).map((account) => (
                              <div
                                key={account.id || account.username || "primary"}
                                className="relative flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                              >
                                <div className="absolute -left-3 top-1/2 h-px w-3 bg-zinc-200 dark:bg-zinc-800" />
                                <div className="flex items-center gap-3">
                                  {account.profileImageUrl ? (
                                    <img
                                      src={account.profileImageUrl}
                                      alt=""
                                      className="h-10 w-10 rounded-full border border-zinc-200 dark:border-zinc-800"
                                      referrerPolicy="no-referrer"
                                    />
                                  ) : (
                                    <div className="h-10 w-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                      {account.name || account.username || "X Account"}
                                    </div>
                                    <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                                      {account.username ? `@${account.username}` : "No username"}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setUsernameInput(account.username || "");
                                      setShowUsernameModal(true);
                                    }}
                                    className="flex-1 rounded-md bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                                  >
                                    {account.username ? "Update Profile" : "Set Username"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDisconnect(account.id === "primary" ? undefined : account.id)
                                    }
                                    disabled={disconnectLoading || connectLoading !== null}
                                    className={`flex-1 rounded-md px-3 py-2 text-xs font-medium ${
                                      disconnectLoading || connectLoading !== null
                                        ? "bg-red-50 text-red-300 dark:bg-red-900/20 dark:text-red-900"
                                        : "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
                                    }`}
                                  >
                                    Disconnect
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <IntegrationCard name="Facebook" status="Coming soon" />
                    </>
                  ) : (
                    <>
                      <IntegrationCard
                        name="Google Calendar"
                        status={
                          gcalStatusLoading
                            ? "Checking connection..."
                            : gcalStatusError
                              ? "Connection check failed"
                            : gcalStatus?.connected
                              ? "Connected"
                              : "Not connected"
                        }
                        buttonLabel={
                          connectLoading === "google_calendar" ? "Connecting..." : "Add account"
                        }
                        disabled={
                          !isSupabaseConfigured || connectLoading !== null
                        }
                        onConnect={handleGoogleCalendarConnect}
                      />
                      {gcalStatus?.connected && (
                        <div className="relative mt-2 pl-6">
                          <div className="absolute left-3 top-0 bottom-4 w-px bg-zinc-200 dark:bg-zinc-800" />
                          <div className="flex flex-col gap-3">
                            <div className="relative flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                              <div className="absolute -left-3 top-1/2 h-px w-3 bg-zinc-200 dark:bg-zinc-800" />
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center dark:bg-blue-900/30">
                                  <svg className="h-6 w-6 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 002 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2zm-7 5h5v5h-5v-5z"/>
                                  </svg>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                    Google Calendar
                                  </div>
                                  {gcalStatus.expiresAt && (
                                    <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                                      Token expires: {new Date(gcalStatus.expiresAt).toLocaleDateString()}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={handleDisconnectGoogleCalendar}
                                  disabled={gcalDisconnectLoading || connectLoading !== null}
                                  className={`flex-1 rounded-md px-3 py-2 text-xs font-medium ${
                                    gcalDisconnectLoading || connectLoading !== null
                                      ? "bg-red-50 text-red-300 dark:bg-red-900/20 dark:text-red-900"
                                      : "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
                                  }`}
                                >
                                  {gcalDisconnectLoading ? "Disconnecting..." : "Disconnect"}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      <IntegrationCard
                        name="Notion"
                        status={
                          notionStatusLoading
                            ? "Checking connection..."
                            : notionStatusError
                              ? "Connection check failed"
                            : notionStatus?.connected
                              ? `Connected${notionStatus.workspaceName ? ` (${notionStatus.workspaceName})` : ""}`
                              : "Not connected"
                        }
                        buttonLabel={
                          connectLoading === "notion" ? "Connecting..." : "Add account"
                        }
                        disabled={!isSupabaseConfigured || connectLoading !== null || notionDisconnectLoading}
                        onConnect={handleNotionConnect}
                      />
                      {notionStatus?.connected && (
                        <div className="relative mt-2 pl-6">
                          <div className="absolute left-3 top-0 bottom-4 w-px bg-zinc-200 dark:bg-zinc-800" />
                          <div className="flex flex-col gap-3">
                            <div className="relative flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                              <div className="absolute -left-3 top-1/2 h-px w-3 bg-zinc-200 dark:bg-zinc-800" />
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-zinc-100 flex items-center justify-center dark:bg-zinc-800">
                                  <svg className="h-6 w-6 text-zinc-900 dark:text-zinc-100" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M4.223 3.525L2.68 4.607A.75.75 0 002.5 5.5l.5.75a.75.75 0 001.054.214l.87-.58a2.25 2.25 0 012.352-.075l.38.213c.84.47 1.344 1.32 1.344 2.25v8.667c0 1.258-1.392 2.016-2.482 1.352l-.398-.24a2.25 2.25 0 00-2.352.076l-.088.058a.75.75 0 00.83 1.246l.088-.058a.75.75 0 01.784-.026l.398.24c.484.294 1.04.258 1.488-.095.448-.352.708-.894.708-1.47V9.333c0-.413-.224-.79-.597-1.002l-.38-.212a.75.75 0 00-.784.025l-.87.58a2.25 2.25 0 01-3.16-1.874V6.5a2.25 2.25 0 011.664-2.172l1.542-1.08a.75.75 0 00.322-.976l-.5-.75a.75.75 0 00-1.054-.214zM21.5 5.5l-.5-.75a.75.75 0 00-1.054-.214l-1.542 1.08A2.25 2.25 0 0016.74 7.788v.377a2.25 2.25 0 00-3.16 1.874l-.87-.58a.75.75 0 00-.784-.025l-.38.212A1.17 1.17 0 0010.95 10.667v8.666c0 .576.26 1.118.708 1.47.448.353 1.004.39 1.488.096l.398-.24a.75.75 0 01.784.026l.088.058a.75.75 0 10.83-1.246l-.088-.058a2.25 2.25 0 00-2.352-.076l-.398.24c-1.09.664-2.482-.094-2.482-1.352V9.333c0-.93.504-1.78 1.344-2.25l.38-.213a2.25 2.25 0 012.352.075l.87.58a.75.75 0 001.054-.214l.5-.75a.75.75 0 00-.214-1.054l-1.542-1.08a.75.75 0 00-.322.976v.377c0 .93.504 1.78 1.344 2.25l.38.213c.84.47 1.344 1.32 1.344 2.25v8.667c0 1.258-1.392 2.016-2.482 1.352l-.398-.24a2.25 2.25 0 00-2.352.076l-.088.058a.75.75 0 00.83 1.246l.088-.058a.75.75 0 01.784-.026l.398.24c.484.294 1.04.258 1.488-.095.448-.352.708-.894.708-1.47V9.333c0-.413-.224-.79-.597-1.002l-.38-.212a.75.75 0 00-.784.025l-.87.58a2.25 2.25 0 01-3.16-1.874V6.5a2.25 2.25 0 011.664-2.172l1.542-1.08a.75.75 0 00.322-.976l-.5-.75a.75.75 0 00-1.054-.214z"/>
                                  </svg>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                    {notionStatus.workspaceName || notionStatus.workspaceId || "Notion Workspace"}
                                  </div>
                                  {notionStatus.botId && (
                                    <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                                      Bot ID: {notionStatus.botId}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={handleDisconnectNotion}
                                  disabled={notionDisconnectLoading || connectLoading !== null}
                                  className={`flex-1 rounded-md px-3 py-2 text-xs font-medium ${
                                    notionDisconnectLoading || connectLoading !== null
                                      ? "bg-red-50 text-red-300 dark:bg-red-900/20 dark:text-red-900"
                                      : "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
                                  }`}
                                >
                                  {notionDisconnectLoading ? "Disconnecting..." : "Disconnect"}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
      {showUsernameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Complete X Profile</div>
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              You need to provide your X username to display your profile image and name.
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !xProfileSaving && usernameInput.replace(/^@+/, "").trim() && usernameUpdateAllowed) {
                    handleUpdateXProfile();
                  }
                }}
                placeholder="@username"
                className="flex-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:ring-zinc-700"
              />
              <button
                type="button"
                onClick={handleUpdateXProfile}
                disabled={
                  xProfileSaving || !usernameInput.replace(/^@+/, "").trim() || !usernameUpdateAllowed
                }
                className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium ${
                  xProfileSaving || !usernameInput.replace(/^@+/, "").trim() || !usernameUpdateAllowed
                    ? "bg-zinc-900 text-white opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
                    : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                }`}
              >
                {xProfileSaving ? "Saving..." : "Save username"}
              </button>
            </div>
            {xProfileMessage && (
              <div
                className={`mt-2 text-xs ${
                  xProfileMessage.type === "success"
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {xProfileMessage.text}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowUsernameModal(false)}
                className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IntegrationCard(props: {
  name: string;
  status: string;
  buttonLabel?: string;
  disabled?: boolean;
  onConnect?: () => void;
  details?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="min-w-0">
        <div className="font-medium text-zinc-900 dark:text-zinc-100">{props.name}</div>
        <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{props.status}</div>
        {props.details ? <div className="mt-2">{props.details}</div> : null}
      </div>
      {props.actions ? (
        props.actions
      ) : (
        <button
          type="button"
          onClick={props.onConnect}
          disabled={props.disabled ?? true}
          className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium ${
            props.disabled ?? true
              ? "bg-zinc-900 text-white opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
              : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          }`}
        >
          {props.buttonLabel ?? "Add account"}
        </button>
      )}
    </div>
  );
}
