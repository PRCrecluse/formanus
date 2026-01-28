"use client";

import {
  Plus,
  Clock,
  LayoutGrid,
  List,
  Users,
  ArrowUp,
  Mic,
  FileText,
  Image,
  File as FileIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEventHandler } from "react";
import { useRouter } from "next/navigation";
import {
  AIInput,
  AIInputButton,
  AIInputFileUploadButton,
  AIInputTextarea,
  AIInputToolbar,
  AIInputTools,
  AIInputVoiceButton,
} from "@/components/ui/ai-input";
import { getSessionWithTimeout, supabase } from "@/lib/supabaseClient";
import { getCleanPersonaDocId } from "@/lib/utils";

type RecentDoc = {
  id: string;
  title: string | null;
  updated_at: string | null;
  persona_id?: string | null;
  type?: string | null;
};

const RECENT_CACHE_TTL_MS = 60_000;

let recentCache:
  | {
      docs: RecentDoc[];
      updatedAt: number;
    }
  | null = null;

function formatTypeLabel(raw?: string | null) {
  const value = (raw ?? "").toString();
  if (!value) return "Doc";
  const head = value.split(";")[0]?.trim();
  if (!head) return "Doc";
  const lower = head.toLowerCase();
  if (lower === "persona") return "Persona";
  if (lower === "post" || lower === "posts") return "Post";
  if (lower === "album" || lower === "albums" || lower === "photos" || lower === "videos") return "Album";
  return "Doc";
}

function getTypeMeta(raw?: string | null) {
  const value = (raw ?? "").toString();
  const head = value.split(";")[0]?.trim().toLowerCase();
  if (head === "persona")
    return {
      label: "Persona",
      Icon: Users,
      tone: "text-emerald-600/50 dark:text-emerald-300/60",
      badge: "bg-emerald-50/50 text-emerald-700/50 dark:bg-emerald-950/15 dark:text-emerald-200/60",
    };
  if (head === "post" || head === "posts")
    return {
      label: "Post",
      Icon: FileText,
      tone: "text-blue-600/50 dark:text-blue-300/60",
      badge: "bg-blue-50/50 text-blue-700/50 dark:bg-blue-950/15 dark:text-blue-200/60",
    };
  if (head === "album" || head === "albums" || head === "photos" || head === "videos")
    return {
      label: "Album",
      Icon: Image,
      tone: "text-violet-600/50 dark:text-violet-300/60",
      badge: "bg-violet-50/50 text-violet-700/50 dark:bg-violet-950/15 dark:text-violet-200/60",
    };
  return {
    label: formatTypeLabel(raw),
    Icon: FileIcon,
    tone: "text-zinc-500/50 dark:text-zinc-400/60",
    badge: "bg-zinc-100/60 text-zinc-600/50 dark:bg-zinc-900/40 dark:text-zinc-300/60",
  };
}

function formatUpdatedAt(iso?: string | null) {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

export default function HomePage() {
  const router = useRouter();
  const [view, setView] = useState<"grid" | "list">("grid");
  const [recentDocs, setRecentDocs] = useState<RecentDoc[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentLoadedOnce, setRecentLoadedOnce] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentErrorRequestId, setRecentErrorRequestId] = useState<string | null>(null);
  const [greeting, setGreeting] = useState("");
  const [message, setMessage] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const loadRecentReqIdRef = useRef(0);

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed && pendingFiles.length === 0) return;
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("homeChatDraft", trimmed);
    }
    setMessage("");
    setPendingFiles([]);
    router.push("/chat/new");
  };

  const handleFileSelect = (file: File) => {
    setPendingFiles((prev) => [...prev, file]);
  };

  const handleVoiceRecorded = (blob: Blob) => {
    const file = new File([blob], "voice-message.webm", { type: "audio/webm" });
    setPendingFiles((prev) => [...prev, file]);
  };

  const openRecentDoc = (doc: RecentDoc) => {
    const rawPersonaId = (doc.persona_id ?? "").toString().trim();
    const routePersonaId = rawPersonaId || "__private__";
    const cleanDocId = rawPersonaId ? getCleanPersonaDocId(rawPersonaId, doc.id) : doc.id;
    router.push(`/persona/${encodeURIComponent(routePersonaId)}/docs/${encodeURIComponent(cleanDocId)}`);
  };

  useEffect(() => {
    let mounted = true;
    const reqId = ++loadRecentReqIdRef.current;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const setSafe = (fn: () => void) => {
      if (!mounted || reqId !== loadRecentReqIdRef.current) return;
      fn();
    };

    const scheduleRetry = (delayMs: number) => {
      if (!mounted || reqId !== loadRecentReqIdRef.current) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        void loadRecent();
      }, delayMs);
    };

    const loadRecent = async () => {
      let requestIdForLog: string | null = null;
      try {
        attempts += 1;
        const cache = recentCache;
        if (cache && Date.now() - cache.updatedAt < RECENT_CACHE_TTL_MS) {
          setSafe(() => {
            setRecentDocs(cache.docs);
            setRecentLoadedOnce(true);
            setRecentLoading(false);
            setRecentError(null);
            setRecentErrorRequestId(null);
          });
          return;
        }
        setSafe(() => setRecentLoading(true));
        const { session, timedOut: sessionTimedOut } = await getSessionWithTimeout({
          timeoutMs: 12000,
          retries: 3,
          retryDelayMs: 300,
        });
        if (sessionTimedOut) {
          console.warn("[home] auth.getSession timed out, using fallback session", {
            timeoutMs: 12000,
          });
        }
        const token = session?.access_token ?? null;
        if (!session || !token) {
          setSafe(() => setRecentLoading(false));
          const delay = Math.min(4000, 400 + 200 * attempts);
          scheduleRetry(delay);
          return;
        }
        const requestId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
        requestIdForLog = requestId;
        setSafe(() => {
          setRecentError(null);
          setRecentErrorRequestId(null);
        });
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        try {
          const res = await fetch("/api/recent-docs?limit=5", {
            headers: { Authorization: `Bearer ${token}`, "x-request-id": requestId },
            signal: controller.signal,
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            let json: { error?: unknown; requestId?: unknown } | null = null;
            try {
              json = text ? (JSON.parse(text) as { error?: unknown; requestId?: unknown }) : null;
            } catch {
              json = null;
            }
            const serverReqId =
              res.headers.get("x-request-id") ??
              (json && typeof json.requestId === "string" ? json.requestId : null) ??
              requestId;
            const rawError = json && typeof json.error === "string" ? json.error : text || `HTTP ${res.status}`;
            const message = rawError.includes("timeout") ? "加载超时，请稍后重试" : rawError;
            if (res.status === 401 || res.status === 403) {
              console.warn("[home] recent-docs unauthorized", {
                requestId: serverReqId,
                status: res.status,
              });
              setSafe(() => {
                setRecentDocs([]);
                setRecentLoadedOnce(true);
                setRecentError(null);
                setRecentErrorRequestId(null);
              });
              const delay = Math.min(8000, 600 + 400 * attempts);
              scheduleRetry(delay);
              return;
            }

            console.warn("[home] recent-docs failed", {
              requestId: serverReqId,
              status: res.status,
              message,
            });
            setSafe(() => {
              setRecentDocs([]);
              setRecentLoadedOnce(true);
              setRecentError(message);
              setRecentErrorRequestId(serverReqId);
            });
            return;
          }
          const rows = (await res.json()) as unknown;
          if (!Array.isArray(rows)) {
            setSafe(() => {
              setRecentDocs([]);
              setRecentLoadedOnce(true);
              setRecentError("最近项目返回格式异常");
              setRecentErrorRequestId(res.headers.get("x-request-id") ?? requestId);
            });
            return;
          }
          const docs = (rows as RecentDoc[]).slice().sort((a, b) => {
            const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
            const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
            return tb - ta;
          });
          setSafe(() => {
            setRecentDocs(docs);
            setRecentLoadedOnce(true);
            setRecentError(null);
            setRecentErrorRequestId(null);
          });
          recentCache = {
            docs,
            updatedAt: Date.now(),
          };
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (err) {
        if (reqId !== loadRecentReqIdRef.current) return;
        const requestId =
          requestIdForLog ??
          (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`);

        const errRecord = err as { name?: unknown; message?: unknown };
        const name = typeof errRecord?.name === "string" ? errRecord.name : "";
        const message = typeof errRecord?.message === "string" ? errRecord.message : "";
        const isAbort = name === "AbortError" || message.toLowerCase().includes("aborted");
        if (!isAbort) {
          console.warn("[home] recent-docs threw", { requestId, name: name || "unknown", message: message || err });
        }
        setSafe(() => {
          setRecentDocs([]);
          setRecentLoadedOnce(true);
          setRecentError(isAbort ? "加载超时，请稍后重试" : "加载最近项目失败");
          setRecentErrorRequestId(requestId);
        });
        const delay = Math.min(8000, 800 * Math.max(1, attempts));
        scheduleRetry(delay);
      } finally {
        setSafe(() => setRecentLoading(false));
      }
    };

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted || reqId !== loadRecentReqIdRef.current) return;
      if (session?.access_token) {
        void loadRecent();
        return;
      }
      scheduleRetry(600);
    });

    void loadRecent();
    return () => {
      mounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const hour = new Date().getHours();
    const nextGreeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    setGreeting(nextGreeting);
  }, []);

  return (
    <div className="min-h-screen bg-white p-8 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-center text-2xl font-semibold">{greeting}</h1>
          <div className="mt-12">
            <div className="mx-auto max-w-3xl">
              <AIInput onSubmit={handleSubmit} className="rounded-2xl">
                {pendingFiles.length > 0 && (
                  <div className="flex items-center justify-between px-3 py-2 text-xs text-zinc-500">
                    <span>Attachments {pendingFiles.length}</span>
                    <button
                      type="button"
                      onClick={() => setPendingFiles([])}
                      className="text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                    >
                      Clear
                    </button>
                  </div>
                )}
                <AIInputTextarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Message, or enter '/' to select a skill"
                  minHeight={52}
                  className="text-base"
                />
                <AIInputToolbar className="px-2 py-1.5">
                  <AIInputTools>
                    <AIInputFileUploadButton
                      className="h-9 w-9 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                      onFileSelect={handleFileSelect}
                    >
                      <Plus className="h-5 w-5 text-zinc-600 dark:text-zinc-300" />
                    </AIInputFileUploadButton>
                    <AIInputVoiceButton
                      className="rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      onRecordingComplete={handleVoiceRecorded}
                      onTranscript={(text) => {
                        const t = text.trim();
                        if (!t) return;
                        setMessage((prev) => (prev ? `${prev} ${t}` : t));
                      }}
                    >
                      <Mic className="h-5 w-5" />
                    </AIInputVoiceButton>
                  </AIInputTools>
                  <AIInputButton type="submit" className="h-9 w-9 rounded-full bg-black p-0 text-white hover:bg-zinc-800">
                    <ArrowUp className="h-4 w-4" />
                  </AIInputButton>
                </AIInputToolbar>
              </AIInput>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-3xl">
          <div className="mb-12">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium text-zinc-500">
              <Clock className="h-4 w-4" />
              <span>Recent</span>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              <button className="group relative flex aspect-[3/4] flex-col items-start justify-between rounded-xl border border-zinc-100 bg-white p-4 text-left transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
                <span className="font-medium text-zinc-300 group-hover:text-zinc-400 dark:text-zinc-600">New note</span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">Jun 6, 2025</span>
              </button>
              {!recentLoading &&
                recentDocs.map((d) => {
                  const { label, Icon, tone, badge } = getTypeMeta(d.type);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => openRecentDoc(d)}
                      className="group relative flex aspect-[3/4] cursor-pointer flex-col items-start justify-between rounded-xl border border-zinc-100 bg-white p-4 text-left transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="w-full">
                        <div className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase ${badge}`}>
                          <Icon className={`h-3.5 w-3.5 ${tone}`} />
                          <span>{label}</span>
                        </div>
                        <div className="mt-1 line-clamp-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                          {(d.title ?? "").toString().trim() || "Untitled"}
                        </div>
                      </div>
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">{formatUpdatedAt(d.updated_at)}</span>
                    </button>
                  );
                })}
              {recentLoading && recentDocs.length === 0 && (
                <div className="flex aspect-[3/4] flex-col items-start justify-between rounded-xl border border-dashed border-zinc-100 bg-zinc-50 p-4 text-left text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-500">
                  <span>加载最近文档中…</span>
                </div>
              )}
              {!recentLoading && recentLoadedOnce && recentDocs.length === 0 && (
                <div className="flex aspect-[3/4] flex-col items-start justify-between rounded-xl border border-dashed border-zinc-100 bg-zinc-50 p-4 text-left text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-500">
                  <span>
                    {recentError
                      ? `${recentError}${recentErrorRequestId ? `（requestId: ${recentErrorRequestId}）` : ""}`
                      : "暂无最近文档"}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="mb-6 flex items-center justify-between">
            <div className="text-sm font-medium text-zinc-500">Features</div>
            <div className="flex items-center rounded-lg border border-zinc-100 p-1 dark:border-zinc-800">
               <button onClick={() => setView("grid")} className={`rounded p-1 ${view === "grid" ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}>
                  <LayoutGrid className="h-4 w-4" />
               </button>
               <button onClick={() => setView("list")} className={`rounded p-1 ${view === "list" ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}>
                  <List className="h-4 w-4" />
               </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <button
              type="button"
              onClick={() => router.push("/schedule?create=1")}
              className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-zinc-100 bg-white p-5 text-left transition-all hover:border-blue-300 hover:bg-blue-50/40 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-700/60 dark:hover:bg-zinc-900/70"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-500 dark:bg-blue-900/30 dark:text-blue-400">
                  <Users className="h-5 w-5" />
                </div>
                <div className="rounded-full bg-zinc-100 px-2 py-1 text-[10px] font-medium text-zinc-500 group-hover:bg-blue-600 group-hover:text-white dark:bg-zinc-800 dark:text-zinc-400 dark:group-hover:bg-blue-500">
                  Schedule
                </div>
              </div>
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Publish a tweet</h3>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Open the composer to draft and schedule a tweet.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => router.push("/persona/create")}
              className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-dashed border-zinc-200 bg-transparent p-5 text-left transition-all hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/50"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition-colors group-hover:bg-white group-hover:text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:group-hover:bg-zinc-700 dark:group-hover:text-zinc-300">
                  <Plus className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Create persona</h3>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Go to the persona creator and set up a new persona.
                </p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
