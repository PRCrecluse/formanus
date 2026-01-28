"use client";

import { useState, useEffect, useMemo, useCallback, useRef, memo, type FormEventHandler } from "react";
import {
  AIInput,
  AIInputButton,
  AIInputModelSelect,
  AIInputModelSelectContent,
  AIInputModelSelectItem,
  AIInputModelSelectTrigger,
  AIInputTextarea,
  AIInputToolbar,
  AIInputTools,
  AIInputFileUploadButton,
  AIInputVoiceButton,
} from "@/components/ui/ai-input";
import { Plus, Mic, FileText, Images, Image, PenLine, Folder, X, Users, ChevronUp, ChevronDown, RefreshCw } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { getSessionWithTimeout, supabase } from "@/lib/supabaseClient";
import { getCleanPersonaDocId, makePersonaDocDbId, normalizePersonaDocType } from "@/lib/utils";

const SimpleMarkdownRenderer = memo(function SimpleMarkdownRenderer({ content }: { content: string }) {
  const lines = (content ?? "").toString().split(/\r?\n/);
  const elements: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const imgMatches: Array<{ alt: string; url: string }> = [];
    const replaced = line.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (_m, alt, url) => {
      imgMatches.push({ alt: (alt ?? "").toString() || "Image", url: (url ?? "").toString() });
      return "";
    });
    if (imgMatches.length > 0) {
      elements.push(
        <div key={`img-${i}`} className="my-2 flex flex-col gap-2">
          {imgMatches.map((m, idx) => (
            <img
              key={`img-${i}-${idx}`}
              src={m.url}
              alt={m.alt}
              className="rounded-md border border-zinc-200 dark:border-zinc-800 max-w-[360px]"
              style={{ objectFit: "cover" }}
            />
          ))}
        </div>
      );
      if (replaced.trim()) {
        elements.push(
          <p key={`txt-${i}`} className="whitespace-pre-wrap">
            {replaced.trim()}
          </p>
        );
      }
      continue;
    }
    const dl = /^下载：\s*(https?:\/\/\S+)/.exec(line);
    if (dl) {
      elements.push(
        <a
          key={`link-${i}`}
          href={dl[1]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline"
        >
          下载资源包
        </a>
      );
      continue;
    }
    const urlOnly = /^(https?:\/\/\S+)$/.exec(line.trim());
    if (urlOnly) {
      elements.push(
        <a
          key={`url-${i}`}
          href={urlOnly[1]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline"
        >
          {urlOnly[1]}
        </a>
      );
      continue;
    }
    elements.push(
      <p key={`p-${i}`} className="whitespace-pre-wrap">
        {line}
      </p>
    );
  }
  return <div>{elements}</div>;
});

const MODEL_SETTINGS_KEY = "aipersona.chat.models.enabled";

const MODELS = [
  { id: "persona-ai", name: "PersonaAI", badge: "推荐", modelId: "google/gemini-3-pro-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
  { id: "gpt-5.2", name: "GPT5.2", badge: null, modelId: "openai/gpt-5.2", keyName: "NEXT_PUBLIC_GPT52_API_KEY" },
  { id: "nanobanana", name: "Nanobanana", badge: null, modelId: "google/gemini-3-pro-image-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
  { id: "gemini-3.0-pro", name: "Gemini3.0pro", badge: null, modelId: "google/gemini-3-pro-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
  { id: "minimax-m2", name: "Minimax M2", badge: null, modelId: "minimax/minimax-m2", keyName: "NEXT_PUBLIC_MINIMAX_API_KEY" },
  { id: "kimi-0905", name: "Kimi0905", badge: null, modelId: "moonshot/moonshot-v1-8k", keyName: "NEXT_PUBLIC_KIMI_API_KEY" },
];

const readEnabledModelIds = () => {
  const allIds = MODELS.map((m) => m.id);
  if (typeof window === "undefined") return allIds;
  const stored = window.localStorage.getItem(MODEL_SETTINGS_KEY);
  if (!stored) return allIds;
  try {
    const parsed = JSON.parse(stored) as unknown;
    const allowed = new Set<string>(allIds);
    const list = Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string" && allowed.has(v))
      : [];
    const set = new Set(list);
    for (const id of allIds) {
      if (!set.has(id)) set.add(id);
    }
    return Array.from(set);
  } catch {
    return allIds;
  }
};

type BoardAssistantDeliveryDoc = {
  id: string;
  title: string | null;
  persona_id: string | null;
  updated_at: string | null;
  type: string | null;
};

type BoardAssistantMeta = {
  updated_docs?: BoardAssistantDeliveryDoc[];
  thinking_steps?: { label: string }[];
};

const BOARD_MESSAGE_META_DELIMITER = "\n---AIPERSONA_META---\n";

function parseBoardMessageContent(raw: string): { text: string; meta: BoardAssistantMeta | null } {
  const base = (raw ?? "").toString();
  const idx = base.indexOf(BOARD_MESSAGE_META_DELIMITER);
  if (idx < 0) return { text: base, meta: null };
  const text = base.slice(0, idx);
  const metaStr = base.slice(idx + BOARD_MESSAGE_META_DELIMITER.length).trim();
  if (!metaStr) return { text, meta: null };
  const parsed = (() => {
    try {
      return JSON.parse(metaStr) as unknown;
    } catch {
      return null;
    }
  })();
  if (!parsed || typeof parsed !== "object") return { text, meta: null };
  const docsRaw = (parsed as { updated_docs?: unknown }).updated_docs;
  const docs = Array.isArray(docsRaw)
    ? docsRaw
        .map((d) => {
          const obj = d && typeof d === "object" ? (d as Record<string, unknown>) : null;
          const id = typeof obj?.id === "string" ? obj.id : "";
          if (!id) return null;
          return {
            id,
            title: typeof obj?.title === "string" ? obj.title : null,
            persona_id: typeof obj?.persona_id === "string" ? obj.persona_id : null,
            updated_at: typeof obj?.updated_at === "string" ? obj.updated_at : null,
            type: typeof obj?.type === "string" ? obj.type : null,
          } satisfies BoardAssistantDeliveryDoc;
        })
        .filter((x): x is BoardAssistantDeliveryDoc => Boolean(x))
    : [];
  const stepsRaw = (parsed as { thinking_steps?: unknown }).thinking_steps;
  const steps = Array.isArray(stepsRaw)
    ? stepsRaw
        .map((s) => {
          const obj = s && typeof s === "object" ? (s as Record<string, unknown>) : null;
          const label = typeof obj?.label === "string" ? obj.label.trim() : "";
          if (!label) return null;
          return { label };
        })
        .filter((x): x is { label: string } => Boolean(x))
    : [];
  const meta: BoardAssistantMeta = {};
  if (docs.length > 0) meta.updated_docs = docs;
  if (steps.length > 0) meta.thinking_steps = steps;
  return { text, meta: Object.keys(meta).length > 0 ? meta : null };
}

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  meta?: BoardAssistantMeta | null;
};

const ChatMessageItem = memo(function ChatMessageItem({
  msg,
  showRetry,
  onRetry,
  disabled,
}: {
  msg: Message;
  showRetry: boolean;
  onRetry: () => void;
  disabled: boolean;
}) {
  return (
    <div className={`flex flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"}`}>
      <div className="text-xs text-zinc-500">{msg.role === "user" ? "You" : "AI"}</div>
      <div
        className={`rounded-lg px-4 py-2 max-w-[80%] ${
          msg.role === "user"
            ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
            : `prose prose-zinc dark:prose-invert ${showRetry ? "relative pb-10" : ""}`
        }`}
      >
        {msg.role === "assistant" ? (
          <SimpleMarkdownRenderer content={msg.content} />
        ) : (
          <div className="whitespace-pre-wrap">{msg.content}</div>
        )}
        {msg.role === "assistant" && showRetry && (
          <div className="absolute bottom-2 right-2">
            <button
              type="button"
              onClick={onRetry}
              disabled={disabled}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              aria-label="Retry"
              title="Retry"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {msg.role === "assistant" && msg.meta?.updated_docs && msg.meta.updated_docs.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {msg.meta.updated_docs.map((doc) => (
            <div
              key={doc.id}
              className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 dark:border-blue-500/40 dark:bg-blue-950/40 dark:text-blue-100"
            >
              <FileText className="h-3 w-3" />
              <span className="max-w-[220px] truncate">{(doc.title ?? "").toString().trim() || "交付文档"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

const ChatHistorySkeletonBubble = memo(function ChatHistorySkeletonBubble({ align }: { align: "left" | "right" }) {
  const row = align === "right" ? "items-end" : "items-start";
  const bubble = align === "right" ? "bg-zinc-200/80 dark:bg-zinc-800/80" : "bg-zinc-100 dark:bg-zinc-900";
  return (
    <div className={`flex flex-col gap-2 ${row}`}>
      <div className="h-3 w-10 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className={`rounded-lg px-4 py-3 max-w-[80%] w-full ${bubble}`}>
        <div className="space-y-2">
          <div className="h-3 w-[90%] rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-3 w-[76%] rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-3 w-[56%] rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>
    </div>
  );
});

const ChatHistorySkeleton = memo(function ChatHistorySkeleton() {
  return (
    <div className="animate-pulse space-y-8 pt-2">
      <ChatHistorySkeletonBubble align="left" />
      <ChatHistorySkeletonBubble align="right" />
      <ChatHistorySkeletonBubble align="left" />
    </div>
  );
});

const ChatImageSkeleton = memo(function ChatImageSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-3 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <div className="h-32 rounded-md bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-32 rounded-md bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-32 rounded-md bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-32 rounded-md bg-zinc-200 dark:bg-zinc-800" />
      </div>
    </div>
  );
});

type DragResourceMeta = {
  kind?: "persona" | "doc";
  personaId?: string;
  dbId?: string;
  sourcePersonaId?: string | null;
  section?: "persona" | "albums" | "posts" | null;
  isFolder?: boolean;
};

type PersonaDocMeta = {
  id: string;
  title: string | null;
  type: string | null;
  updated_at: string | null;
  persona_id: string | null;
};

const CHAT_HISTORY_PAGE_SIZE = 60;

const parseTypeMeta = (value: string | null | undefined) => {
  const raw = (value ?? "").toString();
  if (!raw) return { base: "", meta: {} as Record<string, string> };
  const parts = raw.split(";");
  const base = parts[0] ?? "";
  const meta: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const [k, v] = part.split("=");
    if (!k) continue;
    meta[k] = (v ?? "").toString();
  }
  return { base, meta };
};

const getCleanDocId = (personaId: string, dbId: string) => {
  if (!personaId || personaId === "__private__") return dbId;
  return getCleanPersonaDocId(personaId, dbId);
};

const resolveParentDbId = (personaId: string, rawParent: string, sectionRootDbId: string | null) => {
  const parent = rawParent.trim();
  if (!parent) return null;
  if (!personaId || personaId === "__private__") {
    return parent === sectionRootDbId ? null : parent;
  }
  const candidate = parent.startsWith(`${personaId}-`) ? parent : makePersonaDocDbId(personaId, parent);
  return candidate === sectionRootDbId ? null : candidate;
};

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const rawChatId = Array.isArray(params.id) ? params.id[0] : params.id;
  const isNewChat = rawChatId === "new";
  const [selectedModel, setSelectedModel] = useState<string>("persona-ai");
  const [enabledModelIds, setEnabledModelIds] = useState<string[]>(() => MODELS.map((m) => m.id));
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyBefore, setHistoryBefore] = useState<string | null>(null);
  const [historyLoadingOlder, setHistoryLoadingOlder] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [title, setTitle] = useState("New Chat");
  const [quickAction, setQuickAction] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [message, setMessage] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const messagesRef = useRef<Message[]>([]);
  const [hoverTip, setHoverTip] = useState<{ x: number; y: number; visible: boolean; text: string }>({
    x: 0,
    y: 0,
    visible: false,
    text: "",
  });
  const showHoverTip = useCallback((text: string, e: React.MouseEvent) => {
    setHoverTip({ x: e.clientX + 12, y: e.clientY + 12, visible: true, text });
  }, []);
  const hideHoverTip = useCallback(() => {
    setHoverTip((p) => ({ ...p, visible: false }));
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [attachedResourceIds, setAttachedResourceIds] = useState<string[]>([]);
  const [attachedPathRefs, setAttachedPathRefs] = useState<string[]>([]);
  const [attachedDocs, setAttachedDocs] = useState<Record<string, { id: string; title: string | null; type: string | null }>>({});
  const [inputBarCollapsed, setInputBarCollapsed] = useState(false);
  const [dragOverInput, setDragOverInput] = useState(false);
  const [dragSource, setDragSource] = useState<"internal" | "external" | null>(null);

  const inputDragDepthRef = useRef(0);
  const userSelectedModelRef = useRef(false);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const stopAllRef = useRef(false);
  const historyLoadReqIdRef = useRef(0);

  const enabledModels = useMemo(() => {
    const allowed = new Set(enabledModelIds);
    const list = MODELS.filter((m) => allowed.has(m.id));
    return list.length > 0 ? list : MODELS;
  }, [enabledModelIds]);

  useEffect(() => {
    setEnabledModelIds(readEnabledModelIds());
  }, []);

  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key !== MODEL_SETTINGS_KEY) return;
      setEnabledModelIds(readEnabledModelIds());
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  useEffect(() => {
    if (enabledModels.length === 0) return;
    if (!enabledModels.some((m) => m.id === selectedModel)) {
      setSelectedModel(enabledModels[0]!.id);
    }
  }, [enabledModels, selectedModel]);

  useEffect(() => {
    if (enabledModels.length === 0) return;
    if (userSelectedModelRef.current) return;
    if (!enabledModels.some((m) => m.id === "persona-ai")) return;
    setSelectedModel("persona-ai");
  }, [enabledModels]);

  const handleModelChange = useCallback((value: string) => {
    userSelectedModelRef.current = true;
    setSelectedModel(value);
  }, []);
  
  useEffect(() => {
    if (quickAction !== "Design Image") return;
    let mounted = true;
    const applyDesignImageModel = async () => {
      try {
        const sessionRes = await supabase.auth.getSession();
        const token = sessionRes.data.session?.access_token ?? "";
        if (!token) {
          if (mounted) setSelectedModel("nanobanana");
          return;
        }
        const res = await fetch("/api/skills/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ id: "design-image" }),
        });
        const data = await res.json().catch(() => null);
        const fixed = (data && typeof (data as { modelId?: unknown }).modelId === "string"
          ? ((data as { modelId: string }).modelId || "")
          : "") || "nanobanana";
        if (mounted) {
          userSelectedModelRef.current = false;
          setSelectedModel(fixed);
        }
      } catch {
        if (mounted) setSelectedModel("nanobanana");
      }
    };
    void applyDesignImageModel();
    return () => {
      mounted = false;
    };
  }, [quickAction]);
  
  useEffect(() => {
    let active = true;
    const checkAuth = async () => {
      const { session } = await getSessionWithTimeout({ timeoutMs: 1200, retries: 2, retryDelayMs: 120 });
      if (!active) return;
      const sessionUser = session?.user ?? null;
      setUserId(sessionUser ? sessionUser.id : null);
      setAuthReady(true);
    };
    checkAuth();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const sessionUser = session?.user ?? null;
      setUserId(sessionUser ? sessionUser.id : null);
      setAuthReady(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (authReady && !userId) {
      router.replace("/landing");
    }
  }, [authReady, userId, router]);

  const parseMessageRow = useCallback((m: { id?: unknown; role?: unknown; content?: unknown; created_at?: unknown }) => {
    const { text, meta } = parseBoardMessageContent((m.content ?? "") as string);
    return {
      id: (m.id ?? "") as string,
      role: (m.role ?? "assistant") as "user" | "assistant",
      content: text,
      created_at: (m.created_at ?? "") as string,
      meta,
    } satisfies Message;
  }, []);

  useEffect(() => {
    if (rawChatId !== "new") return;
    if (typeof window === "undefined") return;
    const draft = window.sessionStorage.getItem("homeChatDraft");
    if (draft) {
      setMessage(draft);
      window.sessionStorage.removeItem("homeChatDraft");
    }
  }, [rawChatId]);

  useEffect(() => {
    let cancelled = false;
    const reqId = (historyLoadReqIdRef.current += 1);
    const fetchChatData = async () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const chatId = rawChatId;

      if (!chatId) return;
      if (chatId === "new") {
        if (cancelled) return;
        setMessages([]);
        setTitle("New Chat");
        setHistoryHasMore(false);
        setHistoryBefore(null);
        return;
      }

      if (typeof chatId === 'string' && !uuidRegex.test(chatId)) {
        console.warn('Invalid Chat ID, redirecting to new chat');
        router.replace('/chat/new');
        return;
      }

      if (!cancelled) setHistoryLoading(true);
      try {
        const sessionRes = await getSessionWithTimeout({ timeoutMs: 1200, retries: 2, retryDelayMs: 120 });
        if (cancelled || reqId !== historyLoadReqIdRef.current) return;
        const sessionUser = sessionRes.session?.user ?? null;
        setAuthReady(true);
        setUserId(sessionUser ? sessionUser.id : null);
        if (!sessionUser) {
          router.replace("/landing");
          return;
        }

        const { data: chat, error: chatError } = await supabase
          .from("chats")
          .select("title")
          .eq("id", chatId)
          .eq("user_id", sessionUser.id)
          .maybeSingle();

        if (cancelled || reqId !== historyLoadReqIdRef.current) return;
        if (chatError) {
          console.error("Error fetching chat:", chatError);
          return;
        }
        if (!chat) {
          router.replace("/chat/new");
          return;
        }
        if (!cancelled) {
          const title = typeof (chat as { title?: unknown }).title === "string" ? (chat as { title: string }).title : null;
          setTitle((title ?? "").toString().trim() || "Chat");
        }

        const { data: msgs, error: msgsError } = await supabase
          .from("messages")
          .select("id,role,content,created_at")
          .eq("chat_id", chatId)
          .order("created_at", { ascending: false })
          .range(0, CHAT_HISTORY_PAGE_SIZE);

        if (cancelled || reqId !== historyLoadReqIdRef.current) return;
        if (msgsError) {
          console.error("Error fetching messages:", msgsError);
          return;
        }

        const rows = (Array.isArray(msgs) ? msgs : []) as Array<{
          id?: unknown;
          role?: unknown;
          content?: unknown;
          created_at?: unknown;
        }>;
        const hasMore = rows.length > CHAT_HISTORY_PAGE_SIZE;
        const slice = rows.slice(0, CHAT_HISTORY_PAGE_SIZE);
        const oldestFirst = slice.reverse().map(parseMessageRow);
        if (!cancelled) {
          setMessages(oldestFirst);
          setHistoryHasMore(hasMore);
          setHistoryBefore(oldestFirst.length > 0 ? oldestFirst[0]!.created_at : null);
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };

    fetchChatData();
    return () => {
      cancelled = true;
    };
  }, [parseMessageRow, rawChatId, router]);

  const loadOlderMessages = useCallback(async () => {
    const chatId = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!chatId || chatId === "new") return;
    if (!historyHasMore) return;
    if (!historyBefore) return;
    if (historyLoadingOlder) return;

    setHistoryLoadingOlder(true);
    try {
      const { data: msgs, error: msgsError } = await supabase
        .from("messages")
        .select("id,role,content,created_at")
        .eq("chat_id", chatId)
        .lt("created_at", historyBefore)
        .order("created_at", { ascending: false })
        .range(0, CHAT_HISTORY_PAGE_SIZE);

      if (msgsError) return;
      const rows = (Array.isArray(msgs) ? msgs : []) as Array<{
        id?: unknown;
        role?: unknown;
        content?: unknown;
        created_at?: unknown;
      }>;
      const hasMore = rows.length > CHAT_HISTORY_PAGE_SIZE;
      const slice = rows.slice(0, CHAT_HISTORY_PAGE_SIZE);
      const oldestFirst = slice.reverse().map(parseMessageRow);
      if (oldestFirst.length > 0) {
        setMessages((prev) => [...oldestFirst, ...prev]);
        setHistoryBefore(oldestFirst[0]!.created_at);
      }
      setHistoryHasMore(hasMore);
    } finally {
      setHistoryLoadingOlder(false);
    }
  }, [historyBefore, historyHasMore, historyLoadingOlder, params.id, parseMessageRow]);

  const pendingFilePreviews = useMemo(() => {
    return pendingFiles.map((file) => ({
      file,
      url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
  }, [pendingFiles]);

  useEffect(() => {
    return () => {
      pendingFilePreviews.forEach((p) => {
        if (p.url) URL.revokeObjectURL(p.url);
      });
    };
  }, [pendingFilePreviews]);

  const handleAddIdsToChat = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setAttachedResourceIds((prev) => {
      const set = new Set(prev);
      ids.forEach((id) => {
        const key = id.trim();
        if (!key) return;
        set.add(key);
      });
      return Array.from(set);
    });
  }, []);

  const handleRemoveAttachedId = useCallback((id: string) => {
    setAttachedResourceIds((prev) => prev.filter((x) => x !== id));
  }, []);

  const handleAddPathRefsToChat = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    const cleaned = paths.map((p) => p.trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    setAttachedPathRefs((prev) => {
      const set = new Set(prev);
      cleaned.forEach((p) => set.add(p));
      return Array.from(set);
    });
  }, []);

  const handleRemovePathRef = useCallback((path: string) => {
    const key = path.trim();
    if (!key) return;
    setAttachedPathRefs((prev) => prev.filter((p) => p !== key));
  }, []);

  const handleRemovePendingFile = useCallback((file: File) => {
    setPendingFiles((prev) => prev.filter((f) => f !== file));
  }, []);

  const resolveAttachedLabel = useCallback(
    (id: string) => {
      const d = attachedDocs[id];
      return (d?.title ?? "").toString().trim() || id;
    },
    [attachedDocs]
  );

  const fetchPersonaDocs = useCallback(async (personaId: string) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? "";
    if (!token) return [];
    try {
      const res = await fetch(`/api/persona-docs?personaId=${encodeURIComponent(personaId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const list = (await res.json()) as PersonaDocMeta[];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }, []);

  const isFolderRow = useCallback(
    (row: PersonaDocMeta, personaId: string) => {
      const { meta } = parseTypeMeta(row.type);
      const cleanId = getCleanDocId(personaId, row.id);
      return meta.folder === "1" || cleanId.startsWith("folder-");
    },
    []
  );

  const collectFolderDocIds = useCallback(
    (docs: PersonaDocMeta[], personaId: string, folderDbId: string, section: string | null) => {
      const folderRow = docs.find((d) => d.id === folderDbId) ?? null;
      const baseType = normalizePersonaDocType(folderRow?.type ?? section ?? "persona");
      const sectionRootClean = baseType === "persona" ? "persona-docs" : baseType;
      const sectionRootDbId =
        personaId && personaId !== "__private__" ? makePersonaDocDbId(personaId, sectionRootClean) : sectionRootClean;
      const rows = docs.filter((d) => normalizePersonaDocType(d.type) === baseType);
      const rowsById = new Map<string, { id: string; isFolder: boolean; parentDbId: string | null }>();
      const childrenByParent = new Map<string | null, string[]>();
      for (const row of rows) {
        const { meta } = parseTypeMeta(row.type);
        const cleanId = getCleanDocId(personaId, row.id);
        const isFolder = meta.folder === "1" || cleanId.startsWith("folder-");
        const parentDbId = resolveParentDbId(personaId, (meta.parent ?? "").toString(), sectionRootDbId);
        rowsById.set(row.id, { id: row.id, isFolder, parentDbId });
        const list = childrenByParent.get(parentDbId);
        if (list) list.push(row.id);
        else childrenByParent.set(parentDbId, [row.id]);
      }
      const collected: string[] = [];
      const stack = [folderDbId];
      const seen = new Set<string>();
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current || seen.has(current)) continue;
        seen.add(current);
        const row = rowsById.get(current);
        if (!row) continue;
        if (!row.isFolder) collected.push(row.id);
        const kids = childrenByParent.get(current) ?? [];
        for (const kid of kids) stack.push(kid);
      }
      return collected;
    },
    []
  );

  const handlePersonaDrop = useCallback(
    async (personaId: string) => {
      const docs = await fetchPersonaDocs(personaId);
      if (docs.length === 0) return;
      const ids = docs.filter((d) => !isFolderRow(d, personaId)).map((d) => d.id);
      if (ids.length === 0) return;
      handleAddIdsToChat(ids);
      setInputBarCollapsed(false);
    },
    [fetchPersonaDocs, handleAddIdsToChat, isFolderRow]
  );

  const handleFolderDrop = useCallback(
    async (payload: DragResourceMeta) => {
      const personaId = (payload.personaId ?? "").toString().trim();
      const folderDbId = (payload.dbId ?? "").toString().trim();
      if (!personaId || !folderDbId) return;
      const docs = await fetchPersonaDocs(personaId);
      if (docs.length === 0) return;
      const ids = collectFolderDocIds(docs, personaId, folderDbId, payload.section ?? null);
      if (ids.length === 0) return;
      handleAddIdsToChat(ids);
      setInputBarCollapsed(false);
    },
    [collectFolderDocIds, fetchPersonaDocs, handleAddIdsToChat]
  );

  const resolveAttachedType = useCallback(
    (id: string) => {
      const d = attachedDocs[id];
      return (d?.type ?? "").toString().toLowerCase();
    },
    [attachedDocs]
  );

  const resolveAttachedStyle = useCallback((typeText: string) => {
    if (typeText.includes("album") || typeText.includes("image") || typeText.includes("video")) {
      return {
        tone: "violet" as const,
        Icon: typeText.includes("image") || typeText.includes("video") ? Image : Images,
      };
    }
    if (typeText.includes("post")) {
      return { tone: "emerald" as const, Icon: PenLine };
    }
    return { tone: "blue" as const, Icon: FileText };
  }, []);

  const renderAttachedChips = useCallback(
    (ids: string[], opts?: { removable?: boolean; layout?: "wrap" | "singleLine" | "twoLine"; maxVisible?: number }) => {
      if (ids.length === 0) return null;
      const removable = Boolean(opts?.removable);
      const layout = opts?.layout ?? "wrap";
      const maxVisible = opts?.maxVisible ?? 6;
      const visibleIds = layout === "singleLine" ? ids.slice(0, maxVisible) : ids;
      const hiddenIds = layout === "singleLine" ? ids.slice(maxVisible) : [];

      const renderChip = (id: string) => {
        const label = resolveAttachedLabel(id);
        const typeText = resolveAttachedType(id);
        const { tone, Icon } = resolveAttachedStyle(typeText);
        const toneClasses =
          tone === "emerald"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-950/60"
            : tone === "violet"
              ? "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-500/40 dark:bg-violet-950/40 dark:text-violet-100 dark:hover:bg-violet-950/60"
              : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-500/40 dark:bg-blue-950/40 dark:text-blue-100 dark:hover:bg-blue-950/60";

        return (
          <div
            key={id}
            className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] ${toneClasses}`}
          >
            <div className="inline-flex min-w-0 items-center gap-1.5" title={label} aria-label={label}>
              <Icon className="h-3 w-3 shrink-0" />
              <span
                className={
                  layout === "twoLine"
                    ? "max-w-[120px] truncate"
                    : layout === "singleLine"
                      ? "max-w-[140px] truncate"
                      : "max-w-[220px] truncate"
                }
              >
                {label}
              </span>
            </div>
            {removable && (
              <button
                type="button"
                onClick={() => handleRemoveAttachedId(id)}
                className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
                aria-label="Remove"
                title="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      };

      if (layout === "twoLine") {
        const twoLineVisible = ids.slice(0, maxVisible);
        const twoLineHidden = ids.slice(maxVisible);
        return (
          <div className="relative min-w-0 overflow-hidden">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 max-h-[52px] overflow-hidden pr-8">
              {twoLineVisible.map((id) => renderChip(id))}
            </div>
            {twoLineHidden.length > 0 && (
              <div className="absolute bottom-0 right-0 z-10 group">
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-[16px] font-black leading-none text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                  title={twoLineHidden.map((id) => resolveAttachedLabel(id)).join(", ")}
                  aria-label="More attached documents"
                >
                  ⋯
                </button>
                <div className="pointer-events-none absolute right-0 top-full z-30 mt-2 w-[360px] max-w-[80vw] opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100">
                  <div className="rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="flex flex-wrap gap-1.5">{twoLineHidden.map((id) => renderChip(id))}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      }

      return (
        <div className={layout === "singleLine" ? "flex min-w-0 items-center gap-2 overflow-hidden" : "flex flex-wrap items-center gap-2"}>
          {visibleIds.map((id) => renderChip(id))}
          {hiddenIds.length > 0 && (
            <div className="relative group shrink-0">
              <div
                className="inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                title={hiddenIds.map((id) => resolveAttachedLabel(id)).join(", ")}
              >
                …
              </div>
              <div className="pointer-events-none absolute left-0 top-full z-30 mt-2 w-[360px] max-w-[80vw] opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100">
                <div className="rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex flex-wrap gap-2">{hiddenIds.map((id) => renderChip(id))}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    },
    [handleRemoveAttachedId, resolveAttachedLabel, resolveAttachedStyle, resolveAttachedType]
  );

  const renderPathRefChips = useCallback(
    (paths: string[], opts?: { removable?: boolean }) => {
      if (paths.length === 0) return null;
      const removable = Boolean(opts?.removable);
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {paths.map((p) => {
            const full = p.trim();
            const label = full.split("/").filter(Boolean).pop() || full;
            return (
              <div
                key={full}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                title={full}
              >
                <Folder className="h-3 w-3 shrink-0 text-zinc-500 dark:text-zinc-300" />
                <span className="max-w-[180px] truncate">{label}</span>
                {removable && (
                  <button
                    type="button"
                    onClick={() => handleRemovePathRef(full)}
                    className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
                    aria-label="Remove"
                    title="Remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      );
    },
    [handleRemovePathRef]
  );

  const renderPendingFileChips = useCallback(() => {
    if (pendingFilePreviews.length === 0) return null;
    const maxVisible = 4;
    const visible = pendingFilePreviews.slice(0, maxVisible);
    const hidden = pendingFilePreviews.slice(maxVisible);

    const renderThumb = (p: { file: File; url: string | null }) => {
      const isImage = Boolean(p.url);
      const label = p.file.name || "Attachment";
      return (
        <div
          key={`${p.file.name}:${p.file.type}:${p.file.size}:${p.file.lastModified}`}
          className="relative shrink-0"
        >
          <div className="h-5 w-5 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
            {isImage ? (
              <img src={p.url!} alt={label} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-zinc-500 dark:text-zinc-300">
                <FileText className="h-3 w-3" />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => handleRemovePendingFile(p.file)}
            className="absolute -right-1 -top-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-md bg-white text-zinc-600 shadow-sm hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label="Remove attachment"
            title="Remove attachment"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      );
    };

    return (
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="flex items-center gap-1">{visible.map((p) => renderThumb(p))}</div>
        {hidden.length > 0 && (
          <div className="relative group shrink-0">
            <div
              className="inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              title={hidden.map((p) => p.file.name).join(", ")}
            >
              …
            </div>
            <div className="pointer-events-none absolute left-0 top-full z-30 mt-2 w-[360px] max-w-[80vw] opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100">
              <div className="rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex flex-wrap gap-2">{hidden.map((p) => renderThumb(p))}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }, [handleRemovePendingFile, pendingFilePreviews]);

  useEffect(() => {
    if (attachedResourceIds.length === 0) return;
    let cancelled = false;
    const loadMissing = async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? "";
      if (!token) return;
      const missing = attachedResourceIds.filter((id) => !attachedDocs[id]);
      if (missing.length === 0) return;
      const entries = await Promise.all(
        missing.map(async (id) => {
          try {
            const res = await fetch(`/api/persona-docs/${encodeURIComponent(id)}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return null;
            const doc = (await res.json()) as { id?: string; title?: string | null; type?: string | null } | null;
            if (!doc || !doc.id) return null;
            return [doc.id, { id: doc.id, title: doc.title ?? null, type: doc.type ?? null }] as const;
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      const next: Record<string, { id: string; title: string | null; type: string | null }> = {};
      entries.forEach((entry) => {
        if (!entry) return;
        next[entry[0]] = entry[1];
      });
      if (Object.keys(next).length > 0) {
        setAttachedDocs((prev) => ({ ...prev, ...next }));
      }
    };
    void loadMissing();
    return () => {
      cancelled = true;
    };
  }, [attachedDocs, attachedResourceIds]);

  const handleMessageChange = useCallback((value: string) => {
    setMessage(value);
  }, []);

  const uploadFile = async (file: File, ownerId: string) => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random()}.${fileExt}`;
    const filePath = `${ownerId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('chat-attachments')
      .upload(filePath, file);

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return null;
    }

    const { data } = supabase.storage
      .from('chat-attachments')
      .getPublicUrl(filePath);

    return data.publicUrl;
  };

  const sendChat = useCallback(
    async (opts?: { overrideMessage?: string; overridePendingFiles?: File[] }) => {
      if (chatSending) return;
      const messageContent = (opts?.overrideMessage ?? message).trim();
      const pendingFilesSnapshot = opts?.overridePendingFiles ?? pendingFiles;
      if (
        !messageContent &&
        pendingFilesSnapshot.length === 0 &&
        attachedResourceIds.length === 0 &&
        attachedPathRefs.length === 0
      )
        return;
      setChatSending(true);
      stopAllRef.current = false;
      const abortController = new AbortController();
      chatAbortControllerRef.current = abortController;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let timeoutTriggered = false;
      let currentChatId = rawChatId ?? "new";
      const setRequestTimeout = (ms: number) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          timeoutTriggered = true;
          abortController.abort();
        }, ms);
      };
      try {
      let currentUserId = userId;
      if (!currentUserId) {
        const { data } = await supabase.auth.getSession();
        currentUserId = data.session?.user?.id ?? null;
        if (currentUserId) {
          setUserId(currentUserId);
        }
      }
      if (!currentUserId) {
        alert("Please login first");
        router.replace("/landing");
        return;
      }

      if (currentChatId === 'new') {
        const { data: newChat, error } = await supabase
          .from('chats')
          .insert({
            user_id: currentUserId,
            title: messageContent.slice(0, 30) || 'New Chat'
          })
          .select()
          .single();
        
        if (error || !newChat) {
          console.error('Error creating chat:', error);
          return;
        }
        currentChatId = newChat.id;
      }

      let finalContent = messageContent;
      const uploadedUrls: string[] = [];

      if (pendingFilesSnapshot.length > 0) {
        const urls = await Promise.all(pendingFilesSnapshot.map((f) => uploadFile(f, currentUserId)));
        urls.forEach((url) => {
          if (!url) return;
          uploadedUrls.push(url);
          finalContent += `\n\n![Image](${url})`;
        });
      }

      const optimisticMessageId = `local-${crypto.randomUUID()}`;
      setMessages((prev) => [
        ...prev,
        { id: optimisticMessageId, role: "user", content: finalContent, created_at: new Date().toISOString(), meta: null },
      ]);

      setPendingFiles([]);
      setAttachedResourceIds([]);
      setAttachedPathRefs([]);
      setMessage("");

      const { data: savedUser, error: msgError } = await supabase
        .from("messages")
        .insert({
          chat_id: currentChatId,
          role: "user",
          content: finalContent,
        })
        .select("id,role,content,created_at")
        .single();

      if (msgError || !savedUser) {
        console.error("Error sending message:", msgError);
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMessageId));
        return;
      }

      setMessages((prev) => prev.map((m) => (m.id === optimisticMessageId ? parseMessageRow(savedUser) : m)));

      const currentHistory = messagesRef.current.map((m) => ({ role: m.role, content: m.content }));
      currentHistory.push({ role: 'user', content: finalContent });

      try {
      const modelConfig = enabledModels.find((m) => m.id === selectedModel) || MODELS[0];
      const resolveEffectiveModelId = (id: string) => {
        if (id !== "persona-ai") return id;
        if (typeof window === "undefined") return "gemini-3.0-pro";
        const raw = window.localStorage.getItem("aipersona.personaai.baseModelId") ?? "";
        const allowed = new Set<string>([...MODELS.map((m) => m.id), "claude-3.5-sonnet"]);
        const next = allowed.has(raw) ? raw : "gemini-3.0-pro";
        return next;
      };
      const effectiveModelId = resolveEffectiveModelId(modelConfig.id);

      const sessionInfo = await getSessionWithTimeout({ timeoutMs: 4500, retries: 3, retryDelayMs: 200 });
      const token = sessionInfo.session?.access_token ?? "";
      if (!token) {
        console.warn("[chat] missing session token", {
          timedOut: Boolean(sessionInfo.timedOut),
          online: typeof navigator !== "undefined" ? navigator.onLine : null,
        });
        if (sessionInfo.timedOut) {
          throw new Error("Session timeout");
        }
        throw new Error("Not logged in");
      }

      const isXhsBatch =
        quickAction === "Batch XHS Posts" ||
        (/小红书/.test(messageContent) && (/图文|封面|内容页|图片|制作|生成/.test(messageContent)));
      const isScheduledTasks = quickAction === "Scheduled Tasks";
      const isDesignImage = quickAction === "Design Image";

      if (isScheduledTasks) {
        setRequestTimeout(45000);
        const res = await fetch("/api/schedule-items", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          signal: abortController.signal,
          body: JSON.stringify({
            content: messageContent,
            status: "draft",
            type: "post",
            accounts: [],
            persona_id: null,
            media: uploadedUrls.map((url) => ({ kind: "image", url })),
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Schedule request failed (${res.status})`);
        }

        const data = (await res.json().catch(() => null)) as { id?: unknown } | null;
        const scheduleId = typeof data?.id === "string" ? data.id : "";
        const reply = scheduleId
          ? `已创建日程草稿：${scheduleId}\n打开：/schedule/drafts`
          : "已创建日程草稿。\n打开：/schedule/drafts";

        const { data: savedAssistant } = await supabase
          .from("messages")
          .insert({
            chat_id: currentChatId,
            role: "assistant",
            content: reply,
          })
          .select("id,role,content,created_at")
          .single();
        if (savedAssistant) {
          setMessages((prev) => [...prev, parseMessageRow(savedAssistant)]);
        }
        setQuickAction(null);
      } else if (isDesignImage) {
        setRequestTimeout(120000);
        const res = await fetch("/api/skills/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          signal: abortController.signal,
          body: JSON.stringify({
            id: "design-image",
            modelId: effectiveModelId,
            input: {
              prompt: messageContent,
              images: uploadedUrls,
            },
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Skill request failed (${res.status})`);
        }

        const data = (await res.json().catch(() => null)) as { output?: unknown } | null;
        const reply =
          data?.output === undefined
            ? "Design Image 已提交。"
            : `Design Image 已提交。\n${JSON.stringify(data.output, null, 2)}`;

        const { data: savedAssistant } = await supabase
          .from("messages")
          .insert({
            chat_id: currentChatId,
            role: "assistant",
            content: reply,
          })
          .select("id,role,content,created_at")
          .single();
        if (savedAssistant) {
          setMessages((prev) => [...prev, parseMessageRow(savedAssistant)]);
        }
        setQuickAction(null);
      } else if (isXhsBatch) {
        const parseChineseCountToken = (token: string): number | null => {
          const t = token.trim();
          if (!t) return null;
          if (/^\d{1,2}$/.test(t)) {
            const n = Number(t);
            if (!Number.isFinite(n)) return null;
            if (n < 1 || n > 15) return null;
            return n;
          }
          const map: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
          if (t === "十") return 10;
          if (t === "十一") return 11;
          if (t === "十二") return 12;
          if (t === "十三") return 13;
          if (t === "十四") return 14;
          if (t === "十五") return 15;
          if (t.length === 2 && t.startsWith("十")) {
            const tail = map[t.slice(1)];
            if (!tail) return null;
            const n = 10 + tail;
            return n >= 1 && n <= 15 ? n : null;
          }
          const direct = map[t];
          return direct && direct >= 1 && direct <= 15 ? direct : null;
        };
        const parseXhsRequestedCount = (text: string): number | null => {
          const raw = (text ?? "").toString();
          if (!raw.trim()) return null;
          const digitMatch = raw.match(
            /(?:^|[^\d])(\d{1,2})\s*(?:个|篇|条|组|套)?\s*(?:小红书|xhs|xiaohongshu)?\s*(?:图文|笔记|帖子|post|posts)?/i
          );
          if (digitMatch?.[1]) {
            const n = parseChineseCountToken(digitMatch[1]);
            if (n) return n;
          }
          const cnMatch = raw.match(/(十五|十四|十三|十二|十一|十|九|八|七|六|五|四|三|二|两|一)\s*(?:个|篇|条|组|套)?\s*(?:小红书|图文|笔记|帖子)?/);
          if (cnMatch?.[1]) {
            const n = parseChineseCountToken(cnMatch[1]);
            if (n) return n;
          }
          return null;
        };
        const requestedPages = parseXhsRequestedCount(messageContent);
        const skillInput = requestedPages ? { topic: messageContent, pages: requestedPages } : { topic: messageContent };
        setRequestTimeout(180000);
        const res = await fetch("/api/skills/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          signal: abortController.signal,
          body: JSON.stringify({
            id: "xhs-batch",
            modelId: effectiveModelId,
            input: skillInput,
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Skill request failed (${res.status})`);
        }

        const data = await res.json().catch(() => null);
        const output = data?.output as
          | {
              title?: string;
              cover?: { title?: string; subtitle?: string | null; url?: string | null };
              pages?: Array<{
                index?: number;
                title?: string;
                bullets?: string[];
                caption?: string;
                image_url?: string | null;
              }>;
              hashtags?: string[];
              zip_url?: string;
            }
          | null;

        const zipUrl = typeof output?.zip_url === "string" ? output?.zip_url : "";
        const coverUrl = typeof output?.cover?.url === "string" ? output?.cover?.url : "";
        const title = typeof output?.title === "string" ? output?.title : "小红书图文";

        const parts: string[] = [];
        parts.push(`已生成：${title}`);
        if (zipUrl) parts.push(`下载：${zipUrl}`);
        if (coverUrl) parts.push(`![封面](${coverUrl})`);
        const pageImgs = Array.isArray(output?.pages) ? output!.pages! : [];
        for (const p of pageImgs) {
          const url = typeof p?.image_url === "string" ? p!.image_url! : "";
          if (url) {
            const idx = typeof p?.index === "number" ? p!.index! : null;
            const label = idx ? `第${idx}页` : "内容页";
            parts.push(`![${label}](${url})`);
          }
        }
        const textParts: string[] = [];
        textParts.push(`# ${title}`);
        if (output?.cover?.title) {
          textParts.push("");
          textParts.push("## 封面");
          textParts.push(`- 标题：${output.cover.title}`);
          if (output.cover.subtitle) textParts.push(`- 副标题：${output.cover.subtitle}`);
        }
        if (pageImgs.length > 0) {
          for (const p of pageImgs) {
            const label = typeof p?.index === "number" ? `第${p.index}页` : "内容页";
            textParts.push("");
            textParts.push(`## ${label}${p?.title ? `：${p.title}` : ""}`);
            const bullets = Array.isArray(p?.bullets) ? p!.bullets!.filter((b) => typeof b === "string" && b.trim()) : [];
            for (const b of bullets) textParts.push(`- ${b.trim()}`);
            if (p?.caption && p.caption.trim()) {
              textParts.push("");
              textParts.push(p.caption.trim());
            }
          }
        }
        if (Array.isArray(output?.hashtags) && output!.hashtags!.length > 0) {
          textParts.push("");
          textParts.push("## 标签");
          textParts.push(output!.hashtags!.join(" "));
        }
        if (zipUrl) {
          textParts.push("");
          textParts.push(`下载：${zipUrl}`);
        }
        const media: Array<{ id: string; kind: "image"; url: string }> = [];
        const seen = new Set<string>();
        const pushMedia = (url: string) => {
          const clean = url.trim();
          if (!clean || seen.has(clean)) return;
          seen.add(clean);
          media.push({ id: crypto.randomUUID(), kind: "image", url: clean });
        };
        if (coverUrl) pushMedia(coverUrl);
        for (const p of pageImgs) {
          const url = typeof p?.image_url === "string" ? p!.image_url! : "";
          if (url) pushMedia(url);
        }
        const postDraft = {
          text: textParts.join("\n"),
          platform: null,
          account: null,
          media,
          postType: "图文",
        };
        let postSaveError: string | null = null;
        try {
          const postDocId = `private-${currentUserId}-${crypto.randomUUID()}`;
          const { error: postError } = await supabase.from("persona_docs").upsert({
            id: postDocId,
            persona_id: null,
            title,
            content: JSON.stringify(postDraft),
            type: "posts",
            updated_at: new Date().toISOString(),
          });
          if (postError) postSaveError = postError.message;
        } catch (e) {
          postSaveError = e instanceof Error ? e.message : "保存失败";
        }
        const aiResponseContent = parts.join("\n");
        const finalResponseContent = postSaveError ? `${aiResponseContent}\n\n保存失败：${postSaveError}` : aiResponseContent;

        const { data: savedAssistant } = await supabase
          .from("messages")
          .insert({
            chat_id: currentChatId,
            role: "assistant",
            content: finalResponseContent,
          })
          .select("id,role,content,created_at")
          .single();
        if (savedAssistant) {
          setMessages((prev) => [...prev, parseMessageRow(savedAssistant)]);
        }
        setQuickAction(null);
      } else {
        setRequestTimeout(90000);
        const res = await fetch("/api/chat/complete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          signal: abortController.signal,
          body: JSON.stringify({
            messages: currentHistory,
            modelId: effectiveModelId,
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Chat request failed (${res.status})`);
        }

        const data = await res.json().catch(() => null);
        const aiResponseContent = data?.choices?.[0]?.message?.content;

        if (aiResponseContent) {
          const { data: savedAssistant } = await supabase
            .from("messages")
            .insert({
              chat_id: currentChatId,
              role: "assistant",
              content: aiResponseContent,
            })
            .select("id,role,content,created_at")
            .single();
          if (savedAssistant) {
            setMessages((prev) => [...prev, parseMessageRow(savedAssistant)]);
          }
        }
      }
      } catch (err) {
        const isAbort =
          stopAllRef.current ||
          (err instanceof DOMException && err.name === "AbortError") ||
          (err instanceof Error && err.name === "AbortError");
        if (isAbort) {
          if (timeoutTriggered && currentChatId !== "new") {
            const { data: savedTimeout } = await supabase
              .from("messages")
              .insert({
                chat_id: currentChatId,
                role: "assistant",
                content: "请求超时，请稍后重试。",
              })
              .select("id,role,content,created_at")
              .single();
            if (savedTimeout) {
              setMessages((prev) => [...prev, parseMessageRow(savedTimeout)]);
            }
          }
        } else {
          const msg = (() => {
            if (typeof err === "string") return err;
            if (err instanceof Error) return err.message || err.name || "Unknown error";
            if (err && typeof err === "object" && "message" in err && typeof (err as { message?: unknown }).message === "string") {
              return String((err as { message?: unknown }).message);
            }
            try {
              const s = JSON.stringify(err);
              return s && s !== "{}" ? s : String(err);
            } catch {
              return String(err);
            }
          })();
          console.error('Error generating AI response:', err);
          if (currentChatId !== "new") {
            const { data: savedErr } = await supabase
              .from("messages")
              .insert({
                chat_id: currentChatId,
                role: "assistant",
                content: msg ? `调用智能体服务时发生错误：${msg}` : "调用智能体服务时发生错误，请稍后重试。",
              })
              .select("id,role,content,created_at")
              .single();
            if (savedErr) {
              setMessages((prev) => [...prev, parseMessageRow(savedErr)]);
            }
          }
        }
      }

      if (rawChatId === "new") {
        router.push(`/chat/${currentChatId}`);
      }
    } finally {
      if (chatAbortControllerRef.current === abortController) {
        chatAbortControllerRef.current = null;
      }
      if (timeoutId) clearTimeout(timeoutId);
      setChatSending(false);
      stopAllRef.current = false;
    }
    },
    [
      attachedPathRefs,
      attachedResourceIds,
      chatSending,
      enabledModels,
      message,
      parseMessageRow,
      pendingFiles,
      quickAction,
      rawChatId,
      router,
      selectedModel,
      uploadFile,
      userId,
    ]
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    await sendChat();
  };

  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m && m.role === "assistant") return m.id;
    }
    return null;
  }, [messages]);

  const handleRetryLast = useCallback(() => {
    if (chatSending) return;
    const list = messagesRef.current;
    let assistantIndex = -1;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i]?.role === "assistant") {
        assistantIndex = i;
        break;
      }
    }
    if (assistantIndex < 0) return;
    let userIndex = assistantIndex - 1;
    while (userIndex >= 0 && list[userIndex]?.role !== "user") userIndex -= 1;
    if (userIndex < 0) return;
    const content = (list[userIndex]?.content ?? "").toString();
    if (!content.trim()) return;
    void sendChat({ overrideMessage: content, overridePendingFiles: [] });
  }, [chatSending, sendChat]);

  const handleFileSelect = (file: File) => {
      setPendingFiles(prev => [...prev, file]);
      setInputBarCollapsed(false);
  };

  const handleVoiceRecorded = async (blob: Blob) => {
      // Convert blob to file and add to pending files
      const file = new File([blob], "voice-message.webm", { type: "audio/webm" });
      setPendingFiles(prev => [...prev, file]);
      setInputBarCollapsed(false);
      // In a real app, you might want to transcribe this or handle it differently
  };

  const renderChatInput = (opts: { showQuickActions: boolean }) => (
    <div>
      {(pendingFiles.length > 0 || attachedResourceIds.length > 0 || attachedPathRefs.length > 0) && (
        <div className="mb-2 rounded-t-2xl border border-b-0 border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span>Input</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-col items-end gap-1">
                  {attachedResourceIds.length > 0 &&
                    renderAttachedChips(attachedResourceIds, { removable: true, layout: "twoLine", maxVisible: 8 })}
                  {attachedPathRefs.length > 0 && renderPathRefChips(attachedPathRefs, { removable: true })}
                  {attachedResourceIds.length === 0 && attachedPathRefs.length === 0 && pendingFiles.length > 0 && (
                    <span className="truncate rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                      Attachments {pendingFiles.length}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInputBarCollapsed((v) => !v)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label={inputBarCollapsed ? "Expand input bar" : "Collapse input bar"}
                title={inputBarCollapsed ? "Expand" : "Collapse"}
              >
                {inputBarCollapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      <AIInput
        onSubmit={handleSubmit}
        className={`${pendingFiles.length > 0 || attachedResourceIds.length > 0 || attachedPathRefs.length > 0 ? "rounded-b-2xl" : "rounded-2xl"} divide-y-0 bg-white dark:bg-zinc-900`}
      >
        <div
          onDragEnter={(e) => {
            e.preventDefault();
            inputDragDepthRef.current += 1;
            if (dragSource !== "internal") setDragSource("external");
            setDragOverInput(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (dragSource !== "internal") setDragSource("external");
            if (!dragOverInput) setDragOverInput(true);
            e.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            inputDragDepthRef.current = Math.max(0, inputDragDepthRef.current - 1);
            if (inputDragDepthRef.current === 0) {
              setDragOverInput(false);
              if (dragSource === "external") setDragSource(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverInput(false);
            setDragSource(null);
            inputDragDepthRef.current = 0;

            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length > 0) {
              files.forEach((f) => handleFileSelect(f));
              return;
            }

            let meta: DragResourceMeta | null = null;
            const metaRaw = e.dataTransfer.getData("application/x-board-resource-meta")?.trim();
            if (metaRaw) {
              try {
                meta = JSON.parse(metaRaw) as DragResourceMeta;
              } catch {
                meta = null;
              }
            }
            if (meta?.kind === "persona" && meta.personaId) {
              void handlePersonaDrop(meta.personaId);
              return;
            }
            if (meta?.kind === "doc" && meta.dbId) {
              if (meta.isFolder) {
                void handleFolderDrop(meta);
                return;
              }
              handleAddIdsToChat([meta.dbId]);
              setInputBarCollapsed(false);
              return;
            }

            const resourceId =
              e.dataTransfer.getData("application/x-board-resource-id")?.trim() ||
              e.dataTransfer.getData("text/plain")?.trim();
            if (resourceId) {
              handleAddIdsToChat([resourceId]);
              setInputBarCollapsed(false);
              return;
            }

            const rawText =
              e.dataTransfer.getData("text/uri-list")?.trim() || e.dataTransfer.getData("text/plain")?.trim() || "";
            if (!rawText) return;
            const paths = rawText
              .split(/\r?\n/g)
              .map((line) => line.trim())
              .filter((line) => Boolean(line) && !line.startsWith("#"))
              .map((line) => {
                if (line.startsWith("file://")) {
                  try {
                    return decodeURIComponent(line.replace(/^file:\/\//, ""));
                  } catch {
                    return line.replace(/^file:\/\//, "");
                  }
                }
                return line;
              })
              .filter((p) => p.startsWith("/"));
            if (paths.length > 0) {
              handleAddPathRefsToChat(paths);
              setInputBarCollapsed(false);
            }
          }}
          className={dragOverInput ? "relative rounded-2xl ring-2 ring-zinc-900/20 dark:ring-white/20" : "relative"}
        >
          {dragOverInput && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-zinc-50/90 px-4 text-center dark:bg-zinc-950/70">
              <div className="w-full rounded-xl border border-dashed border-zinc-300 py-6 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">
                Drop to attach to chat
              </div>
            </div>
          )}
          <AIInputTextarea
            value={message}
            onChange={(e) => handleMessageChange(e.target.value)}
            placeholder={dragOverInput ? "" : "Message, or enter '/' to select a skill"}
            minHeight={52}
            className="text-base"
          />
        </div>
        {!inputBarCollapsed && pendingFiles.length > 0 && (
          <div className="px-3 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              {pendingFiles.length > 0 && renderPendingFileChips()}
            </div>
          </div>
        )}
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

            <div className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-800" />

            <AIInputModelSelect value={selectedModel} onValueChange={handleModelChange} disabled={quickAction === "Design Image"}>
              <AIInputModelSelectTrigger className="w-auto min-w-[140px]">
                 <span className="mr-2 flex items-center gap-2">
                   {selectedModel ? enabledModels.find((m) => m.id === selectedModel)?.name : "Select model"}
                 </span>
              </AIInputModelSelectTrigger>
              <AIInputModelSelectContent className="rounded-xl">
                {enabledModels.map((m) => (
                  <AIInputModelSelectItem key={m.id} value={m.id}>
                    <div className="flex items-center gap-2">
                      <span>{m.name}</span>
                      {m.badge && (
                        <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-medium text-black dark:bg-white/10 dark:text-white">
                          {m.badge}
                        </span>
                      )}
                    </div>
                  </AIInputModelSelectItem>
                ))}
              </AIInputModelSelectContent>
            </AIInputModelSelect>
          </AIInputTools>
          {chatSending && !message.trim() ? (
            <AIInputButton
              type="button"
              className="h-9 w-9 rounded-full bg-black p-0 text-white hover:bg-zinc-800"
              onClick={() => {
                stopAllRef.current = true;
                chatAbortControllerRef.current?.abort();
              }}
            >
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-white" />
            </AIInputButton>
          ) : (
            <AIInputButton
              type="submit"
              className="h-9 w-9 rounded-full bg-black p-0 text-white hover:bg-zinc-800"
              onMouseEnter={(e) => showHoverTip("Send", e)}
              onMouseMove={(e) => showHoverTip("Send", e)}
              onMouseLeave={hideHoverTip}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="h-4 w-4">
                <path
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  d="M12 19V5m0 0 5 5M12 5 7 10"
                />
              </svg>
            </AIInputButton>
          )}
        </AIInputToolbar>
        {quickAction && (
          <div className="px-3 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                <button
                  type="button"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-md hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
                  onClick={() => setQuickAction(null)}
                  aria-label="Clear function"
                  title="Clear"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <span>{quickAction}</span>
              </span>
            </div>
          </div>
        )}
      </AIInput>
      {opts.showQuickActions && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            onClick={() =>
              setQuickAction((prev) => {
                const next = prev === "Batch XHS Posts" ? null : "Batch XHS Posts";
                if (next) setMessage("");
                return next;
              })
            }
          >
            Batch XHS Posts
          </button>
          <button
            type="button"
            className="inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            onClick={() =>
              setQuickAction((prev) => {
                const next = prev === "Scheduled Tasks" ? null : "Scheduled Tasks";
                if (next) setMessage("");
                return next;
              })
            }
          >
            Scheduled Tasks
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            onClick={() =>
              setQuickAction((prev) => {
                const next = prev === "Design Image" ? null : "Design Image";
                if (next) setMessage("");
                return next;
              })
            }
          >
            <span
              aria-hidden="true"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[12px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            >
              🍌
            </span>
            <span className="whitespace-nowrap">Design Image</span>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-screen w-full flex-col bg-white dark:bg-black">
      {hoverTip.visible && (
        <div
          style={{ left: hoverTip.x, top: hoverTip.y }}
          className="fixed z-50 pointer-events-none whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs text-white"
        >
          {hoverTip.text}
        </div>
      )}
      {!isNewChat && (
        <header className="flex h-14 items-center border-b border-zinc-200 px-6 dark:border-zinc-800">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {title}
          </h1>
        </header>
      )}

      {/* Chat Content - Scrollable */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-8">
          {!isNewChat && historyHasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void loadOlderMessages()}
                disabled={historyLoadingOlder}
                className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {historyLoadingOlder ? "加载中..." : "加载更早消息"}
              </button>
            </div>
          )}

          {historyLoading && !isNewChat && messages.length === 0 ? (
            <ChatHistorySkeleton />
          ) : (
            <>
              {messages.length === 0 && isNewChat && (
                <div className="flex flex-col gap-4 text-center mt-10">
                  <h2 className="text-2xl font-bold text-zinc-700 dark:text-zinc-300">
                    What can I help you with?
                  </h2>
                  {renderChatInput({ showQuickActions: true })}
                </div>
              )}

              {messages.map((msg) => (
                <ChatMessageItem
                  key={msg.id}
                  msg={msg}
                  showRetry={msg.role === "assistant" && msg.id === lastAssistantMessageId}
                  onRetry={handleRetryLast}
                  disabled={chatSending}
                />
              ))}
              {chatSending && (
                 <div className="flex flex-col gap-2 items-start animate-in fade-in slide-in-from-bottom-2 duration-300">
                     <div className="pl-8">
                        {(quickAction === "Design Image" || quickAction === "Batch XHS Posts") ? (
                           <ChatImageSkeleton />
                        ) : (
                           <div className="flex gap-1.5 h-6 items-center">
                              <div className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.3s]" />
                              <div className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.15s]" />
                              <div className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce" />
                           </div>
                        )}
                     </div>
                 </div>
              )}
            </>
          )}
            
        </div>
      </div>

      {(messages.length > 0 || !isNewChat) && (
      <div className="p-4 pb-6">
        <div className="mx-auto max-w-3xl">
          {renderChatInput({ showQuickActions: false })}
          <div className="mt-2 text-center text-xs text-zinc-400">
             AI-generated content may be inaccurate.
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
