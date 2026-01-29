"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Bot,
  CheckSquare,
  ArrowLeft,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Folder,
  History,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  List,
  PenLine,
  PlusCircle,
  Search,
  Sidebar as SidebarIcon,
  Users,
  Move,
  Plus,
  Minus,
  Mic,
  FileText,
  File as FileIcon,
  Trash2,
  Copy,
  Undo2,
  X,
  RotateCcw,
  Download,
  RefreshCw,
  BarChart3,
  ArrowLeftRight,
  ArrowUpDown,
} from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DocEditor from "@/components/DocEditor";
import { useChatHistory, useSidePeekHref } from "@/components/AppShell";
import { getSessionWithTimeout, supabase } from "@/lib/supabaseClient";

const MODEL_SETTINGS_KEY = "aipersona.chat.models.enabled";

const MODELS = [
  { id: "gpt-5.2", name: "GPT5.2", badge: null, modelId: "openai/gpt-5.2", keyName: "NEXT_PUBLIC_GPT52_API_KEY" },
  { id: "gpt-oss", name: "GPT oss", badge: null, modelId: "openai/gpt-oss-120b:free", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
  { id: "nanobanana", name: "Nanobanana", badge: null, modelId: "google/gemini-3-pro-image-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
  { id: "gemini-3.0-pro", name: "Gemini3.0pro", badge: null, modelId: "google/gemini-3-pro-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
  { id: "minimax-m2", name: "Minimax M2", badge: null, modelId: "minimax/minimax-m2", keyName: "NEXT_PUBLIC_MINIMAX_API_KEY" },
  { id: "kimi-0905", name: "Kimi0905", badge: null, modelId: "moonshotai/kimi-k2-0905", keyName: "NEXT_PUBLIC_KIMI_API_KEY" },
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

type ChatToolStep =
  | {
      id: string;
      type: "info";
      label: string;
    }
  | {
      id: string;
      type: "doc";
      label: string;
      docId: string;
      personaId: string | null;
      resourceType?: string;
    };

function estimateTokens(text: string): number {
  const raw = (text ?? "").toString();
  if (!raw) return 0;
  const cjk = (raw.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const nonCjkLen = raw.replace(/[\u4e00-\u9fff]/g, "").length;
  return Math.max(1, Math.ceil(cjk + nonCjkLen / 4));
}

function creditsPerRequestForModelKey(modelKey: string | null | undefined): number {
  if (modelKey === "gpt-oss") return 0;
  if (modelKey === "claude-3.5-sonnet") return 3;
  if (modelKey === "nanobanana") return 2;
  if (modelKey === "gpt-5.2") return 2;
  return 2;
}

type BoardChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind?: "normal" | "status";
  steps?: ChatToolStep[];
  meta?: BoardAssistantMeta | null;
  attachedResourceIds?: string[];
  attachedPathRefs?: string[];
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
  task_plan?: { title: string; status?: "pending" | "in_progress" | "completed" }[];
  automation?: {
    id: string;
    name: string;
    cron: string;
    enabled: boolean;
    auto_confirm?: boolean;
    confirm_timeout_seconds?: number;
    confirm_at?: string | null;
  };
  model_id?: string;
  tokens_in?: number;
  tokens_out?: number;
  tokens_total?: number;
};

const BOARD_MESSAGE_META_DELIMITER = "\n---AIPERSONA_META---\n";

type ChatActionConfirm = {
  type: "delete" | "revert";
  messageId: string;
  affectedFiles: string[];
};

type BoardRevertSnapshot = {
  id: string;
  created_at: string;
  resources: ResourceDoc[];
  selectedResourceId: string | null;
  leftPaneMode: "resources" | "doc";
  listFolderId: string | null;
  resourceViewMode: "grid" | "list";
};

function buildBoardAssistantDbContent(text: string, meta: BoardAssistantMeta | null): string {
  const trimmed = (text ?? "").toString();
  const docs = Array.isArray(meta?.updated_docs) ? meta!.updated_docs! : [];
  const steps = Array.isArray(meta?.thinking_steps) ? meta!.thinking_steps! : [];
  const taskPlan = Array.isArray(meta?.task_plan) ? meta!.task_plan! : [];
  const automation = meta?.automation && typeof meta.automation === "object" ? meta.automation : null;
  const payload: BoardAssistantMeta = {};
  if (docs.length > 0) payload.updated_docs = docs;
  if (steps.length > 0) payload.thinking_steps = steps;
  if (taskPlan.length > 0) payload.task_plan = taskPlan;
  if (automation && automation.id) payload.automation = automation;
  if (typeof meta?.model_id === "string" && meta!.model_id) payload.model_id = meta!.model_id;
  if (typeof meta?.tokens_in === "number") payload.tokens_in = meta!.tokens_in;
  if (typeof meta?.tokens_out === "number") payload.tokens_out = meta!.tokens_out;
  if (typeof meta?.tokens_total === "number") payload.tokens_total = meta!.tokens_total;
  if (Object.keys(payload).length === 0) return trimmed;
  return `${trimmed}${BOARD_MESSAGE_META_DELIMITER}${JSON.stringify(payload)}`;
}

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
  const taskPlanRaw = (parsed as { task_plan?: unknown }).task_plan;
  const taskPlan = Array.isArray(taskPlanRaw)
    ? taskPlanRaw
        .map((t) => {
          const obj = t && typeof t === "object" ? (t as Record<string, unknown>) : null;
          const title = typeof obj?.title === "string" ? obj.title.trim() : "";
          if (!title) return null;
          const statusRaw = typeof obj?.status === "string" ? obj.status.trim() : "";
          const status =
            statusRaw === "pending" || statusRaw === "in_progress" || statusRaw === "completed"
              ? (statusRaw as "pending" | "in_progress" | "completed")
              : undefined;
          return { title, ...(status ? { status } : {}) } as { title: string; status?: "pending" | "in_progress" | "completed" };
        })
        .filter((x): x is { title: string; status?: "pending" | "in_progress" | "completed" } => Boolean(x))
    : [];
  const automationRaw = (parsed as { automation?: unknown }).automation;
  const automationObj =
    automationRaw && typeof automationRaw === "object" ? (automationRaw as Record<string, unknown>) : null;
  const automation = (() => {
    if (!automationObj) return null;
    const id = typeof automationObj.id === "string" ? automationObj.id.trim() : "";
    if (!id) return null;
    const name = typeof automationObj.name === "string" ? automationObj.name.trim() : "";
    const cron = typeof automationObj.cron === "string" ? automationObj.cron.trim() : "";
    const enabled = Boolean(automationObj.enabled);
    const autoConfirm = Boolean(automationObj.auto_confirm);
    const confirmTimeoutSeconds =
      typeof automationObj.confirm_timeout_seconds === "number" && Number.isFinite(automationObj.confirm_timeout_seconds)
        ? automationObj.confirm_timeout_seconds
        : 10;
    const confirmAt = typeof automationObj.confirm_at === "string" ? automationObj.confirm_at : null;
    return {
      id,
      name,
      cron,
      enabled,
      auto_confirm: autoConfirm,
      confirm_timeout_seconds: confirmTimeoutSeconds,
      confirm_at: confirmAt,
    } satisfies NonNullable<BoardAssistantMeta["automation"]>;
  })();
  const meta: BoardAssistantMeta = {};
  if (docs.length > 0) meta.updated_docs = docs;
  if (steps.length > 0) meta.thinking_steps = steps;
  if (taskPlan.length > 0) meta.task_plan = taskPlan;
  if (automation) meta.automation = automation;
  const modelId = (parsed as { model_id?: unknown }).model_id;
  if (typeof modelId === "string" && modelId.trim()) meta.model_id = modelId.trim();
  const tin = (parsed as { tokens_in?: unknown }).tokens_in;
  const tout = (parsed as { tokens_out?: unknown }).tokens_out;
  const ttotal = (parsed as { tokens_total?: unknown }).tokens_total;
  if (typeof tin === "number") meta.tokens_in = tin;
  if (typeof tout === "number") meta.tokens_out = tout;
  if (typeof ttotal === "number") meta.tokens_total = ttotal;
  return { text, meta: Object.keys(meta).length > 0 ? meta : null };
}

function docsToChatSteps(messageId: string, docs: BoardAssistantDeliveryDoc[]): ChatToolStep[] {
  return docs.map((d) => ({
    id: `${messageId}:${d.id}`,
    type: "doc",
    label: (d.title ?? "").toString().trim() || "Untitled",
    docId: d.id,
    personaId: d.persona_id ?? null,
    resourceType: d.type ?? undefined,
  }));
}

function metaToChatSteps(messageId: string, meta: BoardAssistantMeta | null): ChatToolStep[] | undefined {
  if (!meta) return undefined;
  const steps: ChatToolStep[] = [];
  const thinkingSteps = Array.isArray(meta.thinking_steps) ? meta.thinking_steps : [];
  for (let i = 0; i < thinkingSteps.length; i++) {
    const label = thinkingSteps[i]?.label;
    if (!label) continue;
    steps.push({ id: `${messageId}:info:${i}`, type: "info", label });
  }
  const docs = Array.isArray(meta.updated_docs) ? meta.updated_docs : [];
  if (docs.length > 0) steps.push(...docsToChatSteps(messageId, docs));
  return steps.length > 0 ? steps : undefined;
}

type PendingBoardChatSend = {
  id: string;
  userId: string | null;
  mode: BoardChatMode;
  userMessageId: string;
  thinkingId: string;
  rawMessage: string;
  requestMessage: string;
  attachedResourceIds: string[];
  attachedPathRefs: string[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
  modelId: string;
  defaultPersonaId: string | null;
  skillId?: string | null;
  skillInput?: unknown;
};

type ResourceDoc = {
  id: string;
  title: string | null;
  updated_at: string | null;
  persona_id?: string | null;
  type?: string | null;
  content?: string | null;
};

type MediaItem = { kind: "image" | "video"; src: string };

type ResourceMeta = {
  id: string;
  title: string | null;
  updated_at: string | null;
  persona_id?: string | null;
  type?: string | null;
  content?: string | null;
};

type ResourceTypeFilter = "all" | "album" | "post" | "doc" | "photo";

const RESOURCE_TYPE_LABELS: Record<ResourceTypeFilter, string> = {
  all: "All",
  album: "Album",
  post: "Post",
  doc: "Doc",
  photo: "Photo",
};

type XhsBatchSkillOutput = {
  title?: string | null;
  cover?: { title?: string | null; subtitle?: string | null; url?: string | null } | null;
  pages?: Array<{
    index?: number | null;
    title?: string | null;
    bullets?: string[] | null;
    caption?: string | null;
    image_url?: string | null;
  }> | null;
  hashtags?: string[] | null;
  zip_url?: string | null;
};

function SimpleMarkdownRenderer({ content }: { content: string }) {
  const lines = (content ?? "").toString().split(/\r?\n/);
  const elements: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip redundant "Generate Image" links if they are standalone or look like a generated action
    if (/\[(Generate Image|生成图片)\]/i.test(line)) {
      // Check if it's just the link or has minimal surrounding text
      const stripped = line.replace(/\[(Generate Image|生成图片)\]\(.*?\)/i, "").trim();
      if (!stripped || stripped.length < 5) continue;
    }
    const imgMatches: Array<{ alt: string; url: string }> = [];
    const replaced = line.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (_m, alt, url) => {
      imgMatches.push({ alt: (alt ?? "").toString() || "Image", url: (url ?? "").toString() });
      return "";
    });
    if (imgMatches.length > 0) {
      elements.push(
        <div key={`img-${i}`} className="my-2 flex flex-col gap-2">
          {imgMatches.map((m, idx) => (
            <ChatImage key={`img-${i}-${idx}`} alt={m.alt} url={m.url} />
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
        <a key={`link-${i}`} href={dl[1]} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
          下载资源包
        </a>
      );
      continue;
    }
    elements.push(
      <p key={`line-${i}`} className="whitespace-pre-wrap">
        {line}
      </p>
    );
  }
  return <>{elements}</>;
}

function ChatImage({ url, alt }: { url: string; alt: string }) {
  const [open, setOpen] = React.useState(false);
  const [scale, setScale] = React.useState(1);
  const [deg, setDeg] = React.useState(0);
  const [flipX, setFlipX] = React.useState(false);
  const [flipY, setFlipY] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const aspect = React.useMemo(() => {
    try {
      const u = new URL(url);
      const wRaw = u.searchParams.get("width") ?? u.searchParams.get("w");
      const hRaw = u.searchParams.get("height") ?? u.searchParams.get("h");
      const w = wRaw ? Number(wRaw) : NaN;
      const h = hRaw ? Number(hRaw) : NaN;
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return `${w} / ${h}`;
      }
    } catch {
      void 0;
    }
    return "1 / 1";
  }, [url]);
  React.useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleSave = React.useCallback(async () => {
    try {
      setSaving(true);
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.src = url;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("load_error"));
      });
      const canvas = document.createElement("canvas");
      const radians = (deg % 360) * (Math.PI / 180);
      const sin = Math.abs(Math.sin(radians));
      const cos = Math.abs(Math.cos(radians));
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const outW = Math.floor(w * cos + h * sin);
      const outH = Math.floor(h * cos + w * sin);
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d")!;
      ctx.translate(outW / 2, outH / 2);
      ctx.rotate(radians);
      ctx.scale(flipX ? -scale : scale, flipY ? -scale : scale);
      ctx.drawImage(img, -w / 2, -h / 2);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = "edited.png";
      a.click();
    } finally {
      setSaving(false);
    }
  }, [deg, flipX, flipY, scale, url]);
  const transform = React.useMemo(() => {
    const sx = flipX ? -scale : scale;
    const sy = flipY ? -scale : scale;
    return `scale(${sx}, ${sy}) rotate(${deg}deg)`;
  }, [deg, flipX, flipY, scale]);
  return (
    <>
      <div
        className="relative rounded-md border border-zinc-200 dark:border-zinc-800 cursor-zoom-in overflow-hidden"
        style={{ width: 200, aspectRatio: aspect }}
        onClick={() => setOpen(true)}
      >
        {!loaded && (
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-700" />
        )}
        <img
          src={url}
          alt={alt}
          className={`absolute inset-0 w-full h-full ${loaded ? "opacity-100" : "opacity-0"}`}
          style={{ objectFit: "contain" }}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          draggable={false}
        />
      </div>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={() => setOpen(false)}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
              className="absolute right-4 top-4 z-30 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md hover:bg-white/25 focus:outline-none focus-visible:outline-none"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>

            <div
              className="absolute inset-0 z-10 flex items-center justify-center px-4 pt-4 pb-28"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={url}
                alt={alt}
                className="select-none"
                style={{
                  transform,
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                }}
                draggable={false}
              />
            </div>

            <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
              <div className="flex items-center gap-1 rounded-full bg-zinc-900/60 px-2 py-2 text-white backdrop-blur-md">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setScale((s) => Math.max(0.1, s - 0.1));
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus-visible:outline-none"
                  aria-label="Zoom out"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setScale((s) => Math.min(5, s + 0.1));
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus-visible:outline-none"
                  aria-label="Zoom in"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeg((d) => d - 90);
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus-visible:outline-none"
                  aria-label="Rotate"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFlipX((v) => !v);
                  }}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus-visible:outline-none ${
                    flipX ? "bg-white/10" : ""
                  }`}
                  aria-label="Flip horizontal"
                >
                  <ArrowLeftRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFlipY((v) => !v);
                  }}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus-visible:outline-none ${
                    flipY ? "bg-white/10" : ""
                  }`}
                  aria-label="Flip vertical"
                >
                  <ArrowUpDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleSave();
                  }}
                  className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/25 disabled:opacity-50 focus:outline-none focus-visible:outline-none"
                >
                  <Download className="h-4 w-4" />
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function formatXhsSkillReply(output: XhsBatchSkillOutput, fallbackTopic: string): string {
  const title = (output.title ?? "").toString().trim() || fallbackTopic;
  const lines: string[] = [];
  lines.push(`我已经为你生成了一套小红书图文脚本：《${title}》。`);

  const cover = output.cover ?? null;
  if (cover) {
    const coverTitle = (cover.title ?? "").toString().trim();
    const coverSubtitle = (cover.subtitle ?? "").toString().trim();
    if (coverTitle) {
      lines.push("");
      lines.push(`封面：${coverTitle}${coverSubtitle ? ` — ${coverSubtitle}` : ""}`);
    }
    const coverUrl = (cover.url ?? "").toString().trim();
    if (coverUrl) {
      lines.push(`封面图片地址：${coverUrl}`);
    }
  }

  const pages = Array.isArray(output.pages) ? output.pages : [];
  if (pages.length > 0) {
    lines.push("");
    lines.push("内容页：");
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i] ?? {};
      const idx = typeof p.index === "number" && Number.isFinite(p.index) ? p.index : i + 1;
      const pageTitle = (p.title ?? "").toString().trim() || "（未命名）";
      lines.push(`第 ${idx} 页：${pageTitle}`);
      const bullets = Array.isArray(p.bullets) ? p.bullets.filter((b): b is string => typeof b === "string") : [];
      if (bullets.length > 0) {
        lines.push("要点：");
        for (const b of bullets) {
          const t = b.trim();
          if (t) lines.push(`- ${t}`);
        }
      }
      const caption = (p.caption ?? "").toString().trim();
      if (caption) {
        lines.push(`文案：${caption}`);
      }
      const imageUrl = (p.image_url ?? "").toString().trim();
      if (imageUrl) {
        lines.push(`配图地址：${imageUrl}`);
      }
      lines.push("");
    }
  }

  const hashtags = Array.isArray(output.hashtags)
    ? output.hashtags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];
  if (hashtags.length > 0) {
    lines.push(`推荐标签：${hashtags.join(" ")}`);
  }

  const zipUrl = (output.zip_url ?? "").toString().trim();
  if (zipUrl) {
    lines.push("");
    lines.push(`已为你打包所有图片和脚本文档：${zipUrl}`);
  }

  return lines.join("\n").trim();
}

function formatRelativeTime(iso?: string | null) {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const diffMs = Date.now() - ts;
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 14) return `${diffDay}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function stripHtmlToText(html?: string | null) {
  const raw = (html ?? "").toString();
  return raw
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPostText(content?: string | null) {
  const raw = (content ?? "").toString().trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return "";
    const text = (parsed as { text?: unknown }).text;
    return typeof text === "string" ? text.trim() : "";
  } catch {
    return "";
  }
}

function extractMediaItems(html?: string | null): MediaItem[] {
  const raw = (html ?? "").toString();
  const items: MediaItem[] = [];
  const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
  const vidRe = /<video[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(raw))) items.push({ kind: "image", src: m[1] });
  while ((m = vidRe.exec(raw))) items.push({ kind: "video", src: m[1] });
  return items;
}

function getChatRoundRange(list: BoardChatMessage[], messageId: string) {
  const index = list.findIndex((m) => m.id === messageId);
  if (index < 0) return null;
  let start = index;
  while (start >= 0 && list[start]?.role !== "user") start -= 1;
  if (start < 0) start = 0;
  let end = start + 1;
  while (end < list.length && list[end]?.role !== "user") end += 1;
  return { start, end };
}

const CACHE_DB_NAME = "aipersona_board_cache";
const CACHE_DB_VERSION = 2;
const CACHE_STORE_DOCS = "persona_docs_meta_v2";
const MAX_CACHED_DOCS = 200;
const BOARD_MEMORY_TTL_MS = 60_000;
const BOARD_CHAT_MODE_STORAGE_KEY = "aipersona_board_chat_mode_v1";
const BOARD_LAST_USER_ID_STORAGE_KEY = "aipersona_board_last_user_id_v1";

type BoardChatMode = "ask" | "create";

function readBoardChatModeFromStorage(): BoardChatMode {
  if (typeof window === "undefined") return "create";
  try {
    const raw = (window.localStorage.getItem(BOARD_CHAT_MODE_STORAGE_KEY) ?? "").toString().trim().toLowerCase();
    return raw === "ask" ? "ask" : "create";
  } catch {
    return "create";
  }
}

function readBoardLastUserIdFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = (window.localStorage.getItem(BOARD_LAST_USER_ID_STORAGE_KEY) ?? "").toString().trim();
    return raw ? raw : null;
  } catch {
    return null;
  }
}

function writeBoardLastUserIdToStorage(userId: string) {
  if (typeof window === "undefined") return;
  const id = (userId ?? "").toString().trim();
  if (!id) return;
  try {
    window.localStorage.setItem(BOARD_LAST_USER_ID_STORAGE_KEY, id);
  } catch {
    void 0;
  }
}

function BoardChatModeToggle(props: {
  value: BoardChatMode;
  onValueChange: (v: BoardChatMode) => void;
  disabled?: boolean;
}) {
  const { value, onValueChange, disabled } = props;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const [dragTranslate, setDragTranslate] = useState<number | null>(null);
  const [maxTranslate, setMaxTranslate] = useState<number>(52);
  const pointerIdRef = useRef<number | null>(null);
  const clickStartXRef = useRef<number>(0);
  const clickDeltaRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const pendingTranslateRef = useRef<number | null>(null);

  const resolveMaxTranslate = useCallback(() => {
    const track = trackRef.current;
    const knob = knobRef.current;
    if (!track || !knob) return 52;
    const trackW = track.clientWidth;
    const knobW = knob.clientWidth;
    const pad = 4;
    return Math.max(0, trackW - knobW - pad * 2);
  }, []);

  useEffect(() => {
    const update = () => setMaxTranslate(resolveMaxTranslate());
    update();
    requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [resolveMaxTranslate]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const scheduleTranslate = useCallback((next: number) => {
    pendingTranslateRef.current = next;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const v = pendingTranslateRef.current;
      if (typeof v !== "number") return;
      setDragTranslate(v);
    });
  }, []);

  const commitFromTranslate = useCallback(
    (translate: number) => {
      const max = resolveMaxTranslate();
      const next = translate >= max / 2 ? "create" : "ask";
      onValueChange(next);
    },
    [onValueChange, resolveMaxTranslate]
  );

  const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (disabled) return;
    pointerIdRef.current = e.pointerId;
    clickStartXRef.current = e.clientX;
    clickDeltaRef.current = 0;
    const track = trackRef.current;
    const knob = knobRef.current;
    if (!track || !knob) return;
    try {
      track.setPointerCapture(e.pointerId);
    } catch {
      void 0;
    }
    const rect = track.getBoundingClientRect();
    const knobRect = knob.getBoundingClientRect();
    const pad = 4;
    const max = Math.max(0, rect.width - knobRect.width - pad * 2);
    const center = e.clientX - rect.left - pad - knobRect.width / 2;
    const next = Math.min(max, Math.max(0, center));
    scheduleTranslate(next);
  };

  const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (disabled) return;
    if (pointerIdRef.current === null || pointerIdRef.current !== e.pointerId) return;
    const track = trackRef.current;
    const knob = knobRef.current;
    if (!track || !knob) return;
    const rect = track.getBoundingClientRect();
    const knobRect = knob.getBoundingClientRect();
    const pad = 4;
    const max = Math.max(0, rect.width - knobRect.width - pad * 2);
    const center = e.clientX - rect.left - pad - knobRect.width / 2;
    const next = Math.min(max, Math.max(0, center));
    scheduleTranslate(next);
    clickDeltaRef.current = Math.max(clickDeltaRef.current, Math.abs(e.clientX - clickStartXRef.current));
  };

  const handlePointerUp: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (disabled) return;
    if (pointerIdRef.current === null || pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    const wasClick = clickDeltaRef.current < 3;
    const translate = pendingTranslateRef.current ?? dragTranslate ?? baseTranslate;
    pendingTranslateRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setDragTranslate(null);
    if (wasClick) {
      onValueChange(value === "ask" ? "create" : "ask");
      return;
    }
    commitFromTranslate(translate);
  };

  const baseTranslate = value === "ask" ? 0 : maxTranslate;
  const translate = dragTranslate ?? baseTranslate;
  const effectiveTranslate = Math.min(maxTranslate, Math.max(0, translate));

  return (
    <div
      ref={trackRef}
      className={`relative inline-flex h-8 w-[112px] select-none items-center rounded-full border border-white/30 bg-white/55 px-1 text-[11px] font-semibold text-zinc-700 shadow-sm ring-1 ring-zinc-200/40 backdrop-blur-md dark:border-white/10 dark:bg-zinc-900/35 dark:text-zinc-200 dark:ring-white/5 ${
        disabled ? "opacity-50" : ""
      }`}
      role="switch"
      aria-checked={value === "create"}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        ref={knobRef}
        className={`absolute left-1 top-1 h-6 w-[52px] rounded-full bg-zinc-900/90 shadow ring-1 ring-black/10 backdrop-blur-md dark:bg-white/90 dark:ring-white/10 ${
          dragTranslate === null ? "transform-gpu transition-transform duration-200 ease-out" : ""
        }`}
        style={{ transform: `translate3d(${effectiveTranslate}px,0,0)` }}
      />
      <div className="relative z-10 grid w-full grid-cols-2 items-center px-1">
        <span
          className={`text-center leading-none ${
            value === "ask" ? "text-white dark:text-zinc-900" : "text-zinc-500 dark:text-zinc-300"
          }`}
        >
          Ask
        </span>
        <span
          className={`text-center leading-none ${
            value === "create" ? "text-white dark:text-zinc-900" : "text-zinc-500 dark:text-zinc-300"
          }`}
        >
          Create
        </span>
      </div>
    </div>
  );
}

let cacheDbPromise: Promise<IDBDatabase> | null = null;

type BoardMemoryCache = {
  userId: string;
  personaIds: string[];
  resources: ResourceDoc[];
  hasMore: boolean;
  nextOffset: number;
  updatedAt: number;
};

let boardMemoryCache: BoardMemoryCache | null = null;

function readBoardMemoryCache(userId: string): BoardMemoryCache | null {
  if (!boardMemoryCache) return null;
  if (boardMemoryCache.userId !== userId) return null;
  if (Date.now() - boardMemoryCache.updatedAt > BOARD_MEMORY_TTL_MS) return null;
  return boardMemoryCache;
}

function writeBoardMemoryCache(entry: Omit<BoardMemoryCache, "updatedAt">) {
  boardMemoryCache = { ...entry, updatedAt: Date.now() };
}

function idbRequest<T>(req: IDBRequest<T>, opts?: { timeoutMs?: number }): Promise<T> {
  const timeoutMs = typeof opts?.timeoutMs === "number" && opts.timeoutMs > 0 ? Math.floor(opts.timeoutMs) : 1200;
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("IndexedDB request timeout"));
    }, timeoutMs);

    req.onsuccess = () => {
      clearTimeout(timeoutId);
      resolve(req.result);
    };
    req.onerror = () => {
      clearTimeout(timeoutId);
      reject(req.error ?? new Error("IndexedDB request failed"));
    };
  });
}

async function openCacheDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB unavailable");
  }
  if (cacheDbPromise) return cacheDbPromise;
  cacheDbPromise = new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cacheDbPromise = null;
      reject(new Error("IndexedDB open timeout"));
    }, 1200);

    const req = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CACHE_STORE_DOCS)) {
        db.createObjectStore(CACHE_STORE_DOCS);
      }
    };
    req.onsuccess = () => {
      clearTimeout(timeoutId);
      const db = req.result;
      db.onversionchange = () => {
        try {
          db.close();
        } catch {
          void 0;
        }
      };
      resolve(db);
    };
    req.onerror = () => {
      clearTimeout(timeoutId);
      cacheDbPromise = null;
      reject(req.error ?? new Error("Failed to open cache db"));
    };
    req.onblocked = () => {
      clearTimeout(timeoutId);
      cacheDbPromise = null;
      reject(new Error("IndexedDB open blocked"));
    };
  });
  return cacheDbPromise;
}

async function readCachedDocs(db: IDBDatabase, userId: string): Promise<ResourceMeta[]> {
  try {
    const tx = db.transaction(CACHE_STORE_DOCS, "readonly");
    const store = tx.objectStore(CACHE_STORE_DOCS);
    const record = (await idbRequest(store.get(userId))) as
      | { docs?: ResourceMeta[]; updatedAt?: number }
      | undefined;
    const docs = Array.isArray(record?.docs) ? record!.docs! : [];
    return docs.slice(0, MAX_CACHED_DOCS);
  } catch {
    return [];
  }
}

async function writeCachedDocs(db: IDBDatabase, userId: string, docs: ResourceMeta[]): Promise<void> {
  try {
    const sorted = [...docs].sort((a, b) => {
      const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return tb - ta;
    });
    const tx = db.transaction(CACHE_STORE_DOCS, "readwrite");
    const store = tx.objectStore(CACHE_STORE_DOCS);
    await idbRequest(
      store.put(
        {
          docs: sorted.slice(0, MAX_CACHED_DOCS),
          updatedAt: Date.now(),
        },
        userId
      )
    );
    tx.commit?.();
  } catch {
    return;
  }
}

async function mergeCachedDocs(db: IDBDatabase, userId: string, docs: ResourceMeta[]): Promise<void> {
  try {
    const tx = db.transaction(CACHE_STORE_DOCS, "readwrite");
    const store = tx.objectStore(CACHE_STORE_DOCS);
    const existing = (await idbRequest(store.get(userId))) as
      | { docs?: ResourceMeta[]; updatedAt?: number }
      | undefined;
    const mergedMap = new Map<string, ResourceMeta>();
    (existing?.docs ?? []).forEach((d) => mergedMap.set(d.id, d));
    docs.forEach((d) => mergedMap.set(d.id, d));
    const merged = Array.from(mergedMap.values()).sort((a, b) => {
      const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return tb - ta;
    });
    await idbRequest(
      store.put(
        {
          docs: merged.slice(0, MAX_CACHED_DOCS),
          updatedAt: Date.now(),
        },
        userId
      )
    );
    tx.commit?.();
  } catch {
    return;
  }
}

async function removeCachedDocs(db: IDBDatabase, userId: string, ids: string[]): Promise<void> {
  try {
    const idSet = new Set(ids);
    const tx = db.transaction(CACHE_STORE_DOCS, "readwrite");
    const store = tx.objectStore(CACHE_STORE_DOCS);
    const existing = (await idbRequest(store.get(userId))) as
      | { docs?: ResourceMeta[]; updatedAt?: number }
      | undefined;
    const nextDocs = (existing?.docs ?? []).filter((d) => !idSet.has(d.id)).slice(0, MAX_CACHED_DOCS);
    await idbRequest(
      store.put(
        {
          docs: nextDocs,
          updatedAt: Date.now(),
        },
        userId
      )
    );
    tx.commit?.();
  } catch {
    return;
  }
}

export default function BoardPage() {
  const chatHistory = useChatHistory();
  const sidePeekHref = useSidePeekHref();
  const router = useRouter();
  const [selectedModel, setSelectedModel] = useState<string>(() => MODELS[0]?.id ?? "gpt-5.2");
  const [enabledModelIds, setEnabledModelIds] = useState<string[]>(() => MODELS.map((m) => m.id));
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [attachedResourceIds, setAttachedResourceIds] = useState<string[]>([]);
  const [attachedPathRefs, setAttachedPathRefs] = useState<string[]>([]);
  const [inputBarCollapsed, setInputBarCollapsed] = useState(false);
  const [resourceViewMode, setResourceViewMode] = useState<"grid" | "list">("grid");
  const [leftPaneMode, setLeftPaneMode] = useState<"resources" | "doc">("resources");
  const [chatMode, setChatMode] = useState<BoardChatMode>("create");
  const stopEvent = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const chatMessagesScrollRef = useRef<HTMLDivElement>(null);
  const inputWindowRef = useRef<HTMLDivElement>(null);
  const resourcesScrollRef = useRef<HTMLDivElement>(null);
  const userSelectedModelRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 24, y: 300 });
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [selectedResourcePersonaIdHint, setSelectedResourcePersonaIdHint] = useState<string | null>(null);
  const [resources, setResources] = useState<ResourceDoc[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [splitPercent, setSplitPercent] = useState<number>(71.4286);
  const [resizing, setResizing] = useState(false);
  const [dividerTip, setDividerTip] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });
  const [hoverTip, setHoverTip] = useState<{ x: number; y: number; visible: boolean; text: string }>({
    x: 0,
    y: 0,
    visible: false,
    text: "",
  });
  const showHoverTip = useCallback((text: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect?.();
    if (!rect) {
      setHoverTip({ x: e.clientX, y: e.clientY, visible: true, text });
      return;
    }
    const x = rect.left + rect.width / 2;
    const y = rect.bottom + 8;
    setHoverTip({ x, y, visible: true, text });
  }, []);
  const hideHoverTip = useCallback(() => {
    setHoverTip((p) => ({ ...p, visible: false }));
  }, []);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [dragOverInput, setDragOverInput] = useState(false);
  const [dragSource, setDragSource] = useState<"internal" | "external" | null>(null);
  const inputDragDepthRef = useRef(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [askDefaultModelId, setAskDefaultModelId] = useState<string>("minimax-m2");

  const enabledModels = useMemo(() => {
    const allowed = new Set(enabledModelIds);
    const list = MODELS.filter((m) => allowed.has(m.id));
    return list.length > 0 ? list : MODELS;
  }, [enabledModelIds]);

  useEffect(() => {
    setEnabledModelIds(readEnabledModelIds());
  }, []);

  useEffect(() => {
    setChatMode(readBoardChatModeFromStorage());
  }, []);
  useEffect(() => {
    let mounted = true;
    const loadAskDefault = async () => {
      try {
        const res = await fetch("/api/models", { method: "GET" });
        if (!mounted) return;
        if (!res.ok) return;
        const json = (await res.json()) as { ask_default?: string } | null;
        const id = (json?.ask_default ?? "").toString().trim();
        const allowed = new Set(MODELS.map((m) => m.id));
        if (id && allowed.has(id)) {
          setAskDefaultModelId(id);
        }
      } catch {
        void 0;
      }
    };
    void loadAskDefault();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(BOARD_CHAT_MODE_STORAGE_KEY, chatMode);
    } catch {
      void 0;
    }
  }, [chatMode]);

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
    if (chatMode === "ask") {
      setSelectedModel(askDefaultModelId);
    }
  }, [askDefaultModelId, chatMode]);

  const handleModelChange = useCallback((value: string) => {
    userSelectedModelRef.current = true;
    setSelectedModel(value);
  }, []);
  const [hasMore, setHasMore] = useState(true);
  const [nextOffset, setNextOffset] = useState(0);
  const pageSize = 30;
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const isFetchingNextRef = useRef(false);
  const loadReqIdRef = useRef(0);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const unmountedRef = useRef(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const [personaIds, setPersonaIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [quickAction, setQuickAction] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<BoardChatMessage[]>([]);
  const [chatSending, setChatSending] = useState(false);
  const [pendingAutomationConfirm, setPendingAutomationConfirm] = useState<{
    id: string;
    confirmAt: string | null;
    timeoutSeconds: number;
  } | null>(null);
  const pendingAutomationConfirmRef = useRef<{
    id: string;
    confirmAt: string | null;
    timeoutSeconds: number;
  } | null>(null);
  const [autoConfirmNow, setAutoConfirmNow] = useState(() => Date.now());
  const [confirmAction, setConfirmAction] = useState<ChatActionConfirm | null>(null);
  const [docDiffs, setDocDiffs] = useState<Record<string, { before: string; after: string }>>({});
  const [boardChatId, setBoardChatId] = useState<string | null>(null);
  const [openStatsForMessageId, setOpenStatsForMessageId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const historyPopoverRef = useRef<HTMLDivElement | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyChats, setHistoryChats] = useState<{ id: string; title: string | null; created_at: string }[]>([]);
  const [listFolderId, setListFolderId] = useState<string | null>(null);
  const [resourceTypeFilter, setResourceTypeFilter] = useState<ResourceTypeFilter>("all");
  const [resourceSearchOpen, setResourceSearchOpen] = useState(false);
  const [resourceSearchQuery, setResourceSearchQuery] = useState("");
  const resourceSearchInputRef = useRef<HTMLInputElement>(null);
  const [createResourceMenuOpen, setCreateResourceMenuOpen] = useState(false);
  const createResourceButtonRef = useRef<HTMLButtonElement | null>(null);
  const createResourceMenuRef = useRef<HTMLDivElement | null>(null);

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
    const handler = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (showHistory) {
        const inButton = Boolean(historyButtonRef.current?.contains(target));
        const inPopover = Boolean(historyPopoverRef.current?.contains(target));
        if (!inButton && !inPopover) setShowHistory(false);
      }

      if (createResourceMenuOpen) {
        const inButton = Boolean(createResourceButtonRef.current?.contains(target));
        const inMenu = Boolean(createResourceMenuRef.current?.contains(target));
        if (!inButton && !inMenu) setCreateResourceMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handler, true);
    return () => window.removeEventListener("pointerdown", handler, true);
  }, [createResourceMenuOpen, showHistory]);

  const createPrivateResource = useCallback(
    async (kind: "doc" | "posts") => {
      let uid = userIdRef.current ?? userId;
      if (!uid) {
        try {
          const sessionInfo = await getSessionWithTimeout({ timeoutMs: 4500, retries: 3, retryDelayMs: 200 });
          uid = sessionInfo.session?.user?.id ?? null;
          if (uid) setUserId(uid);
        } catch {
          uid = null;
        }
      }
      if (!uid) return;

      const id = `private-${uid}-${crypto.randomUUID()}`;
      const nowIso = new Date().toISOString();
      const title = kind === "posts" ? "Untitled post" : "Untitled";
      const { error } = await supabase.from("persona_docs").upsert({
        id,
        persona_id: null,
        title,
        content: "",
        type: kind,
        updated_at: nowIso,
      });
      if (error) return;

      setResources((prev) => [
        { id, persona_id: null, title, content: "", type: kind, updated_at: nowIso } as ResourceDoc,
        ...prev,
      ]);
      setSelectedResourcePersonaIdHint(null);
      setSelectedResourceId(id);
      setLeftPaneMode("doc");
    },
    [userId]
  );

  const getRoutePersonaId = (personaId: string | null | undefined) => {
    const raw = (personaId ?? "").toString().trim();
    return raw || "__private__";
  };

  const getCleanDocId = (docId: string, personaId: string | null | undefined) => {
    const rawPersona = (personaId ?? "").toString().trim();
    if (rawPersona && docId.startsWith(`${rawPersona}-`)) return docId.slice(rawPersona.length + 1);
    return docId;
  };

  const parseTypeMeta = useCallback((value: string | null | undefined) => {
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
  }, []);

  const getBaseType = useCallback((value: string | null | undefined) => {
    const raw = (value ?? "").toString().toLowerCase();
    return raw.split(/[;:#|]/)[0] ?? "";
  }, []);

  const getResourceKind = useCallback(
    (value: string | null | undefined): ResourceTypeFilter => {
      const raw = (value ?? "").toString().toLowerCase();
      const base = getBaseType(raw);
      if (base.includes("album")) return "album";
      if (base.includes("post")) return "post";
      if (base.includes("photo") || base.includes("image") || base.includes("video")) return "photo";
      if (base.includes("doc") || base === "persona") return "doc";
      if (raw.includes("album")) return "album";
      if (raw.includes("post")) return "post";
      if (raw.includes("photo") || raw.includes("image") || raw.includes("video")) return "photo";
      return "doc";
    },
    [getBaseType]
  );

  const resolveResourceBadge = useCallback(
    (rawType: string, isFolder: boolean) => {
      if (isFolder) {
        return {
          label: "Folder",
          Icon: Folder,
          tone: "text-zinc-500/50 dark:text-zinc-400/60",
          badge: "bg-zinc-100/60 text-zinc-600/50 dark:bg-zinc-900/40 dark:text-zinc-300/60",
        };
      }
      const base = getBaseType(rawType);
      if (base === "persona") {
        return {
          label: "Persona",
          Icon: Users,
          tone: "text-emerald-600/50 dark:text-emerald-300/60",
          badge: "bg-emerald-50/50 text-emerald-700/50 dark:bg-emerald-950/15 dark:text-emerald-200/60",
        };
      }
      const kind = getResourceKind(rawType);
      if (kind === "post") {
        return {
          label: "Post",
          Icon: FileText,
          tone: "text-blue-600/50 dark:text-blue-300/60",
          badge: "bg-blue-50/50 text-blue-700/50 dark:bg-blue-950/15 dark:text-blue-200/60",
        };
      }
      if (kind === "album" || kind === "photo") {
        return {
          label: kind === "album" ? "Album" : "Photo",
      Icon: ImageIcon,
          tone: "text-violet-600/50 dark:text-violet-300/60",
          badge: "bg-violet-50/50 text-violet-700/50 dark:bg-violet-950/15 dark:text-violet-200/60",
        };
      }
      return {
        label: "Doc",
        Icon: FileIcon,
        tone: "text-zinc-500/50 dark:text-zinc-400/60",
        badge: "bg-zinc-100/60 text-zinc-600/50 dark:bg-zinc-900/40 dark:text-zinc-300/60",
      };
    },
    [getBaseType, getResourceKind]
  );

  const resourcesRef = useRef<ResourceDoc[]>([]);
  const chatMessagesRef = useRef<BoardChatMessage[]>([]);
  const revertSnapshotsRef = useRef<Map<string, BoardRevertSnapshot>>(new Map());
  const boardChatIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const chatSendQueueRef = useRef<PendingBoardChatSend[]>([]);
  const chatSendInFlightRef = useRef(false);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const resourcesAbortRef = useRef<AbortController | null>(null);
  const stopAllRef = useRef(false);
  const historyLoadReqIdRef = useRef(0);
  const historyLoadAbortRef = useRef<AbortController | null>(null);
  const authTimeoutRetryCountRef = useRef(0);
  const authResolveStartedAtRef = useRef(0);
  const authRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    resourcesRef.current = resources;
  }, [resources]);

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);
  useEffect(() => {
    pendingAutomationConfirmRef.current = pendingAutomationConfirm;
  }, [pendingAutomationConfirm]);
  useEffect(() => {
    if (!pendingAutomationConfirm) return;
    const t = window.setInterval(() => setAutoConfirmNow(Date.now()), 300);
    return () => window.clearInterval(t);
  }, [pendingAutomationConfirm]);

  const enableAutomation = useCallback(async (automationId: string) => {
    const sessionInfo = await getSessionWithTimeout({ timeoutMs: 4500, retries: 2, retryDelayMs: 200 });
    const token = sessionInfo.session?.access_token ?? "";
    if (!token) return;
    await fetch(`/api/automations/${encodeURIComponent(automationId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ enabled: true }),
    }).catch(() => null);
  }, []);

  const cancelAutomation = useCallback(async (automationId: string) => {
    const sessionInfo = await getSessionWithTimeout({ timeoutMs: 4500, retries: 2, retryDelayMs: 200 });
    const token = sessionInfo.session?.access_token ?? "";
    if (!token) return;
    await fetch(`/api/automations/${encodeURIComponent(automationId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
  }, []);

  useEffect(() => {
    if (!pendingAutomationConfirm) return;
    const confirmAtMs = pendingAutomationConfirm.confirmAt ? Date.parse(pendingAutomationConfirm.confirmAt) : NaN;
    const delayMs = Number.isFinite(confirmAtMs)
      ? Math.max(0, confirmAtMs - Date.now())
      : Math.max(0, pendingAutomationConfirm.timeoutSeconds * 1000);
    const t = window.setTimeout(() => {
      const current = pendingAutomationConfirmRef.current;
      if (!current || current.id !== pendingAutomationConfirm.id) return;
      void enableAutomation(pendingAutomationConfirm.id);
      setPendingAutomationConfirm(null);
    }, delayMs);
    return () => window.clearTimeout(t);
  }, [enableAutomation, pendingAutomationConfirm]);

  useEffect(() => {
    boardChatIdRef.current = boardChatId;
  }, [boardChatId]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const resourceIdsByTitle = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of resources) {
      const title = (r.title ?? "").toString().trim();
      if (!title) continue;
      const key = title.toLowerCase();
      const next = map.get(key) ?? [];
      next.push(r.id);
      map.set(key, next);
    }
    return map;
  }, [resources]);

  const listHierarchy = useMemo(() => {
    const getCleanId = (r: ResourceDoc) => getCleanDocId(r.id, r.persona_id);

    const getParentId = (r: ResourceDoc) => {
      const { meta } = parseTypeMeta(r.type);
      const p = (meta.parent ?? "").trim();
      return p ? p : null;
    };

    const getIsFolder = (r: ResourceDoc) => {
      const { meta } = parseTypeMeta(r.type);
      if ((meta.folder ?? "").trim() === "1") return true;
      const clean = getCleanId(r);
      return clean.startsWith("folder-");
    };

    const resolveByIdCandidate = (id: string | null) => {
      if (!id) return null;
      const direct = resources.find((r) => r.id === id) ?? null;
      if (direct) return direct;
      const byClean = resources.find((r) => getCleanId(r) === id) ?? null;
      if (byClean) return byClean;
      const bySuffix = resources.find((r) => r.id.endsWith(`-${id}`)) ?? null;
      return bySuffix;
    };

    const currentFolder = listFolderId ? resolveByIdCandidate(listFolderId) : null;
    const isAtRoot = !currentFolder;

    const folderCandidates = new Set<string>();
    if (currentFolder) {
      folderCandidates.add(currentFolder.id);
      const clean = getCleanId(currentFolder);
      folderCandidates.add(clean);
      const personaId = (currentFolder.persona_id ?? "").toString();
      if (personaId && clean) folderCandidates.add(`${personaId}-${clean}`);
    }

    const visibleResources = resources
      .filter((r) => {
        const base = getBaseType(r.type);
        if (base !== "persona") return isAtRoot;
        const parentId = getParentId(r);
        if (isAtRoot) return parentId === null;
        if (!parentId) return false;
        return folderCandidates.has(parentId);
      })
      .sort((a, b) => {
        const aFolder = getBaseType(a.type) === "persona" && getIsFolder(a);
        const bFolder = getBaseType(b.type) === "persona" && getIsFolder(b);
        if (aFolder !== bFolder) return aFolder ? -1 : 1;
        const aTime = a.updated_at ? Date.parse(a.updated_at) : 0;
        const bTime = b.updated_at ? Date.parse(b.updated_at) : 0;
        return bTime - aTime;
      });

    const parentFolderId = currentFolder ? resolveByIdCandidate(getParentId(currentFolder))?.id ?? null : null;
    const currentFolderTitle = currentFolder ? ((currentFolder.title ?? "").toString().trim() || "Untitled") : null;

    return { currentFolder, currentFolderTitle, parentFolderId, visibleResources };
  }, [getBaseType, getCleanDocId, listFolderId, parseTypeMeta, resources]);

  useEffect(() => {
    if (!resourceSearchOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setResourceSearchOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    resourceSearchInputRef.current?.focus();
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [resourceSearchOpen]);

  const filteredGridResources = useMemo(() => {
    if (resourceTypeFilter === "all") return resources;
    return resources.filter((r) => getResourceKind(r.type) === resourceTypeFilter);
  }, [getResourceKind, resourceTypeFilter, resources]);

  const filteredListResources = useMemo(() => {
    if (resourceTypeFilter === "all") return listHierarchy.visibleResources;
    return listHierarchy.visibleResources.filter((r) => getResourceKind(r.type) === resourceTypeFilter);
  }, [getResourceKind, listHierarchy.visibleResources, resourceTypeFilter]);

  const resourceSearchResults = useMemo(() => {
    const query = resourceSearchQuery.trim().toLowerCase();
    const sorted = [...resources].sort((a, b) => {
      const aTime = a.updated_at ? Date.parse(a.updated_at) : 0;
      const bTime = b.updated_at ? Date.parse(b.updated_at) : 0;
      return bTime - aTime;
    });
    if (!query) return sorted.slice(0, 30);
    return sorted
      .filter((r) => {
        const title = (r.title ?? "").toString().toLowerCase();
        if (title.includes(query)) return true;
        const content = stripHtmlToText(r.content).toLowerCase();
        return content.includes(query);
      })
      .slice(0, 30);
  }, [resourceSearchQuery, resources]);

  useEffect(() => {
    if (!listFolderId) return;
    const exists = resources.some((r) => r.id === listFolderId);
    if (!exists) setListFolderId(null);
  }, [listFolderId, resources]);

  const handleMessageChange = useCallback(
    (value: string) => {
      const docRegex = /【文档:([^】]+)】/g;
      const pathRegex = /【路径:([^】]+)】/g;

      const nextDocIds: string[] = [];
      let nextText = value.replace(docRegex, (full, rawLabel: string) => {
        const label = (rawLabel ?? "").toString().trim();
        if (!label) return full;
        const ids = resourceIdsByTitle.get(label.toLowerCase());
        if (!ids || ids.length === 0) return full;
        nextDocIds.push(...ids);
        return "";
      });

      const nextPaths: string[] = [];
      nextText = nextText.replace(pathRegex, (full, rawPath: string) => {
        const p = (rawPath ?? "").toString().trim();
        if (!p) return full;
        nextPaths.push(p);
        return "";
      });

      if (nextDocIds.length > 0) {
        setAttachedResourceIds((prev) => {
          const set = new Set(prev);
          nextDocIds.forEach((id) => set.add(id));
          return Array.from(set);
        });
      }
      if (nextPaths.length > 0) {
        setAttachedPathRefs((prev) => {
          const set = new Set(prev);
          nextPaths.forEach((p) => set.add(p));
          return Array.from(set);
        });
      }

      if (nextDocIds.length > 0 || nextPaths.length > 0) {
        const compact = nextText
          .replace(/[ \t]{2,}/g, " ")
          .replace(/\s+\n/g, "\n")
          .replace(/\n\s+/g, "\n")
          .trim();
        setMessage(compact);
        return;
      }

      setMessage(value);
    },
    [resourceIdsByTitle]
  );

  const observeItem = (el: HTMLElement | null, id: string) => {
    if (!el) return;
    if (!observerRef.current) return;
    el.dataset.id = id;
    observerRef.current.observe(el);
  };

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  useEffect(() => {
    const el = chatMessagesScrollRef.current;
    if (!el) return;
    const threshold = 120;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const shouldAutoScroll = distanceFromBottom < threshold;
    if (!shouldAutoScroll) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    if (!message) return;
    if (!/【文档:|【路径:/.test(message)) return;
    handleMessageChange(message);
  }, [handleMessageChange, message]);

  useEffect(() => {
    observerRef.current = new IntersectionObserver((entries) => {
      setVisibleIds((prev) => {
        const next = new Set(prev);
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.id || "";
          if (!id) continue;
          if (e.isIntersecting) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    }, { threshold: 0.1 });
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (authRetryTimerRef.current) {
        clearTimeout(authRetryTimerRef.current);
        authRetryTimerRef.current = null;
      }
      if (resourcesAbortRef.current) {
        resourcesAbortRef.current.abort();
        resourcesAbortRef.current = null;
      }
    };
  }, []);

  const applyBoardState = useCallback((entry: Omit<BoardMemoryCache, "updatedAt">) => {
    setUserId(entry.userId);
    setPersonaIds(entry.personaIds);
    setResources(entry.resources);
    setHasMore(entry.hasMore);
    setNextOffset(entry.nextOffset);
  }, []);

  const loadResources = useCallback(
    async (opts?: { force?: boolean }) => {
      const force = Boolean(opts?.force);
      const reqId = ++loadReqIdRef.current;

      if (loadInFlightRef.current) {
        await loadInFlightRef.current;
        if (unmountedRef.current || reqId !== loadReqIdRef.current) return;
      }

      const work = (async () => {
        let cached: ResourceMeta[] = [];
        let db: IDBDatabase | null = null;
        try {
          const fallbackUserId = readBoardLastUserIdFromStorage();
          if (fallbackUserId && !force && !userIdRef.current) {
            try {
              db = await openCacheDb();
              cached = await readCachedDocs(db, fallbackUserId);
            } catch {
              cached = [];
              db = null;
            }
            if (!unmountedRef.current && reqId === loadReqIdRef.current && cached.length > 0) {
              applyBoardState({
                userId: fallbackUserId,
                personaIds: [],
                resources: cached,
                hasMore: false,
                nextOffset: cached.length,
              });
              setResourcesLoading(false);
              setIsSyncing(false);
            }
          }

          const sessionInfo = await getSessionWithTimeout({ timeoutMs: 12_000, retries: 4, retryDelayMs: 250 });
          const user = sessionInfo.session?.user ?? null;
          const token = sessionInfo.session?.access_token ?? null;

          if (!user) {
            const now = Date.now();
            if (!authResolveStartedAtRef.current) authResolveStartedAtRef.current = now;
            const withinGrace = now - authResolveStartedAtRef.current < 60_000;

            if (sessionInfo.timedOut) {
              authTimeoutRetryCountRef.current += 1;
            }
            const shouldRetry = sessionInfo.timedOut || withinGrace;
            if (shouldRetry) {
              if (sessionInfo.timedOut) {
                if (authTimeoutRetryCountRef.current <= 3) {
                  console.warn("[board] getSession timed out, retrying", { attempt: authTimeoutRetryCountRef.current });
                }
              } else {
                authTimeoutRetryCountRef.current = 0;
              }
              if (!unmountedRef.current && reqId === loadReqIdRef.current) {
                setResourcesLoading(true);
                setIsSyncing(false);
              }
              if (authRetryTimerRef.current) clearTimeout(authRetryTimerRef.current);
              authRetryTimerRef.current = setTimeout(() => {
                if (unmountedRef.current) return;
                void loadResources({ force: true });
              }, Math.min(2500, 450 + 180 * Math.max(0, authTimeoutRetryCountRef.current - 1)));
              return;
            }

            console.warn("[board] no active session, stop retrying resources", {
              timedOut: Boolean(sessionInfo.timedOut),
              withinGrace,
              elapsedMs: authResolveStartedAtRef.current ? now - authResolveStartedAtRef.current : 0,
              online: typeof navigator !== "undefined" ? navigator.onLine : null,
            });
            authTimeoutRetryCountRef.current = 0;
            authResolveStartedAtRef.current = 0;
            if (authRetryTimerRef.current) {
              clearTimeout(authRetryTimerRef.current);
              authRetryTimerRef.current = null;
            }
            if (!unmountedRef.current && reqId === loadReqIdRef.current) {
              setResourcesLoading(false);
              setIsSyncing(false);
            }
            return;
          }
          authResolveStartedAtRef.current = 0;
          authTimeoutRetryCountRef.current = 0;
          if (authRetryTimerRef.current) {
            clearTimeout(authRetryTimerRef.current);
            authRetryTimerRef.current = null;
          }
          writeBoardLastUserIdToStorage(user.id);

          const memo = force ? null : readBoardMemoryCache(user.id);
          if (memo && memo.resources.length > 0 && !unmountedRef.current && reqId === loadReqIdRef.current) {
            applyBoardState({
              userId: memo.userId,
              personaIds: memo.personaIds,
              resources: memo.resources,
              hasMore: memo.hasMore,
              nextOffset: memo.nextOffset,
            });
            setResourcesLoading(false);
            setIsSyncing(false);
            return;
          }

          if (!unmountedRef.current && reqId === loadReqIdRef.current) {
            setUserId(user.id);
            setResourcesLoading(true);
          }

          try {
            db = await openCacheDb();
            cached = await readCachedDocs(db, user.id);
          } catch {
            cached = [];
            db = null;
          }

          if (!unmountedRef.current && reqId === loadReqIdRef.current && cached.length > 0) {
            setResources(cached);
            setResourcesLoading(false);
            writeBoardMemoryCache({
              userId: user.id,
              personaIds: [],
              resources: cached,
              hasMore: false,
              nextOffset: cached.length,
            });
          }

          if (!token) {
            if (!unmountedRef.current && reqId === loadReqIdRef.current) {
              setPersonaIds([]);
              setResources(cached.length > 0 ? cached : []);
              setHasMore(false);
              setNextOffset(cached.length > 0 ? cached.length : 0);
              setResourcesLoading(false);
              setIsSyncing(false);
            }
            writeBoardMemoryCache({
              userId: user.id,
              personaIds: [],
              resources: cached.length > 0 ? cached : [],
              hasMore: false,
              nextOffset: cached.length > 0 ? cached.length : 0,
            });
            return;
          }

          if (!unmountedRef.current && reqId === loadReqIdRef.current) setIsSyncing(true);

          if (resourcesAbortRef.current) {
            resourcesAbortRef.current.abort();
          }
          const controller = new AbortController();
          resourcesAbortRef.current = controller;
          const timeoutId = setTimeout(() => controller.abort(), 20000);
          const res = await fetch(
            `/api/board-resources?${new URLSearchParams({
              limit: String(pageSize),
              offset: "0",
            }).toString()}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
              signal: controller.signal,
            }
          );
          clearTimeout(timeoutId);
          if (resourcesAbortRef.current === controller) resourcesAbortRef.current = null;

          if (unmountedRef.current || reqId !== loadReqIdRef.current) return;

          if (!res.ok) {
            console.warn("[board] /api/board-resources failed", {
              status: res.status,
              hasCached: cached.length > 0,
              hasPrev: resourcesRef.current.length > 0,
            });
            if (cached.length > 0) {
              setResources(cached);
              setNextOffset(cached.length);
            } else if (resourcesRef.current.length > 0) {
              setResources(resourcesRef.current);
              setNextOffset(resourcesRef.current.length);
            } else {
              setResources([]);
              setNextOffset(0);
            }
            setHasMore(false);
          } else {
            const body = (await res.json()) as {
              resources?: ResourceDoc[];
              has_more?: boolean;
              next_offset?: number;
            };
            const rows = Array.isArray(body.resources) ? body.resources : [];
            const hasMore = Boolean(body.has_more && rows.length > 0);
            const nextOffset = typeof body.next_offset === "number" ? body.next_offset : rows.length;
            setResources(rows);
            if (db) await writeCachedDocs(db, user.id, rows);
            setHasMore(hasMore);
            setNextOffset(nextOffset);
            writeBoardMemoryCache({
              userId: user.id,
              personaIds: [],
              resources: rows,
              hasMore,
              nextOffset,
            });
          }

          setResourcesLoading(false);
          setIsSyncing(false);
        } catch {
          if (!unmountedRef.current && reqId === loadReqIdRef.current) {
            const fallback = cached.length > 0 ? cached : resourcesRef.current;
            if (fallback.length > 0) {
              setResources(fallback);
              setNextOffset(fallback.length);
            } else {
              setResources([]);
              setNextOffset(0);
            }
            setHasMore(false);
            setResourcesLoading(false);
            setIsSyncing(false);
          }
        }
      })();

      loadInFlightRef.current = work;
      try {
        await work;
      } finally {
        if (loadInFlightRef.current === work) loadInFlightRef.current = null;
      }
    },
    [applyBoardState, pageSize]
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await loadResources();
    };
    run();
    const { data } = supabase.auth.onAuthStateChange(() => {
      if (cancelled) return;
      void loadResources({ force: true });
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [loadResources]);

  const fetchNextPage = useCallback(async () => {
    if (!userId) return;
    if (!hasMore) return;
    if (isFetchingNextRef.current) return;
    isFetchingNextRef.current = true;

    let token = "";
    try {
      const sessionInfo = await getSessionWithTimeout({ timeoutMs: 4500, retries: 3, retryDelayMs: 200 });
      token = sessionInfo.session?.access_token ?? "";
    } catch {
      token = "";
    }

    if (!token) {
      setHasMore(false);
      isFetchingNextRef.current = false;
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(
        `/api/board-resources?${new URLSearchParams({
          limit: String(pageSize),
          offset: String(nextOffset),
        }).toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);

      if (!res.ok) {
        setHasMore(false);
        isFetchingNextRef.current = false;
        return;
      }

      const body = (await res.json()) as {
        resources?: ResourceDoc[];
        has_more?: boolean;
        next_offset?: number;
      };
      const rows = Array.isArray(body.resources) ? body.resources : [];

      if (rows.length === 0) {
        setHasMore(false);
        isFetchingNextRef.current = false;
        return;
      }

      setResources((prev) => {
        const ids = new Set(prev.map((r) => r.id));
        const merged = [...prev, ...rows.filter((r) => !ids.has(r.id))];
        return merged;
      });

      try {
        const db = await openCacheDb();
        await mergeCachedDocs(db, userId, rows);
      } catch {
        void 0;
      }

      const next = typeof body.next_offset === "number" ? body.next_offset : nextOffset + rows.length;
      setNextOffset(next);
      if (!body.has_more || rows.length < pageSize) setHasMore(false);
      isFetchingNextRef.current = false;
    } catch {
      setHasMore(false);
      isFetchingNextRef.current = false;
    }
  }, [hasMore, nextOffset, pageSize, userId]);

  useEffect(() => {
    const el = resourcesScrollRef.current;
    if (leftPaneMode !== "resources") return;
    if (!el) return;
    const onScroll = () => {
      if (!hasMore) return;
      const threshold = 200;
      if (el.scrollTop + el.clientHeight + threshold >= el.scrollHeight) {
        void fetchNextPage();
      }
    };
    el.addEventListener("scroll", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, [fetchNextPage, hasMore, leftPaneMode]);

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleDeleteIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    const uniqueIds = Array.from(new Set(ids.map((x) => x.trim()).filter(Boolean)));
    if (uniqueIds.length === 0) return;

    const prevSelectedResourceId = selectedResourceId;
    const prevSelectedIds = selectedIds;
    const prevNextOffset = nextOffset;

    const idSet = new Set(uniqueIds);
    const prevResources = resources;
    const removedCount = prevResources.reduce((acc, r) => acc + (idSet.has(r.id) ? 1 : 0), 0);

    setResources((prev) => {
      return prev.filter((r) => !idSet.has(r.id));
    });
    setSelectedResourceId((prev) => (prev && idSet.has(prev) ? null : prev));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      uniqueIds.forEach((id) => next.delete(id));
      return next;
    });
    setNextOffset((prev) => Math.max(0, prev - removedCount));

    try {
      const dbPromise = userId ? openCacheDb().catch(() => null) : null;
      const { error } = await supabase.from("persona_docs").delete().in("id", uniqueIds);
      if (error) throw error;

      if (userId) {
        try {
          const db = await dbPromise;
          if (db) await removeCachedDocs(db, userId, uniqueIds);
        } catch {
          void 0;
        }
      }
    } catch {
      setResources(prevResources);
      setSelectedResourceId(prevSelectedResourceId);
      setSelectedIds(prevSelectedIds);
      setNextOffset(prevNextOffset);
    }
  };

  const handleMoveIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    const dest = window.prompt("Move to persona id")?.trim();
    if (!dest) return;
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from("persona_docs")
      .update({ persona_id: dest, updated_at: nowIso })
      .in("id", ids);
    if (!error) {
      setResources((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, persona_id: dest, updated_at: nowIso } : r)));
    }
  };

  const handleAddIdsToChat = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      setAttachedResourceIds((prev) => {
        const set = new Set(prev);
        const added: string[] = [];
        ids.forEach((id) => {
          const key = id.trim();
          if (!key) return;
          if (set.has(key)) return;
          set.add(key);
          added.push(key);
        });
        return Array.from(set);
      });
    },
    []
  );

  const handleRemoveAttachedId = useCallback((id: string) => {
    setAttachedResourceIds((prev) => prev.filter((x) => x !== id));
  }, []);

  const handleAddPathRefsToChat = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    const cleaned = paths.map((p) => p.trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    setAttachedPathRefs((prev) => {
      const set = new Set(prev);
      const added: string[] = [];
      cleaned.forEach((p) => {
        if (set.has(p)) return;
        set.add(p);
        added.push(p);
      });
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

  const resolveAttachedLabel = useCallback(
    (id: string) => {
      const d = resources.find((r) => r.id === id);
      return (d?.title ?? "").toString().trim() || "Untitled";
    },
    [resources]
  );

  const resolveAttachedType = useCallback(
    (id: string) => {
      const d = resources.find((r) => r.id === id);
      return (d?.type ?? "").toString().toLowerCase();
    },
    [resources]
  );

  const resolveAttachedStyle = useCallback((typeText: string) => {
    if (typeText.includes("album") || typeText.includes("image") || typeText.includes("video")) {
      return {
        tone: "violet" as const,
        Icon: typeText.includes("image") || typeText.includes("video") ? ImageIcon : Images,
      };
    }
    if (typeText.includes("post")) {
      return { tone: "emerald" as const, Icon: PenLine };
    }
    return { tone: "blue" as const, Icon: FileText };
  }, []);

  const buildRevertAffectedFiles = useCallback((messageId: string) => {
    const list = chatMessagesRef.current;
    const range = getChatRoundRange(list, messageId);
    if (!range) return [];
    const files = new Set<string>();
    const startMessage = list[range.start] ?? null;
    if (Array.isArray(startMessage?.attachedPathRefs)) {
      startMessage.attachedPathRefs.forEach((p) => {
        const cleaned = p?.toString().trim();
        if (cleaned) files.add(cleaned);
      });
    }
    const slice = list.slice(range.start, range.end);
    for (const m of slice) {
      const steps = Array.isArray(m.steps) ? m.steps : [];
      for (const step of steps) {
        if (step.type !== "doc") continue;
        const label = (step.label ?? "").toString().trim();
        if (label) files.add(label);
      }
    }
    return Array.from(files);
  }, []);

  const buildDeleteAffectedFiles = useCallback((messageId: string) => {
    const list = chatMessagesRef.current;
    const target = list.find((m) => m.id === messageId) ?? null;
    const files = new Set<string>();
    if (Array.isArray(target?.attachedPathRefs)) {
      target.attachedPathRefs.forEach((p) => {
        const cleaned = p?.toString().trim();
        if (cleaned) files.add(cleaned);
      });
    }
    return Array.from(files);
  }, []);

  const openConfirmAction = useCallback(
    (type: ChatActionConfirm["type"], messageId: string) => {
      const affectedFiles = type === "delete" ? buildDeleteAffectedFiles(messageId) : buildRevertAffectedFiles(messageId);
      setConfirmAction({ type, messageId, affectedFiles });
    },
    [buildDeleteAffectedFiles, buildRevertAffectedFiles]
  );

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
        const badge = resolveResourceBadge(typeText, false);

        return (
          <div
            key={id}
            className={`inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-xs font-medium transition-all ${badge.badge.replace("bg-", "border-transparent bg-")}`}
          >
            <button
              type="button"
              onClick={() => {
                setSelectedResourceId(id);
                setLeftPaneMode("doc");
              }}
              className="inline-flex min-w-0 items-center gap-1.5"
              title={label}
              aria-label={label}
            >
              <badge.Icon className={`h-3.5 w-3.5 shrink-0 ${badge.tone.replace("/50", "")}`} />
              <span
                className={
                  layout === "twoLine"
                    ? "max-w-[140px] truncate"
                    : layout === "singleLine"
                      ? "max-w-[160px] truncate"
                      : "max-w-[240px] truncate"
                }
              >
                {label}
              </span>
            </button>
            {removable && (
              <button
                type="button"
                onClick={() => handleRemoveAttachedId(id)}
                className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
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

      // Use consistent folder badge style
      const badge = {
        label: "Folder",
        Icon: Folder,
        tone: "text-zinc-500 dark:text-zinc-400",
        badge: "bg-zinc-100/60 border-transparent text-zinc-600/80 dark:bg-zinc-900/40 dark:text-zinc-300/80",
      };

      return (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {paths.map((p) => {
            const full = p.trim();
            const label = full.split("/").filter(Boolean).pop() || full;
            return (
              <div
                key={full}
                className={`inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-xs font-medium transition-all ${badge.badge}`}
                title={full}
              >
                <badge.Icon className={`h-3.5 w-3.5 shrink-0 ${badge.tone}`} />
                <span className="max-w-[200px] truncate">{label}</span>
                {removable && (
                  <button
                    type="button"
                    onClick={() => handleRemovePathRef(full)}
                    className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
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
    const el = chatPanelRef.current;
    const win = inputWindowRef.current;
    if (!el || !win) return;
    const h = el.clientHeight;
    const yy = Math.max(24, h - win.offsetHeight - 24);
    setPos((p) => ({ x: p.x, y: yy }));
  }, []);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!dragging) return;
      const panel = chatPanelRef.current;
      const win = inputWindowRef.current;
      if (!panel || !win) return;
      const rect = panel.getBoundingClientRect();
      const w = win.offsetWidth;
      const h = win.offsetHeight;
      const nextX = e.clientX - rect.left - dragOffset.x;
      const nextY = e.clientY - rect.top - dragOffset.y;
      const clampedX = Math.max(8, Math.min(nextX, panel.clientWidth - w - 8));
      const clampedY = Math.max(8, Math.min(nextY, panel.clientHeight - h - 8));
      setPos({ x: clampedX, y: clampedY });
    };
    const handleUp = () => setDragging(false);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, dragOffset]);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!resizing) return;
      const wrap = containerRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const minLeftPx = 320;
      const minRightPx = 360;
      const rawLeftPx = e.clientX - rect.left;
      const leftPx = Math.max(minLeftPx, Math.min(rawLeftPx, rect.width - minRightPx));
      const nextPercent = (leftPx / rect.width) * 100;
      setSplitPercent(nextPercent);
      setDividerTip({ x: e.clientX + 12, y: e.clientY + 12, visible: true });
    };
    const handleUp = () => {
      setResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDividerTip((p) => ({ ...p, visible: false }));
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [resizing]);

  useEffect(() => {
    const onResize = () => {
      const panel = chatPanelRef.current;
      const win = inputWindowRef.current;
      if (!panel || !win) return;
      const w = win.offsetWidth;
      const h = win.offsetHeight;
      const maxX = panel.clientWidth - w - 8;
      const maxY = panel.clientHeight - h - 8;
      setPos((p) => ({
        x: Math.max(8, Math.min(p.x, maxX)),
        y: Math.max(8, Math.min(p.y, maxY)),
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onStartResize: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!isDesktop) return;
    e.preventDefault();
    setResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setDividerTip({ x: e.clientX + 12, y: e.clientY + 12, visible: true });
  };

  const onStartDrag = (e: React.MouseEvent) => {
    const win = inputWindowRef.current;
    if (!win) return;
    const rect = win.getBoundingClientRect();
    setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setDragging(true);
  };

  const handleFileSelect = (file: File) => {
    setPendingFiles((prev) => [...prev, file]);
  };

  const handleVoiceRecorded = (_blob: Blob) => {
    void _blob;
    setPendingFiles((prev) => prev);
  };

  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyChatMessage = useCallback(async (messageId: string, text: string) => {
    const value = (text ?? "").toString();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const el = document.createElement("textarea");
      el.value = value;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } catch {
        void 0;
      }
      document.body.removeChild(el);
    }
    setCopiedMessageId(messageId);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedMessageId(null), 1200);
  }, []);

  const updateChatHistoryAfterRemoval = useCallback(
    (chatId: string, removeIds: Set<string>) => {
      if (!chatHistory) return;
      const existing = chatHistory.messagesByChatId[chatId] ?? [];
      if (existing.length === 0) return;
      const next = existing.filter((m) => !removeIds.has(m.id));
      chatHistory.setMessagesForChat(chatId, next);
    },
    [chatHistory]
  );

  const deleteChatMessage = useCallback(
    async (messageId: string) => {
      const list = chatMessagesRef.current;
      const target = list.find((m) => m.id === messageId) ?? null;
      if (!target) return;
      setChatMessages((prev) => prev.filter((m) => m.id !== messageId));
      const chatId = boardChatIdRef.current;
      if (chatId && target.kind !== "status") {
        try {
          await supabase.from("messages").delete().eq("id", messageId);
        } catch {
          void 0;
        }
        updateChatHistoryAfterRemoval(chatId, new Set([messageId]));
      }
    },
    [updateChatHistoryAfterRemoval]
  );

  const fetchAllBoardResources = useCallback(async (): Promise<ResourceDoc[] | null> => {
    let token = "";
    try {
      const sessionInfo = await getSessionWithTimeout({ timeoutMs: 4500, retries: 3, retryDelayMs: 200 });
      token = sessionInfo.session?.access_token ?? "";
    } catch {
      token = "";
    }
    if (!token) return null;

    const limit = 200;
    let offset = 0;
    const rows: ResourceDoc[] = [];
    const seen = new Set<string>();
    while (true) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(
        `/api/board-resources?${new URLSearchParams({ limit: String(limit), offset: String(offset) }).toString()}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }
      ).catch(() => null);
      clearTimeout(timeoutId);
      if (!res || !res.ok) break;
      const body = (await res.json().catch(() => null)) as
        | { resources?: ResourceDoc[]; has_more?: boolean; next_offset?: number }
        | null;
      const page = Array.isArray(body?.resources) ? body!.resources! : [];
      for (const r of page) {
        if (!r || typeof r !== "object") continue;
        const id = (r.id ?? "").toString();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        rows.push({
          id,
          title: r.title ?? null,
          updated_at: r.updated_at ?? null,
          persona_id: (r.persona_id ?? null) as string | null,
          type: (r.type ?? null) as string | null,
          content: (r.content ?? null) as string | null,
        });
      }
      if (!body?.has_more || page.length < limit) break;
      offset = typeof body.next_offset === "number" ? body.next_offset : offset + page.length;
    }
    return rows;
  }, []);

  const ensureRevertSnapshot = useCallback(
    (userMessageId: string) => {
      const nowIso = new Date().toISOString();
      const baseResources = resourcesRef.current.map((r) => ({
        id: r.id,
        title: r.title ?? null,
        updated_at: r.updated_at ?? null,
        persona_id: (r.persona_id ?? null) as string | null,
        type: (r.type ?? null) as string | null,
        content: (r.content ?? null) as string | null,
      }));
      const existing = revertSnapshotsRef.current.get(userMessageId) ?? null;
      if (!existing) {
        revertSnapshotsRef.current.set(userMessageId, {
          id: userMessageId,
          created_at: nowIso,
          resources: baseResources,
          selectedResourceId,
          leftPaneMode,
          listFolderId,
          resourceViewMode,
        });
      }

      void (async () => {
        const snapshot = revertSnapshotsRef.current.get(userMessageId) ?? null;
        if (!snapshot) return;
        const all = await fetchAllBoardResources();
        if (!all || all.length === 0) return;
        const merged = new Map<string, ResourceDoc>();
        snapshot.resources.forEach((r) => merged.set(r.id, r));
        all.forEach((r) => merged.set(r.id, r));
        const next = Array.from(merged.values());
        revertSnapshotsRef.current.set(userMessageId, { ...snapshot, resources: next });
      })();
    },
    [fetchAllBoardResources, leftPaneMode, listFolderId, resourceViewMode, selectedResourceId]
  );

  const applyRevertSnapshot = useCallback(
    async (userMessageId: string) => {
      const snapshot = revertSnapshotsRef.current.get(userMessageId) ?? null;
      if (!snapshot) return false;

      stopAllRef.current = true;
      chatSendQueueRef.current = [];
      chatAbortControllerRef.current?.abort();
      stopAllRef.current = false;

      const currentAll = (await fetchAllBoardResources()) ?? resourcesRef.current;
      const currentIds = new Set(currentAll.map((r) => r.id));
      const snapshotIds = new Set(snapshot.resources.map((r) => r.id));
      const extraIds = Array.from(currentIds).filter((id) => !snapshotIds.has(id));

      const batchDelete = async (ids: string[]) => {
        const batchSize = 100;
        for (let i = 0; i < ids.length; i += batchSize) {
          const chunk = ids.slice(i, i + batchSize);
          if (chunk.length === 0) continue;
          await supabase.from("persona_docs").delete().in("id", chunk);
        }
      };
      const batchUpsert = async (docs: ResourceDoc[]) => {
        const batchSize = 100;
        for (let i = 0; i < docs.length; i += batchSize) {
          const chunk = docs.slice(i, i + batchSize);
          if (chunk.length === 0) continue;
          await supabase.from("persona_docs").upsert(
            chunk.map((r) => ({
              id: r.id,
              persona_id: (r.persona_id ?? null) as string | null,
              title: (r.title ?? null) as string | null,
              type: (r.type ?? null) as string | null,
              content: (r.content ?? null) as string | null,
              updated_at: (r.updated_at ?? snapshot.created_at) as string | null,
            }))
          );
        }
      };

      try {
        if (extraIds.length > 0) {
          await batchDelete(extraIds);
          console.log("[board] applyRevertSnapshot deleted extra docs", {
            userMessageId,
            deletedCount: extraIds.length,
          });
        }
        await batchUpsert(snapshot.resources);
        console.log("[board] applyRevertSnapshot restored snapshot docs", {
          userMessageId,
          snapshotCount: snapshot.resources.length,
        });
      } catch (error) {
        console.error("[board] applyRevertSnapshot failed", { userMessageId, error });
        return false;
      }

      setResources(snapshot.resources);
      setNextOffset(snapshot.resources.length);
      setHasMore(false);
      setResourceViewMode(snapshot.resourceViewMode);
      setListFolderId(snapshot.listFolderId);
      setLeftPaneMode(snapshot.leftPaneMode);
      setSelectedResourceId(snapshot.selectedResourceId && snapshotIds.has(snapshot.selectedResourceId) ? snapshot.selectedResourceId : null);

      const uid = userIdRef.current;
      if (uid) {
        try {
          const db = await openCacheDb();
          await writeCachedDocs(db, uid, snapshot.resources);
        } catch {
          void 0;
        }
      }
      return true;
    },
    [fetchAllBoardResources]
  );

  const undoChatRound = useCallback(
    async (
      messageId: string,
      options?: { revertDocs?: boolean }
    ): Promise<{ message: string; attachedResourceIds: string[]; attachedPathRefs: string[] } | null> => {
      const revertDocs = options?.revertDocs !== false;
      console.log("[board] undoChatRound invoked", { messageId, revertDocs });
      const list = chatMessagesRef.current;
      const index = list.findIndex((m) => m.id === messageId);
      if (index < 0) {
        console.warn("[board] undoChatRound: message not found", { messageId });
        return null;
      }
      let start = index;
      while (start >= 0 && list[start]?.role !== "user") start -= 1;
      if (start < 0) start = 0;
      let end = start + 1;
      while (end < list.length && list[end]?.role !== "user") end += 1;
      const toRemove = list.slice(start, end);
      if (toRemove.length === 0) {
        console.warn("[board] undoChatRound: nothing to remove", { messageId, start, end });
        return null;
      }
      const userMessage = list[start]?.role === "user" ? list[start] : null;
      if (userMessage?.id && revertDocs) {
        const ok = await applyRevertSnapshot(userMessage.id);
        if (!ok) {
          console.error("[board] undoChatRound: applyRevertSnapshot failed", {
            messageId,
            userMessageId: userMessage.id,
          });
        }
      }
      const restoreMessage = (userMessage?.content ?? "").toString();
      const restoreAttachedIds = Array.isArray(userMessage?.attachedResourceIds)
        ? userMessage!.attachedResourceIds!.map((id) => id.toString())
        : [];
      const restoreAttachedPathRefs = Array.isArray(userMessage?.attachedPathRefs)
        ? userMessage!.attachedPathRefs!.map((p) => p.toString())
        : [];
      const removeIds = toRemove.filter((m) => m.kind !== "status").map((m) => m.id);
      setChatMessages((prev) => [...prev.slice(0, start), ...prev.slice(end)]);
      setPendingFiles([]);
      setMessage(restoreMessage);
      setAttachedResourceIds(restoreAttachedIds);
      setAttachedPathRefs(restoreAttachedPathRefs);
      const chatId = boardChatIdRef.current;
      if (chatId && removeIds.length > 0) {
        try {
          await supabase.from("messages").delete().in("id", removeIds);
        } catch {
          void 0;
        }
        updateChatHistoryAfterRemoval(chatId, new Set(removeIds));
      }
      return {
        message: restoreMessage,
        attachedResourceIds: restoreAttachedIds,
        attachedPathRefs: restoreAttachedPathRefs,
      };
    },
    [applyRevertSnapshot, updateChatHistoryAfterRemoval]
  );

  const withPathRefs = (text: string, paths: string[] | undefined) => {
    const base = text.toString();
    const list = Array.isArray(paths) ? paths.map((p) => p.trim()).filter(Boolean) : [];
    if (list.length === 0) return base;
    const alreadyIncluded = list.every((p) => base.includes(p));
    if (alreadyIncluded) return base;
    return `${base}\n\nRef paths:\n${list.join("\n")}`;
  };

  const sendPendingChat = useCallback(async (pending: PendingBoardChatSend) => {
    const abortController = new AbortController();
    chatAbortControllerRef.current = abortController;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let timeoutTriggered = false;
    let token = "";
    let sessionTimedOut = false;
    try {
      const sessionInfo = await getSessionWithTimeout({ timeoutMs: 4500, retries: 3, retryDelayMs: 200 });
      token = sessionInfo.session?.access_token ?? "";
      sessionTimedOut = Boolean(sessionInfo.timedOut);
    } catch {
      token = "";
    }

    const requestId = pending.id;

    const withRequestId = (_text: string) => {
      return `request failed,requestid=${requestId}`;
    };

    const updateThinking = (updater: (m: BoardChatMessage) => BoardChatMessage) => {
      setChatMessages((prev) => prev.map((m) => (m.id === pending.thinkingId ? updater(m) : m)));
    };

    const addThinkingInfo = (label: string) => {
      if (label === "Calling model") return;
      const id = crypto.randomUUID();
      updateThinking((m) => ({ ...m, steps: [...(m.steps ?? []), { id, type: "info", label }] }));
    };

    const addThinkingDoc = (doc: { id: string; title: string | null; persona_id: string | null }) => {
      const id = crypto.randomUUID();
      updateThinking((m) => ({
        ...m,
        steps: [
          ...(m.steps ?? []),
          {
            id,
            type: "doc",
            label: doc.title?.trim() ? `Updated: ${doc.title.trim()}` : "Updated document",
            docId: doc.id,
            personaId: doc.persona_id ?? null,
          },
        ],
      }));
    };
    const finishThinking = () => {
      updateThinking((m) => ({ ...m, content: "Finished this reasoning round" }));
    };

    if (!token) {
      console.warn("[board] missing session token for chat", {
        timedOut: sessionTimedOut,
        online: typeof navigator !== "undefined" ? navigator.onLine : null,
        visibility: typeof document !== "undefined" ? document.visibilityState : null,
      });
      if (sessionTimedOut) {
        updateThinking((m) => ({ ...m, content: "会话获取超时，请稍后重试", kind: "status" }));
        setChatMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", content: "会话获取超时（你可能仍处于登录状态）。请稍后重试，或刷新页面。", kind: "normal" },
        ]);
        return;
      }
      updateThinking((m) => ({ ...m, content: "需要登录才能继续", kind: "status" }));
      setChatMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: "请先登录后再使用 Chat 功能。", kind: "normal" },
      ]);
      return;
    }

    const mode: BoardChatMode = pending.mode === "ask" ? "ask" : "create";
    const startedAt = Date.now();
    const stageDefs = mode === "ask" ? [{ atMs: 1800, label: "Thinking" }] : [
      { atMs: 1800, label: "Drafting changes" },
      { atMs: 3200, label: "Saving documents" },
    ];
    const addedStages = new Set<string>();
    const frames = ["Analyzing your instruction.", "Analyzing your instruction..", "Analyzing your instruction..."];
    let frameIndex = 0;
    const progressTimer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      for (const s of stageDefs) {
        if (elapsed >= s.atMs && !addedStages.has(s.label)) {
          addedStages.add(s.label);
          addThinkingInfo(s.label);
        }
      }
      frameIndex = (frameIndex + 1) % frames.length;
      updateThinking((m) => ({ ...m, content: frames[frameIndex] }));
    }, 700);
    timeoutId = setTimeout(() => {
      timeoutTriggered = true;
      abortController.abort();
    }, 120000);

    try {
      let currentChatId = boardChatIdRef.current;
      const currentUserId = userIdRef.current;
      if (!currentChatId && currentUserId) {
        try {
          const defaultTitle = `Board: ${pending.rawMessage.slice(0, 30) || "New Board Chat"}`;
          const { data: newChat, error: chatError } = await supabase
            .from("chats")
            .insert({
              user_id: currentUserId,
              title: defaultTitle,
            })
            .select()
            .single();
          if (!chatError && newChat && typeof newChat.id === "string") {
            currentChatId = newChat.id as string;
            setBoardChatId(currentChatId);
            chatHistory?.upsertChat({
              id: currentChatId,
              title: typeof (newChat as { title?: unknown }).title === "string" ? String((newChat as { title?: unknown }).title) : defaultTitle,
              created_at:
                typeof (newChat as { created_at?: unknown }).created_at === "string"
                  ? String((newChat as { created_at?: unknown }).created_at)
                  : new Date().toISOString(),
            });
          }
        } catch {
          currentChatId = null;
        }
      }

      if (currentChatId) {
        void (async () => {
          try {
            await supabase.from("messages").insert({
              id: pending.userMessageId,
              chat_id: currentChatId,
              role: "user",
              content: pending.rawMessage,
            });
          } catch {
            void 0;
          }
        })();
      }

      const useXhsSkill = pending.skillId === "xhs-batch";
      if (useXhsSkill) {
        addThinkingInfo("Calling Xiaohongshu image-post skill");
        const resSkill = await fetch("/api/skills/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-Id": requestId,
          },
          signal: abortController.signal,
          body: JSON.stringify({
            id: "xhs-batch",
            modelId: pending.modelId,
            input:
              pending.skillInput && typeof pending.skillInput === "object"
                ? pending.skillInput
                : { topic: pending.rawMessage },
          }),
        });
        const text = await resSkill.text().catch(() => "");
        clearInterval(progressTimer);

        if (!resSkill.ok) {
          let msg = text || "Chat service is temporarily unavailable.";
          try {
            const parsed = text ? (JSON.parse(text) as { error?: unknown }) : null;
            if (parsed && typeof parsed.error === "string" && parsed.error.trim()) {
              msg = parsed.error.trim();
            }
          } catch {
            msg = msg || "Chat service is temporarily unavailable.";
          }
          const labeled = withRequestId(msg);
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === pending.thinkingId
                ? {
                    ...m,
                    content: "Agent call failed",
                    steps: [
                      ...(m.steps ?? []),
                      {
                        id: crypto.randomUUID(),
                        type: "info",
                        label: labeled,
                      },
                    ],
                  }
                : m
            )
          );
          setChatMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: labeled,
              kind: "normal",
            },
          ]);
          return;
        }

        let output: unknown = null;
        try {
          const parsed = text ? (JSON.parse(text) as { output?: unknown }) : null;
          output = parsed && "output" in (parsed as object) ? (parsed as { output?: unknown }).output : null;
        } catch {
          output = null;
        }

        if (!output || typeof output !== "object") {
          const stepLabel = "Skill returned an invalid payload";
          const msg = "Skill 返回格式不正确";
          const stepLabelWithId = withRequestId(stepLabel);
          const msgWithId = withRequestId(msg);
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === pending.thinkingId
                ? {
                    ...m,
                    content: "Agent call failed",
                    steps: [
                      ...(m.steps ?? []),
                      {
                        id: crypto.randomUUID(),
                        type: "info",
                        label: stepLabelWithId,
                      },
                    ],
                  }
                : m
            )
          );
          setChatMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: msgWithId,
              kind: "normal",
            },
          ]);
          return;
        }

        const reply = formatXhsSkillReply(output as XhsBatchSkillOutput, pending.rawMessage);
        finishThinking();
        const assistantMessageId = crypto.randomUUID();

        try {
          const obj = output as { docs?: unknown; folder_id?: unknown };
          const docs = Array.isArray(obj?.docs)
            ? (obj!.docs as Array<{
                id?: unknown;
                title?: unknown;
                updated_at?: unknown;
                persona_id?: unknown;
                type?: unknown;
                content?: unknown;
              }>)
            : [];
          if (docs.length > 0) {
            const normalizedDocs = docs
              .map((d) => ({
                id: typeof d.id === "string" ? d.id : "",
                title: typeof d.title === "string" ? d.title : null,
                updated_at: typeof d.updated_at === "string" ? d.updated_at : null,
                persona_id: typeof d.persona_id === "string" ? d.persona_id : null,
                type: typeof d.type === "string" ? d.type : null,
                content: typeof d.content === "string" ? d.content : null,
              }))
              .filter((d) => d.id);
            if (normalizedDocs.length > 0) {
              setResources((prev) => {
                const existing = new Set(prev.map((r) => r.id));
                const merged = [...normalizedDocs.filter((d) => !existing.has(d.id)), ...prev];
                return merged;
              });
              const firstPost = normalizedDocs.find((d) => (d.type ?? "").toString().toLowerCase().startsWith("posts"));
              if (firstPost && firstPost.id) {
                setSelectedResourceId(firstPost.id);
                setLeftPaneMode("doc");
              }
            }
          }
        } catch {
          void 0;
        }

        if (currentChatId) {
          void (async () => {
            try {
              await supabase.from("messages").insert({
                id: assistantMessageId,
                chat_id: currentChatId,
                role: "assistant",
                content: reply,
              });
            } catch {
              void 0;
            }
          })();
        }

        setChatMessages((prev) => [
          ...prev,
          { id: assistantMessageId, role: "assistant", content: reply, kind: "normal" },
        ]);

        return;
      }

      if (mode === "ask") {
        addThinkingInfo("Calling chat completion");
        const resAsk = await fetch("/api/chat/complete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-Id": requestId,
          },
          signal: abortController.signal,
          body: JSON.stringify({
            messages: pending.history,
            modelId: pending.modelId,
          }),
        });
        const askText = await resAsk.text().catch(() => "");
        clearInterval(progressTimer);
        const askData = (() => {
          if (!askText.trim()) return null;
          try {
            return JSON.parse(askText) as unknown;
          } catch {
            return null;
          }
        })();

        if (!resAsk.ok) {
          let msg = askText || "Chat service is temporarily unavailable.";
          if (askData && typeof askData === "object" && askData && "error" in (askData as Record<string, unknown>)) {
            const err = (askData as Record<string, unknown>).error;
            if (typeof err === "string" && err.trim()) msg = err.trim();
          }
          const labeled = withRequestId(msg);
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === pending.thinkingId
                ? {
                    ...m,
                    content: "Agent call failed",
                    steps: [
                      ...(m.steps ?? []),
                      {
                        id: crypto.randomUUID(),
                        type: "info",
                        label: labeled,
                      },
                    ],
                  }
                : m
            )
          );
          setChatMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: labeled,
              kind: "normal",
            },
          ]);
          return;
        }

        const replyText = (() => {
          if (!askData || typeof askData !== "object") return "";
          const dataObj = askData as Record<string, unknown>;
          const choices = Array.isArray(dataObj.choices) ? (dataObj.choices as unknown[]) : [];
          const first = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>) : null;
          const msg = first && typeof first.message === "object" && first.message ? (first.message as Record<string, unknown>) : null;
          const content = msg?.content;
          if (typeof content === "string") return content;
          if (Array.isArray(content)) {
            const parts = content
              .map((p) => {
                const obj = p && typeof p === "object" ? (p as Record<string, unknown>) : null;
                const t = typeof obj?.text === "string" ? obj.text : "";
                return t.trim();
              })
              .filter(Boolean);
            return parts.join("\n");
          }
          return "";
        })();

        finishThinking();
        const parsedReply = parseBoardMessageContent(replyText);
        const finalReply =
          parsedReply.text && parsedReply.text.trim()
            ? parsedReply.text.trim()
            : "The agent did not return a visible reply.";
        const assistantMessageId = crypto.randomUUID();

        const tokensInAsk = estimateTokens(pending.requestMessage);
        const tokensOutAsk = estimateTokens(finalReply);
        const mergedMetaAsk: BoardAssistantMeta = {
          ...(parsedReply.meta ?? {}),
          model_id: pending.modelId,
          tokens_in: tokensInAsk,
          tokens_out: tokensOutAsk,
          tokens_total: tokensInAsk + tokensOutAsk,
        };
        const assistantDbContentAsk = buildBoardAssistantDbContent(finalReply, mergedMetaAsk);

        if (currentChatId) {
          void (async () => {
            try {
              await supabase.from("messages").insert({
                id: assistantMessageId,
                chat_id: currentChatId,
                role: "assistant",
                content: assistantDbContentAsk,
              });
            } catch {
              void 0;
            }
          })();
        }

        setChatMessages((prev) => [
          ...prev,
          {
            id: assistantMessageId,
            role: "assistant",
            content: finalReply,
            kind: "normal",
            steps: metaToChatSteps(assistantMessageId, mergedMetaAsk),
            meta: mergedMetaAsk,
          },
        ]);
        if (mergedMetaAsk.automation && mergedMetaAsk.automation.id && mergedMetaAsk.automation.auto_confirm && !mergedMetaAsk.automation.enabled) {
          setPendingAutomationConfirm({
            id: mergedMetaAsk.automation.id,
            confirmAt: mergedMetaAsk.automation.confirm_at ?? null,
            timeoutSeconds: mergedMetaAsk.automation.confirm_timeout_seconds ?? 10,
          });
        } else {
          setPendingAutomationConfirm(null);
        }

        return;
      }

      const res = await fetch("/api/board/chat2edit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-Id": requestId,
        },
        signal: abortController.signal,
        body: JSON.stringify({
          message: pending.requestMessage,
          history: pending.history,
          attachedResourceIds: pending.attachedResourceIds,
          modelId: pending.modelId,
          skillId: "chat2edit",
          defaultPersonaId: pending.defaultPersonaId,
          stream: true,
        }),
      });

      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();

      let streamingAssistantId: string | null = null;

      const applyFinal = async (data: {
        reply?: string;
        updated_docs?: {
          id: string;
          title: string | null;
          content: string | null;
          type: string | null;
          updated_at: string | null;
          persona_id: string | null;
        }[];
        changes?: {
          id: string;
          persona_id: string | null;
          title_before: string | null;
          title_after: string | null;
          content_before: string | null;
          content_after: string | null;
          type_before: string | null;
          type_after: string | null;
        }[];
        web_search_enabled?: boolean;
        web_search?: { query?: string; results?: unknown } | null;
        web_search_error?: string | null;
        error?: string;
      }) => {
        if (typeof data.error === "string" && data.error.trim()) {
          const errText = data.error!.trim();
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === pending.thinkingId
                ? {
                    ...m,
                    content: "Agent returned an error",
                    steps: [
                      ...(m.steps ?? []),
                      {
                        id: crypto.randomUUID(),
                        type: "info",
                        label: errText,
                      },
                    ],
                  }
                : m
            )
          );
          setChatMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "assistant", content: errText, kind: "normal" },
          ]);
          return;
        }

        finishThinking();
        const replyRaw = data.reply && data.reply.trim() ? data.reply.trim() : "The agent did not return a visible reply.";
        const parsedReply = parseBoardMessageContent(replyRaw);
        const replyText = parsedReply.text && parsedReply.text.trim() ? parsedReply.text.trim() : "The agent did not return a visible reply.";
        const assistantMessageId = streamingAssistantId ?? crypto.randomUUID();
        const updatedDocMetas: BoardAssistantDeliveryDoc[] = Array.isArray(data.updated_docs)
          ? data.updated_docs
              .map((d) => ({
                id: d.id,
                title: d.title ?? null,
                persona_id: d.persona_id ?? null,
                updated_at: d.updated_at ?? null,
                type: d.type ?? null,
              }))
              .filter((d) => Boolean(d.id))
          : [];
        if (Array.isArray(data.updated_docs) && data.updated_docs.length > 0) {
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === pending.thinkingId
                ? {
                    ...m,
                    content: "Finished this reasoning round",
                    steps: [
                      ...(m.steps ?? []),
                      {
                        id: crypto.randomUUID(),
                        type: "info",
                        label:
                          data.updated_docs!.length === 1
                            ? "Updated 1 document"
                            : `Updated ${data.updated_docs!.length} documents`,
                      },
                    ],
                  }
                : m
            )
          );
          const diffs: Record<string, { before: string; after: string }> = {};
          if (data.web_search_enabled) {
            const web = (data as { web_search?: { results?: unknown } | null }).web_search ?? null;
            const query = typeof (web as { query?: unknown } | null)?.query === "string" ? String((web as { query?: unknown }).query) : "";
            const results = Array.isArray(web?.results) ? web!.results : [];
            const count = results.length;
            const webError = typeof data.web_search_error === "string" ? data.web_search_error.trim() : "";
            if (query.trim()) addThinkingInfo("Web search started");
            if (webError) {
              addThinkingInfo(`Web search error: ${webError}`);
            } else {
              addThinkingInfo(count > 0 ? `Web search: ${count} results` : "Web search: 0 results");
              const topResults = results.slice(0, 3);
              for (let i = 0; i < topResults.length; i++) {
                const r = topResults[i];
                const obj = r && typeof r === "object" ? (r as Record<string, unknown>) : null;
                const title = typeof obj?.title === "string" ? obj.title.trim() : "";
                if (!title) continue;
                const prefix = i === 0 ? "Top source" : `Source ${i + 1}`;
                addThinkingInfo(`${prefix}: ${title}`);
              }
            }
          }
          for (const d of data.updated_docs) {
            if (d?.id) addThinkingDoc({ id: d.id, title: d.title ?? null, persona_id: d.persona_id ?? null });
          }
          if (Array.isArray(data.changes) && data.changes.length > 0) {
            for (const ch of data.changes) {
              const before = (ch.content_before ?? "").toString();
              const after = (ch.content_after ?? "").toString();
              if (before !== after) diffs[ch.id] = { before, after };
            }
          } else {
            for (const d of data.updated_docs) {
              const existing = resourcesRef.current.find((r) => r.id === d.id) ?? null;
              const before = ((existing?.content ?? "") || "").toString();
              const after = ((d.content ?? "") || "").toString();
              if (before !== after) diffs[d.id] = { before, after };
            }
          }
          const updatesById = new Map(
            data.updated_docs.map((d) => [
              d.id,
              {
                id: d.id,
                title: d.title,
                updated_at: d.updated_at,
                persona_id: d.persona_id,
                type: d.type,
                content: d.content ?? null,
              } as ResourceDoc,
            ])
          );
          setResources((prev) => {
            const next = prev.map((r) => {
              const u = updatesById.get(r.id);
              if (!u) return r;
              return {
                ...r,
                title: u.title ?? r.title,
                updated_at: u.updated_at ?? r.updated_at,
                type: u.type ?? r.type,
                content: u.content ?? r.content,
                persona_id: u.persona_id ?? r.persona_id,
              };
            });
            const existingIds = new Set(prev.map((r) => r.id));
            const newDocs = Array.isArray(data.updated_docs) ? data.updated_docs : [];
            for (const d of newDocs) {
              if (!d.id || existingIds.has(d.id)) continue;
              next.unshift({
                id: d.id,
                title: d.title,
                updated_at: d.updated_at,
                persona_id: d.persona_id,
                type: d.type ?? null,
                content: d.content ?? null,
              } as ResourceDoc);
            }
            return next;
          });
          if (Object.keys(diffs).length > 0) {
            setDocDiffs((prev) => ({ ...prev, ...diffs }));
          }
          const first = data.updated_docs[0];
          if (first && first.id) {
            setSelectedResourceId(first.id);
            setLeftPaneMode("doc");
          }
        }

        const thinkingMessage = chatMessagesRef.current.find((m) => m.id === pending.thinkingId) ?? null;
        const thinkingSteps =
          thinkingMessage?.steps?.filter((s) => s.type === "info").map((s) => ({ label: s.label })) ?? [];
        const tokensIn = estimateTokens(pending.requestMessage);
        const tokensOut = estimateTokens(replyText);
        const mergedMeta: BoardAssistantMeta = {
          ...(parsedReply.meta ?? {}),
          updated_docs: updatedDocMetas,
          thinking_steps: thinkingSteps,
          model_id: pending.modelId,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          tokens_total: tokensIn + tokensOut,
        };
        const assistantDbContent = buildBoardAssistantDbContent(replyText, mergedMeta);

        if (currentChatId) {
          void (async () => {
            try {
              await supabase.from("messages").insert({
                id: assistantMessageId,
                chat_id: currentChatId,
                role: "assistant",
                content: assistantDbContent,
              });
            } catch {
              void 0;
            }
          })();
        }

        if (mergedMeta.automation && mergedMeta.automation.id && mergedMeta.automation.auto_confirm && !mergedMeta.automation.enabled) {
          setPendingAutomationConfirm({
            id: mergedMeta.automation.id,
            confirmAt: mergedMeta.automation.confirm_at ?? null,
            timeoutSeconds: mergedMeta.automation.confirm_timeout_seconds ?? 10,
          });
        } else {
          setPendingAutomationConfirm(null);
        }

        if (streamingAssistantId) {
          const steps = metaToChatSteps(assistantMessageId, mergedMeta);
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessageId ? { ...m, content: replyText, steps, meta: mergedMeta } : m
            )
          );
        } else {
          const steps = metaToChatSteps(assistantMessageId, mergedMeta);
          setChatMessages((prev) => [
            ...prev,
            { id: assistantMessageId, role: "assistant", content: replyText, kind: "normal", steps, meta: mergedMeta },
          ]);
        }
      };

      if (res.ok && contentType.includes("text/event-stream") && res.body) {
        const decoder = new TextDecoder();
        const reader = res.body.getReader();
        const assistantId = crypto.randomUUID();
        streamingAssistantId = assistantId;
        let assistantText = "";
        const delimiter = "\n---JSON---\n";
        let stopped = false;
        let buffer = "";
        let finalData: unknown = null;

        setChatMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", kind: "normal" }]);

        const setAssistant = (text: string) => {
          setChatMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: text } : m)));
        };

        const applyStatus = (payload: unknown) => {
          if (!payload || typeof payload !== "object") return;
          const label = (payload as { label?: unknown }).label;
          if (typeof label === "string" && label.trim()) addThinkingInfo(label.trim());
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let splitIndex = buffer.indexOf("\n\n");
          while (splitIndex >= 0) {
            const packet = buffer.slice(0, splitIndex);
            buffer = buffer.slice(splitIndex + 2);
            splitIndex = buffer.indexOf("\n\n");

            const lines = packet.split("\n");
            let event = "";
            const dataLines: string[] = [];
            for (const line of lines) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
            }
            const dataStr = dataLines.join("\n");
            if (event === "delta") {
              if (!stopped) {
                assistantText += dataStr;
                const idx = assistantText.indexOf(delimiter);
                if (idx >= 0) {
                  assistantText = assistantText.slice(0, idx);
                  stopped = true;
                }
                setAssistant(assistantText);
              }
              continue;
            }
            if (event === "status") {
              const parsed = (() => {
                try {
                  return JSON.parse(dataStr);
                } catch {
                  return null;
                }
              })();
              applyStatus(parsed);
              continue;
            }
            if (event === "final") {
              finalData = (() => {
                try {
                  return JSON.parse(dataStr);
                } catch {
                  return null;
                }
              })();
              continue;
            }
            if (event === "error") {
              const parsed = (() => {
                try {
                  return JSON.parse(dataStr) as { error?: unknown };
                } catch {
                  return null;
                }
              })();
              const msg =
                parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string"
                  ? String((parsed as { error?: unknown }).error).trim()
                  : dataStr.trim();

              clearInterval(progressTimer);
              const safeMsg = msg || "Streaming error";
              const labeled = withRequestId(safeMsg);
              setChatMessages((prev) =>
                prev.map((m) =>
                  m.id === pending.thinkingId
                    ? {
                        ...m,
                        content: "Agent call failed",
                        steps: [
                          ...(m.steps ?? []),
                          {
                            id: crypto.randomUUID(),
                            type: "info",
                            label: labeled,
                          },
                        ],
                      }
                    : m
                )
              );
              setChatMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: labeled } : m))
              );
              return;
            }
          }
        }

        clearInterval(progressTimer);

        if (finalData && typeof finalData === "object") {
          await applyFinal(finalData as Parameters<typeof applyFinal>[0]);
          return;
        }

        finishThinking();
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: assistantText || "The agent did not return a visible reply." }
              : m
          )
        );
        return;
      }

      clearInterval(progressTimer);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const msg = text || "Chat service is temporarily unavailable.";
        const labeled = withRequestId(msg);
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === pending.thinkingId
              ? {
                  ...m,
                  content: "Agent call failed",
                  steps: [
                    ...(m.steps ?? []),
                    {
                      id: crypto.randomUUID(),
                      type: "info",
                      label: msg,
                    },
                  ],
                }
              : m
          )
        );
        setChatMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: labeled,
            kind: "normal",
          },
        ]);
        return;
      }

      const data = (await res.json()) as Parameters<typeof applyFinal>[0];

      if (typeof data.error === "string" && data.error.trim()) {
        const errText = data.error!.trim();
        const labeled = withRequestId(errText);
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === pending.thinkingId
              ? {
                  ...m,
                  content: "Agent returned an error",
                  steps: [
                    ...(m.steps ?? []),
                    {
                      id: crypto.randomUUID(),
                      type: "info",
                      label: labeled,
                    },
                  ],
                }
              : m
          )
        );
        setChatMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", content: labeled, kind: "normal" },
        ]);
        return;
      }

      await applyFinal(data);
    } catch (err) {
      clearInterval(progressTimer);
      const isAbort =
        stopAllRef.current ||
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError");
      if (isAbort) {
        if (timeoutTriggered) {
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === pending.thinkingId
                ? {
                    ...m,
                    content: "请求超时",
                    steps: [
                      ...(m.steps ?? []),
                      { id: crypto.randomUUID(), type: "info", label: "请求超时" },
                    ],
                  }
                : m
            )
          );
          setChatMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "请求超时，请稍后重试。",
              kind: "normal",
            },
          ]);
          return;
        }
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === pending.thinkingId
              ? {
                  ...m,
                  content: "已停止生成",
                  steps: [
                    ...(m.steps ?? []),
                    { id: crypto.randomUUID(), type: "info", label: "已停止" },
                  ],
                }
              : m
          )
        );
        return;
      }

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
      const labeled = withRequestId(msg);
      console.error("[board chat] send failed", pending.id, msg, err);
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === pending.thinkingId
            ? {
                ...m,
                content: "Agent call failed",
                steps: [
                  ...(m.steps ?? []),
                  { id: crypto.randomUUID(), type: "info", label: labeled },
                ],
              }
            : m
        )
      );
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: msg ? `调用智能体服务时发生错误：${labeled}` : `调用智能体服务时发生错误，请稍后重试。（Request ID: ${requestId}）`,
          kind: "normal",
        },
      ]);
    } finally {
      if (chatAbortControllerRef.current === abortController) {
        chatAbortControllerRef.current = null;
      }
      if (timeoutId) clearTimeout(timeoutId);
    }
  }, [chatHistory]);

  const drainChatSendQueue = useCallback(async () => {
    if (chatSendInFlightRef.current) return;
    chatSendInFlightRef.current = true;
    setChatSending(true);
    try {
      while (chatSendQueueRef.current.length > 0) {
        if (stopAllRef.current) {
          chatSendQueueRef.current = [];
          break;
        }
        const next = chatSendQueueRef.current.shift();
        if (!next) continue;
        await sendPendingChat(next);
      }
    } finally {
      chatSendInFlightRef.current = false;
      stopAllRef.current = false;
      setChatSending(false);
      if (chatSendQueueRef.current.length > 0) void drainChatSendQueue();
    }
  }, [sendPendingChat]);

  const startChatRound = useCallback(
    (args: { baseMessage: string; requestBase: string; attachedIds: string[]; attachedPathRefs: string[] }) => {
      const { baseMessage, requestBase, attachedIds, attachedPathRefs } = args;
      const pendingConfirm = pendingAutomationConfirmRef.current;
      const wantsCancel =
        /^(取消|停止|终止)\b/.test(baseMessage.trim()) || baseMessage.includes("取消自动化") || baseMessage.includes("取消创建");
      if (pendingConfirm && wantsCancel) {
        void cancelAutomation(pendingConfirm.id);
        setPendingAutomationConfirm(null);
      }
      const userMessage: BoardChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: baseMessage,
        kind: "normal",
        attachedResourceIds: attachedIds,
        attachedPathRefs,
      };
      ensureRevertSnapshot(userMessage.id);
      const thinkingId = crypto.randomUUID();
      const initialSteps: ChatToolStep[] = [];
      if (attachedIds.length > 0) {
        initialSteps.push({
          id: crypto.randomUUID(),
          type: "info",
          label:
            attachedIds.length === 1 ? "Reading attached document" : `Reading ${attachedIds.length} attached documents`,
        });
      }
      if (attachedPathRefs.length > 0) {
        initialSteps.push({
          id: crypto.randomUUID(),
          type: "info",
          label:
            attachedPathRefs.length === 1 ? "Reading attached path" : `Reading ${attachedPathRefs.length} paths`,
        });
      }
      initialSteps.push({ id: crypto.randomUUID(), type: "info", label: "Planning edits" });
      const thinkingMessage: BoardChatMessage = {
        id: thinkingId,
        role: "assistant",
        content: "Analyzing your instruction...",
        kind: "status",
        steps: initialSteps,
        meta: {
          task_plan: [
            { title: "理解需求与约束", status: "in_progress" },
            { title: "制定执行步骤", status: "pending" },
            { title: "执行并反馈结果", status: "pending" },
          ],
        },
      };
      setChatMessages((prev) => [...prev, userMessage, thinkingMessage]);
      setMessage("");
      setAttachedResourceIds([]);
      setAttachedPathRefs([]);

      const normalized = baseMessage;
      const wantsAutomationAsk =
        chatMode === "create" &&
        (normalized.includes("自动化") ||
          normalized.includes("定时") ||
          normalized.includes("每天") ||
          normalized.includes("每周") ||
          normalized.includes("每日") ||
          normalized.includes("早报") ||
          normalized.includes("日报") ||
          /每天\s*(早上|上午|中午|下午|晚上|夜里|凌晨)?\s*\d{1,2}\s*(?:点|时)(?:\s*\d{1,2}\s*分?)?/.test(normalized));
      const effectiveChatMode: BoardChatMode = wantsAutomationAsk ? "ask" : chatMode;

      const modelConfig =
        effectiveChatMode === "ask"
          ? (MODELS.find((m) => m.id === askDefaultModelId) ?? MODELS[0])
          : (enabledModels.find((m) => m.id === selectedModel) ?? MODELS[0]);
      const history = [
        ...chatMessages
          .filter((m) => m.kind !== "status")
          .map((m) => ({
            role: m.role,
            content: m.role === "user" ? withPathRefs(m.content, m.attachedPathRefs) : m.content,
          })),
        { role: "user" as const, content: withPathRefs(requestBase, attachedPathRefs) },
      ];

      const useXhsSkill =
        effectiveChatMode === "create" &&
        (normalized.includes("小红书图文") ||
          normalized.includes("小红书") ||
          normalized.includes("图文") ||
          normalized.includes("笔记") ||
          normalized.includes("封面"));
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
      const requestedPages = useXhsSkill ? parseXhsRequestedCount(normalized) : null;
      const skillId = useXhsSkill ? "xhs-batch" : null;
      const skillInput = useXhsSkill
        ? {
            topic: normalized,
            ...(requestedPages ? { pages: requestedPages } : {}),
          }
        : null;

      chatSendQueueRef.current.push({
        id: crypto.randomUUID(),
        userId,
        mode: effectiveChatMode,
        userMessageId: userMessage.id,
        thinkingId,
        rawMessage: baseMessage,
        requestMessage: withPathRefs(requestBase, attachedPathRefs),
        attachedResourceIds: attachedIds,
        attachedPathRefs,
        history,
        modelId: modelConfig.id,
        defaultPersonaId: personaIds.length > 0 ? personaIds[0] : null,
        skillId,
        skillInput,
      });
      void drainChatSendQueue();
    },
    [
      ensureRevertSnapshot,
      setChatMessages,
      setMessage,
      setAttachedResourceIds,
      setAttachedPathRefs,
      enabledModels,
      selectedModel,
      chatMessages,
      withPathRefs,
      chatMode,
      userId,
      personaIds,
      drainChatSendQueue,
    ]
  );

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    const next = message.trim();
    if (!next) return;

    let requestBase = next;
    if (quickAction === "Design Image") {
      requestBase = `${next}\n\n(User clicked “Design Image” and wants an image generated for the content above.)`;
      setQuickAction(null);
    }

    const attachedIdsSnapshot = [...attachedResourceIds];
    const attachedPathRefsSnapshot = [...attachedPathRefs];
    startChatRound({
      baseMessage: next,
      requestBase,
      attachedIds: attachedIdsSnapshot,
      attachedPathRefs: attachedPathRefsSnapshot,
    });
  };

  const resourcesArray = resources;
  const selectedMeta = selectedResourceId ? (resourcesArray.find((r) => r.id === selectedResourceId) ?? null) : null;
  const selectedPersonaId = ((selectedMeta ? selectedMeta.persona_id : selectedResourcePersonaIdHint) ?? null) as string | null;
  const selectedDiff = selectedResourceId ? docDiffs[selectedResourceId] ?? null : null;
  const selectedCount = selectedIds.size;
  const allSelected = resourcesArray.length > 0 && selectedCount === resourcesArray.length;

  const sidePeekActive = Boolean(sidePeekHref);
  const lastAssistantMessageId = (() => {
    for (let i = chatMessages.length - 1; i >= 0; i -= 1) {
      const m = chatMessages[i];
      if (m && m.kind !== "status" && m.role === "assistant") return m.id;
    }
    return null;
  })();
  const latestTaskPlan = (() => {
    for (let i = chatMessages.length - 1; i >= 0; i -= 1) {
      const m = chatMessages[i];
      if (!m || m.role !== "assistant") continue;
      const plan = m.meta?.task_plan;
      if (plan && plan.length > 0) return plan;
    }
    return null;
  })();

  const retryLastAssistantMessage = useCallback(async () => {
    console.log("[board] retryLastAssistantMessage clicked");
    const list = chatMessagesRef.current;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const m = list[i];
      if (m && m.kind !== "status" && m.role === "assistant") {
        const restore = await undoChatRound(m.id, { revertDocs: true });
        if (!restore) {
          console.warn("[board] retryLastAssistantMessage: undoChatRound returned null", { messageId: m.id });
          setChatMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "Retry 失败：找不到上一轮用户消息，已取消重试。",
              kind: "normal",
            },
          ]);
          return;
        }
        const base = restore.message.trim();
        if (!base) {
          console.warn("[board] retryLastAssistantMessage: empty restored message", { messageId: m.id });
          setChatMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "Retry 失败：上一轮用户消息为空，已取消重试。",
              kind: "normal",
            },
          ]);
          return;
        }
        let requestBase = base;
        if (quickAction === "Design Image") {
          requestBase = `${base}\n\n(User clicked “Design Image” and wants an image generated for the content above.)`;
          setQuickAction(null);
        }
        startChatRound({
          baseMessage: base,
          requestBase,
          attachedIds: restore.attachedResourceIds,
          attachedPathRefs: restore.attachedPathRefs,
        });
        return;
      }
    }
    console.warn("[board] retryLastAssistantMessage: no assistant message found");
    setChatMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Retry 失败：未找到可重试的助手回复。",
        kind: "normal",
      },
    ]);
  }, [undoChatRound, quickAction, startChatRound, setQuickAction]);

  return (
    <div
      ref={containerRef}
      className="flex h-dvh min-w-0 flex-col overflow-hidden bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50 lg:flex-row"
    >
      {dividerTip.visible && (
        <div
          style={{ left: dividerTip.x, top: dividerTip.y }}
          className="fixed z-50 pointer-events-none whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs text-white"
        >
          Drag to resize
        </div>
      )}
      {hoverTip.visible && (
        <div
          style={{ left: hoverTip.x, top: hoverTip.y }}
          className="fixed z-50 pointer-events-none whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs text-white -translate-x-1/2"
        >
          {hoverTip.text}
        </div>
      )}
      <div
        style={isDesktop && !sidePeekActive ? { width: `${splitPercent}%` } : undefined}
        className="flex min-w-0 flex-col bg-white p-6 dark:bg-zinc-900 lg:min-w-[320px] h-full min-h-0"
      >
        {leftPaneMode === "doc" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between px-4 py-3">
              <button
                type="button"
                onClick={() => setLeftPaneMode("resources")}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="w-9" />
            </div>
            <div className="min-h-0 flex-1">
              {selectedResourceId ? (
                <DocEditor
                  key={selectedResourceId}
                  personaId={selectedPersonaId}
                  docId={selectedResourceId}
                  diffBefore={selectedDiff?.before ?? null}
                  diffAfter={selectedDiff?.after ?? null}
                  onDiffResolved={() => {
                    if (!selectedResourceId) return;
                    setDocDiffs((prev) => {
                      if (!prev[selectedResourceId]) return prev;
                      const next = { ...prev };
                      delete next[selectedResourceId];
                      return next;
                    });
                  }}
                  onDocUpdate={(doc) => {
                    setResources((prev) =>
                      prev.map((r) =>
                        r.id === doc.id
                          ? { ...r, title: doc.title, updated_at: doc.updated_at, type: doc.type, content: doc.content }
                          : r
                      )
                    );
                  }}
                />
              ) : (
                <div className="p-6 text-sm text-zinc-500 dark:text-zinc-400">
                  选择一个资源开始编辑。
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-start gap-2 -mt-2">
                <h2 className="text-lg font-bold leading-none truncate max-w-[400px]">Resources</h2>
                {isSyncing && <span className="text-xs font-medium text-zinc-400">Syncing…</span>}
                <Select value={resourceTypeFilter} onValueChange={(value) => setResourceTypeFilter(value as ResourceTypeFilter)}>
                  <SelectTrigger className="h-7 w-auto gap-1 -mt-1 rounded-lg border border-zinc-200 bg-white px-2 text-xs font-medium leading-none text-zinc-700 shadow-sm hover:bg-zinc-50 focus:ring-0 focus:ring-offset-0 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                    {Object.entries(RESOURCE_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem
                        key={value}
                        value={value}
                        className="mb-0.5 rounded-md py-1.5 pl-7 pr-2 text-xs font-medium text-zinc-700 data-[state=checked]:bg-zinc-100 focus:bg-zinc-100 focus:text-zinc-900 dark:text-zinc-200 dark:data-[state=checked]:bg-zinc-800 dark:focus:bg-zinc-800 dark:focus:text-zinc-50 last:mb-0"
                      >
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-start gap-2">
                <div className="flex items-center rounded-lg border border-white/30 bg-white/55 p-1 shadow-sm ring-1 ring-zinc-200/40 backdrop-blur-md dark:border-white/10 dark:bg-zinc-900/35 dark:ring-white/5">
                  <button
                    type="button"
                    onClick={() => setResourceViewMode("grid")}
                    onMouseEnter={(e) => showHoverTip("Panel View", e)}
                    onMouseLeave={hideHoverTip}
                    className={`rounded p-1 ${resourceViewMode === "grid" ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setResourceViewMode("list")}
                    onMouseEnter={(e) => showHoverTip("List View", e)}
                    onMouseLeave={hideHoverTip}
                    className={`rounded p-1 ${resourceViewMode === "list" ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}
                  >
                    <List className="h-4 w-4" />
                  </button>
                </div>
                {selectMode && (
                  <label className="flex items-center gap-2 rounded-lg bg-white/55 px-2 py-1 text-sm text-zinc-700 shadow-sm ring-1 ring-zinc-200/40 backdrop-blur-md dark:bg-zinc-900/35 dark:text-zinc-200 dark:ring-white/5">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => {
                        if (allSelected) {
                          clearSelection();
                          return;
                        }
                        setSelectedIds(new Set(resourcesArray.map((r) => r.id)));
                      }}
                      className="h-4 w-4 accent-zinc-900"
                    />
                    <span className="whitespace-nowrap font-medium">All</span>
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (selectMode) {
                      setSelectMode(false);
                      clearSelection();
                      return;
                    }
                    setLeftPaneMode("resources");
                    setSelectMode(true);
                    clearSelection();
                  }}
                  className="rounded-full p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                  aria-label={selectMode ? "Exit selection" : "Select"}
                  aria-pressed={selectMode}
                  onMouseEnter={(e) => showHoverTip(selectMode ? "Exit selection" : "Select", e)}
                  onMouseMove={(e) => showHoverTip(selectMode ? "Exit selection" : "Select", e)}
                  onMouseLeave={hideHoverTip}
                >
                  <CheckSquare className="h-5 w-5" />
                </button>
                <div className="relative flex flex-col items-center">
                  <button
                    ref={createResourceButtonRef}
                    type="button"
                    className="rounded-full p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                    aria-label="New document"
                    aria-expanded={createResourceMenuOpen}
                    aria-haspopup="menu"
                    onMouseEnter={(e) => showHoverTip("new document", e)}
                    onMouseMove={(e) => showHoverTip("new document", e)}
                    onMouseLeave={hideHoverTip}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setCreateResourceMenuOpen((v) => !v);
                    }}
                  >
                    <PlusCircle className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setResourceSearchOpen(true)}
                    className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/30 bg-white/55 shadow-sm ring-1 ring-zinc-200/40 backdrop-blur-md hover:bg-white/65 dark:border-white/10 dark:bg-zinc-900/35 dark:ring-white/5 dark:hover:bg-zinc-900/45"
                    aria-label="Search resources"
                  >
                    <Search className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
                  </button>
                  {createResourceMenuOpen && (
                    <div
                      ref={createResourceMenuRef}
                      className="absolute right-0 top-10 z-30 w-56 rounded-2xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
                      role="menu"
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
                        role="menuitem"
                        onClick={() => {
                          setCreateResourceMenuOpen(false);
                          void createPrivateResource("doc");
                        }}
                      >
                        <PenLine className="h-4 w-4" />
                        <span>New Doc</span>
                      </button>
                      <button
                        type="button"
                        className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
                        role="menuitem"
                        onClick={() => {
                          setCreateResourceMenuOpen(false);
                          void createPrivateResource("posts");
                        }}
                      >
                        <PenLine className="h-4 w-4" />
                        <span>New Post</span>
                      </button>
                      <button
                        type="button"
                        className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
                        role="menuitem"
                        onClick={() => {
                          setCreateResourceMenuOpen(false);
                          router.push("/persona/create");
                        }}
                      >
                        <Users className="h-4 w-4" />
                        <span>New Persona</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>


            <div ref={resourcesScrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {resourcesLoading && <div className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</div>}

              {!resourcesLoading && resources.length === 0 && <div className="text-sm text-zinc-500 dark:text-zinc-400">No resources yet.</div>}

              {!resourcesLoading && resources.length > 0 && resourceViewMode === "grid" && filteredGridResources.length === 0 && (
                <div className="px-2 py-4 text-sm text-zinc-500 dark:text-zinc-400">No items.</div>
              )}

              {!resourcesLoading && resources.length > 0 && resourceViewMode === "grid" && filteredGridResources.length > 0 && (
                <div className="grid grid-cols-3 gap-4">
                  {filteredGridResources.map((r) =>
                    (() => {
                      const rawType = (r.type ?? "").toString();
                      const baseType = rawType.split(/[;:#|]/)[0] ?? "";
                      const metaParts = rawType.split(";");
                      const meta: Record<string, string> = {};
                      for (const part of metaParts.slice(1)) {
                        const [k, v] = part.split("=");
                        if (!k) continue;
                        meta[k] = (v ?? "").toString();
                      }
                      const personaId = (r.persona_id ?? "").toString();
                      const cleanId = getCleanDocId(r.id, personaId);
                      const isFolder =
                        baseType === "persona" && (((meta.folder ?? "").trim() === "1") || cleanId.startsWith("folder-"));
                      const routePersonaId = getRoutePersonaId(personaId);
                      const resourceKind = getResourceKind(rawType);
                      const isAlbum = resourceKind === "album" || resourceKind === "photo";
                      const isPost = resourceKind === "post";
                      const isVisible = visibleIds.has(r.id);
                      const media = isAlbum && isVisible && r.content ? extractMediaItems(r.content).slice(0, 4) : [];
                      const isSelected = selectedIds.has(r.id);
                      const typeBadge = resolveResourceBadge(rawType, isFolder);
                      const postText = isPost && isVisible ? extractPostText(r.content).slice(0, 96) : "";
                      const excerpt =
                        !isAlbum && isVisible && r.content
                          ? (postText || stripHtmlToText(r.content).slice(0, 72))
                          : "";
                      const handleActivate = () => {
                        if (selectMode) {
                          toggleSelectId(r.id);
                          return;
                        }
                        if (isFolder) {
                          setListFolderId(r.id);
                          setResourceViewMode("list");
                          return;
                        }
                        setSelectedResourcePersonaIdHint(null);
                        setSelectedResourceId(r.id);
                        setLeftPaneMode("doc");
                      };

                      return (
                        <div
                          key={r.id}
                          draggable={!selectMode}
                          onDragStart={(e) => {
                            e.dataTransfer.setData("application/x-board-resource-id", r.id);
                            e.dataTransfer.setData("text/plain", r.id);
                            e.dataTransfer.effectAllowed = "copy";
                            setDragSource("internal");
                          }}
                          onDragEnd={() => {
                            setDragSource(null);
                            setDragOverInput(false);
                            inputDragDepthRef.current = 0;
                          }}
                          onClick={handleActivate}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleActivate();
                            }
                          }}
                          ref={(el) => observeItem(el, r.id)}
                          role="button"
                          tabIndex={0}
                          className={`group relative flex h-[140px] flex-col justify-between rounded-2xl border bg-white p-4 text-left shadow-[0_10px_20px_rgba(0,0,0,0.06)] transition-shadow hover:shadow-[0_10px_20px_rgba(0,0,0,0.08)] dark:bg-zinc-900 ${
                            isSelected ? "border-zinc-500" : "border-zinc-100 dark:border-zinc-800"
                          }`}
                        >
                          <div>
                            <h3 className="truncate font-medium text-zinc-800 dark:text-zinc-100">{(r.title ?? "").trim() || "Untitled"}</h3>
                            <div className="mt-2 h-px w-full bg-zinc-100 dark:bg-zinc-800" />
                            {isAlbum && (
                              <div className="mt-3 grid grid-cols-4 gap-1">
                                {media.length === 0 && <div className="col-span-4 text-xs text-zinc-400">No media preview</div>}
                                {media.map((item, idx) => (
                                  <div
                                    key={`${item.kind}:${idx}`}
                                    className="relative aspect-square overflow-hidden rounded-md border border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
                                  >
                                    {item.kind === "image" ? (
                                      <img src={item.src} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                      <video src={item.src} className="h-full w-full object-cover" muted playsInline />
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {!isAlbum && excerpt && <div className="mt-2 text-sm text-zinc-500 line-clamp-2 dark:text-zinc-400">{excerpt}</div>}
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs text-zinc-400 dark:text-zinc-500">
                              {formatRelativeTime(r.updated_at)}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${typeBadge.badge}`}
                            >
                              <typeBadge.Icon className={`h-3.5 w-3.5 ${typeBadge.tone}`} />
                              <span>{typeBadge.label}</span>
                            </span>
                          </div>
                          <button
                            type="button"
                            draggable={false}
                            onPointerDown={stopEvent}
                            onMouseDown={stopEvent}
                            onDragStart={stopEvent}
                            onClick={(e) => {
                              stopEvent(e);
                              void handleDeleteIds([r.id]);
                            }}
                            className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 opacity-0 transition-opacity hover:bg-zinc-200 group-hover:opacity-100 dark:bg-zinc-800/80 dark:text-zinc-200 dark:hover:bg-zinc-700/80"
                            aria-label="Move to trash"
                            title="Move to trash"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })()
                  )}
                </div>
              )}

              {!resourcesLoading && resources.length > 0 && resourceViewMode === "list" && (
                <div className="flex flex-col gap-2">
                  {listHierarchy.currentFolder && (
                    <div className="mb-1 flex items-center justify-between px-1">
                      <button
                        type="button"
                        onClick={() => setListFolderId(listHierarchy.parentFolderId)}
                        className="inline-flex items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Back
                      </button>
                      <div className="min-w-0 px-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                        <span className="block truncate">{listHierarchy.currentFolderTitle}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setListFolderId(null)}
                        className="text-sm font-medium text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                      >
                        Root
                      </button>
                    </div>
                  )}

                  {filteredListResources.length === 0 && (
                    <div className="px-2 py-4 text-sm text-zinc-500 dark:text-zinc-400">No items.</div>
                  )}

                  {filteredListResources.map((r) => {
                    const rawType = (r.type ?? "").toString();
                    const baseType = rawType.split(/[;:#|]/)[0] ?? "";
                    const metaParts = rawType.split(";");
                    const meta: Record<string, string> = {};
                    for (const part of metaParts.slice(1)) {
                      const [k, v] = part.split("=");
                      if (!k) continue;
                      meta[k] = (v ?? "").toString();
                    }
                    const personaId = (r.persona_id ?? "").toString();
                    const cleanId = getCleanDocId(r.id, personaId);
                    const isFolder = baseType === "persona" && (((meta.folder ?? "").trim() === "1") || cleanId.startsWith("folder-"));
                    const routePersonaId = getRoutePersonaId(personaId);
                    const typeBadge = resolveResourceBadge(rawType, isFolder);

                    const handleActivate = () => {
                      if (selectMode) {
                        toggleSelectId(r.id);
                        return;
                      }
                      if (isFolder) {
                        setListFolderId(r.id);
                        return;
                      }
                      setSelectedResourcePersonaIdHint(null);
                      setSelectedResourceId(r.id);
                      setLeftPaneMode("doc");
                    };

                    return (
                      <div
                        key={r.id}
                        draggable={!selectMode}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/x-board-resource-id", r.id);
                          e.dataTransfer.setData("text/plain", r.id);
                          e.dataTransfer.effectAllowed = "copy";
                          setDragSource("internal");
                        }}
                        onDragEnd={() => {
                          setDragSource(null);
                          setDragOverInput(false);
                          inputDragDepthRef.current = 0;
                        }}
                        onClick={handleActivate}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleActivate();
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        className={`group flex items-center gap-3 rounded-2xl border bg-white px-3 py-2 text-left text-sm shadow-[0_10px_20px_rgba(0,0,0,0.06)] transition-colors hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-900/60 ${
                          selectedIds.has(r.id) || selectedResourceId === r.id
                            ? "border-zinc-500"
                            : "border-zinc-100 dark:border-zinc-800"
                        }`}
                      >
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${typeBadge.badge}`}
                        >
                          <typeBadge.Icon className={`h-3.5 w-3.5 ${typeBadge.tone}`} />
                          <span>{typeBadge.label}</span>
                        </span>
                        <span className="flex-1 truncate text-zinc-700 dark:text-zinc-200">{(r.title ?? "").trim() || "Untitled"}</span>
                        <span className="shrink-0 text-xs text-zinc-400">{formatRelativeTime(r.updated_at)}</span>
                        <span className="ml-1 inline-flex">
                          <button
                            type="button"
                            draggable={false}
                            onPointerDown={stopEvent}
                            onMouseDown={stopEvent}
                            onDragStart={stopEvent}
                            onClick={(e) => {
                              stopEvent(e);
                              void handleDeleteIds([r.id]);
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 opacity-0 transition-opacity hover:bg-zinc-200 group-hover:opacity-100 dark:bg-zinc-800/80 dark:text-zinc-200 dark:hover:bg-zinc-700/80"
                            aria-label="Move to trash"
                            title="Move to trash"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {selectMode && (
              <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/30 bg-white/55 px-4 py-3 shadow-[0_10px_20px_rgba(0,0,0,0.06)] ring-1 ring-zinc-200/40 backdrop-blur-md dark:border-white/10 dark:bg-zinc-900/35 dark:ring-white/5">
                <div className="text-sm text-zinc-600 dark:text-zinc-300">{selectedCount} selected</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={selectedCount === 0}
                    onClick={() => {
                      handleAddIdsToChat(Array.from(selectedIds));
                      setSelectMode(false);
                      clearSelection();
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add to chat</span>
                  </button>
                  <button
                    type="button"
                    disabled={selectedCount === 0}
                    onClick={() => void handleMoveIds(Array.from(selectedIds))}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                  >
                    <Move className="h-4 w-4" />
                    <span>Move</span>
                  </button>
                  <button
                    type="button"
                    disabled={selectedCount === 0}
                    onClick={() => {
                      void handleDeleteIds(Array.from(selectedIds));
                      setSelectMode(false);
                      clearSelection();
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-red-600 disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            )}

            {resourceSearchOpen &&
              typeof document !== "undefined" &&
              createPortal(
                <div
                  className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/30 p-6"
                  onClick={() => setResourceSearchOpen(false)}
                >
                  <div
                    className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_24px_60px_-12px_rgba(0,0,0,0.25)] ring-1 ring-zinc-200 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6)] dark:ring-zinc-800"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                      <Search className="h-4 w-4 text-zinc-400" />
                      <input
                        ref={resourceSearchInputRef}
                        value={resourceSearchQuery}
                        onChange={(e) => setResourceSearchQuery(e.target.value)}
                        placeholder="搜索资源..."
                        className="flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
                      />
                      <button
                        type="button"
                        onClick={() => setResourceSearchOpen(false)}
                        className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        aria-label="Close search"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="max-h-[60vh] overflow-y-auto">
                      {resourceSearchResults.length === 0 ? (
                        <div className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">No results.</div>
                      ) : (
                        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                          {resourceSearchResults.map((r) => {
                            const rawType = (r.type ?? "").toString();
                            const { meta } = parseTypeMeta(rawType);
                            const personaId = (r.persona_id ?? "").toString();
                            const cleanId = getCleanDocId(r.id, personaId);
                            const baseType = getBaseType(rawType);
                            const isFolder =
                              baseType === "persona" &&
                              (((meta.folder ?? "").trim() === "1") || cleanId.startsWith("folder-"));
                            const typeBadge = resolveResourceBadge(rawType, isFolder);
                            return (
                              <button
                                key={r.id}
                                type="button"
                                onClick={() => {
                                  setSelectMode(false);
                                  clearSelection();
                                  if (isFolder) {
                                    setResourceViewMode("list");
                                    setListFolderId(r.id);
                                    setLeftPaneMode("resources");
                                  } else {
                                    setSelectedResourcePersonaIdHint(null);
                                    setSelectedResourceId(r.id);
                                    setLeftPaneMode("doc");
                                  }
                                  setResourceSearchOpen(false);
                                }}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left"
                              >
                                <span
                                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${typeBadge.badge}`}
                                >
                                  <typeBadge.Icon className={`h-3.5 w-3.5 ${typeBadge.tone}`} />
                                  <span>{typeBadge.label}</span>
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                                    {(r.title ?? "").toString().trim() || "Untitled"}
                                  </div>
                                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                    {formatRelativeTime(r.updated_at)}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>,
                document.body
              )}
          </>
        )}
      </div>

      {!sidePeekActive && (
        <div
          onMouseDown={onStartResize}
          onMouseEnter={(e) => setDividerTip({ x: e.clientX + 12, y: e.clientY + 12, visible: true })}
          onMouseMove={(e) => setDividerTip({ x: e.clientX + 12, y: e.clientY + 12, visible: true })}
          onMouseLeave={() => {
            if (!resizing) setDividerTip((p) => ({ ...p, visible: false }));
          }}
          className="group relative hidden shrink-0 lg:block bg-[linear-gradient(to_right,#ffffff_0%,#ffffff_50%,#FCFCFC_50%,#FCFCFC_100%)] dark:bg-transparent"
          style={{ width: 10 }}
          aria-label="Drag to resize"
          role="separator"
        >
          <div className="absolute inset-0 cursor-col-resize" />
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-200 dark:bg-zinc-800" />
        </div>
      )}

      {!sidePeekActive && (
        <div className="flex min-w-0 flex-1 flex-col bg-[#FCFCFC] p-6 lg:min-w-[360px] h-full min-h-0 dark:bg-zinc-900">
          <div ref={chatPanelRef} className="relative flex min-w-0 flex-1 flex-col h-full min-h-0">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-bold">Chat</h2>
            <div className="relative flex items-center gap-2 text-zinc-400">
              <BoardChatModeToggle value={chatMode} onValueChange={setChatMode} disabled={chatSending} />
              <button
                ref={historyButtonRef}
                type="button"
                onClick={async () => {
                  const nextShow = !showHistory;
                  setShowHistory(nextShow);
                  if (!nextShow) return;

                  const cachedChats = chatHistory?.chats ?? [];
                  if (cachedChats.length > 0) {
                    const boardChats = cachedChats
                      .filter((c) => typeof c.title === "string" && c.title.startsWith("Board:"))
                      .slice(0, 20)
                      .map((c) => ({
                        id: c.id,
                        title: c.title,
                        created_at: c.created_at ?? new Date(0).toISOString(),
                      }));
                    setHistoryChats(boardChats);
                    setHistoryLoading(false);
                    return;
                  }

                  let token = "";
                  let uid = userId;
                  try {
                    const sessionInfo = await getSessionWithTimeout({ timeoutMs: 4500, retries: 3, retryDelayMs: 200 });
                    token = sessionInfo.session?.access_token ?? "";
                    uid = uid ?? sessionInfo.session?.user?.id ?? null;
                    if (uid) setUserId(uid);
                  } catch {
                    token = "";
                  }

                  if (!token || !uid) {
                    setHistoryChats([]);
                    return;
                  }

                  try {
                    setHistoryLoading(true);
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 8000);
                    const res = await fetch(
                      `/api/board/history?${new URLSearchParams({ limit: "20" }).toString()}`,
                      { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }
                    );
                    clearTimeout(timeoutId);
                    if (!res.ok) {
                      setHistoryChats([]);
                      return;
                    }
                    const body = (await res.json()) as {
                      chats?: { id: string; title: string | null; created_at: string }[];
                    };
                    setHistoryChats(Array.isArray(body.chats) ? body.chats : []);
                  } finally {
                    setHistoryLoading(false);
                  }
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="History"
                onMouseEnter={(e) => showHoverTip("Chat history", e)}
                onMouseMove={(e) => showHoverTip("Chat history", e)}
                onMouseLeave={hideHoverTip}
              >
                <History className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const shouldStopSending = chatSendInFlightRef.current || chatSendQueueRef.current.length > 0;
                  if (shouldStopSending) {
                    stopAllRef.current = true;
                  }
                  chatSendQueueRef.current = [];
                  chatAbortControllerRef.current?.abort();
                  if (!shouldStopSending) {
                    stopAllRef.current = false;
                  }

                  historyLoadAbortRef.current?.abort();

                  setShowHistory(false);
                  setBoardChatId(null);
                  setMessage("");
                  setAttachedResourceIds([]);
                  setAttachedPathRefs([]);
                  setChatMessages([]);
                  setDocDiffs({});
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="New"
                onMouseEnter={(e) => showHoverTip("new chat", e)}
                onMouseMove={(e) => showHoverTip("new chat", e)}
                onMouseLeave={hideHoverTip}
              >
                <PlusCircle className="h-5 w-5" />
              </button>
              {showHistory && (
                <div
                  ref={historyPopoverRef}
                  className="absolute right-0 top-8 z-20 w-64 rounded-2xl border border-zinc-200 bg-white p-2 text-xs text-zinc-700 shadow-lg dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  <div className="mb-1 flex items-center justify-between px-1">
                    <span className="font-semibold">Board chats</span>
                    {historyLoading && <span className="text-[10px] text-zinc-400">Loading…</span>}
                  </div>
                  {historyChats.length === 0 && !historyLoading ? (
                    <div className="px-1 py-2 text-[11px] text-zinc-400">No board chats yet.</div>
                  ) : (
                    <div className="max-h-80 space-y-1 overflow-auto">
                      {historyChats.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void (async () => {
                              const chatId = c.id;
                              const reqId = ++historyLoadReqIdRef.current;
                              const loadController = new AbortController();
                              try {
                                const shouldStopSending =
                                  chatSendInFlightRef.current || chatSendQueueRef.current.length > 0;
                                if (shouldStopSending) {
                                  stopAllRef.current = true;
                                }
                                chatSendQueueRef.current = [];
                                chatAbortControllerRef.current?.abort();
                                if (!shouldStopSending) {
                                  stopAllRef.current = false;
                                }

                                historyLoadAbortRef.current?.abort();
                                historyLoadAbortRef.current = loadController;

                                setShowHistory(false);
                                setBoardChatId(chatId);
                                setMessage("");
                                setAttachedResourceIds([]);
                                setAttachedPathRefs([]);
                                setChatMessages([
                                  {
                                    id: crypto.randomUUID(),
                                    role: "assistant",
                                    content: "",
                                    kind: "status",
                                  },
                                ]);

                                const toBoardList = (
                                  raw: Array<{ id: string; role: "user" | "assistant"; content: string; created_at?: string | null }>
                                ) =>
                                  raw.map((m) => {
                                    const parsed = parseBoardMessageContent(m.content ?? "");
                                    const steps = m.role === "assistant" ? metaToChatSteps(m.id, parsed.meta) : undefined;
                                    return {
                                      id: m.id,
                                      role: m.role,
                                      content: parsed.text,
                                      kind: "normal",
                                      steps,
                                      meta: parsed.meta,
                                    } as BoardChatMessage;
                                  });

                                const cached = chatHistory?.messagesByChatId?.[chatId];
                                if (Array.isArray(cached) && cached.length > 0) {
                                  setChatMessages(toBoardList(cached));
                                  return;
                                }

                                const sessionInfo = await getSessionWithTimeout({ timeoutMs: 4500, retries: 3, retryDelayMs: 200 });
                                const token = sessionInfo.session?.access_token ?? "";
                                if (!token) {
                                  console.warn("[board] missing session token for history", {
                                    timedOut: Boolean(sessionInfo.timedOut),
                                    online: typeof navigator !== "undefined" ? navigator.onLine : null,
                                  });
                                  if (sessionInfo.timedOut) {
                                    setChatMessages([
                                      { id: crypto.randomUUID(), role: "assistant", content: "会话获取超时，请稍后重试或刷新页面。", kind: "normal" },
                                    ]);
                                    return;
                                  }
                                  setChatMessages([
                                    { id: crypto.randomUUID(), role: "assistant", content: "请先登录后再查看历史对话。", kind: "normal" },
                                  ]);
                                  return;
                                }

                                const PAGE_LIMIT = 200;

                                const fetchPage = async (before?: string | null) => {
                                  const params = new URLSearchParams({ chatId, limit: String(PAGE_LIMIT) });
                                  if (before) params.set("before", before);
                                  const timeoutId = setTimeout(() => {
                                    try {
                                      loadController.abort();
                                    } catch {
                                      void 0;
                                    }
                                  }, 15000);
                                  const res = await fetch(`/api/board/history?${params.toString()}`, {
                                    headers: { Authorization: `Bearer ${token}` },
                                    signal: loadController.signal,
                                  });
                                  clearTimeout(timeoutId);
                                  if (!res.ok) {
                                    const text = await res.text().catch(() => "");
                                    throw new Error(text || "加载历史对话失败。");
                                  }
                                  const body = (await res.json()) as {
                                    messages?: { id: string; role: string | null; content: string | null; created_at: string }[];
                                    has_more?: boolean;
                                    next_before?: string | null;
                                  };
                                  const msgs = Array.isArray(body.messages) ? body.messages : [];
                                  const normalized = msgs.map((m) => ({
                                    id: m.id,
                                    role: m.role === "user" ? ("user" as const) : ("assistant" as const),
                                    content: m.content ?? "",
                                    created_at: m.created_at ?? null,
                                  }));
                                  return {
                                    normalized,
                                    hasMore: Boolean(body.has_more),
                                    nextBefore: typeof body.next_before === "string" ? body.next_before : null,
                                  };
                                };

                                const first = await fetchPage(null);
                                if (boardChatIdRef.current !== chatId || historyLoadReqIdRef.current !== reqId) return;

                                chatHistory?.setMessagesForChat(chatId, first.normalized);
                                setChatMessages(toBoardList(first.normalized));

                                let hasMore = first.hasMore;
                                let before: string | null = first.nextBefore;
                                const seen = new Set(first.normalized.map((m) => m.id));

                                while (hasMore && before) {
                                  const page = await fetchPage(before);
                                  if (boardChatIdRef.current !== chatId || historyLoadReqIdRef.current !== reqId) return;

                                  const older = page.normalized.filter((m) => !seen.has(m.id));
                                  older.forEach((m) => seen.add(m.id));

                                  if (older.length > 0) {
                                    const cachedNow = chatHistory?.messagesByChatId?.[chatId] ?? [];
                                    chatHistory?.setMessagesForChat(chatId, [...older, ...cachedNow]);
                                    const olderBoard = toBoardList(older);
                                    setChatMessages((prev) => {
                                      if (boardChatIdRef.current !== chatId || historyLoadReqIdRef.current !== reqId) return prev;
                                      const existingIds = new Set(prev.map((m) => m.id));
                                      const toAdd = olderBoard.filter((m) => !existingIds.has(m.id));
                                      return toAdd.length > 0 ? [...toAdd, ...prev] : prev;
                                    });
                                  }

                                  hasMore = page.hasMore;
                                  before = page.nextBefore;
                                }
                              } catch (err) {
                                const isAbort =
                                  Boolean(historyLoadAbortRef.current?.signal?.aborted) ||
                                  (err instanceof DOMException && err.name === "AbortError") ||
                                  (err instanceof Error && err.name === "AbortError");
                                if (isAbort) return;
                                console.error("[board chat] failed to load history chat", { chatId: c.id, error: err });
                                const cached = chatHistory?.messagesByChatId?.[chatId];
                                if (Array.isArray(cached) && cached.length > 0) {
                                  setChatMessages(
                                    cached.map((m) => {
                                      const parsed = parseBoardMessageContent(m.content ?? "");
                                      const steps =
                                        m.role === "assistant" ? metaToChatSteps(m.id, parsed.meta) : undefined;
                                      return {
                                        id: m.id,
                                        role: m.role,
                                        content: parsed.text,
                                        kind: "normal",
                                        steps,
                                        meta: parsed.meta,
                                      } as BoardChatMessage;
                                    })
                                  );
                                  return;
                                }
                                setChatMessages([
                                  { id: crypto.randomUUID(), role: "assistant", content: "加载历史对话失败。", kind: "normal" },
                                ]);
                              }
                            })();
                          }}
                          className="flex w-full flex-col rounded-xl px-2 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        >
                          <span className="truncate text-[11px] font-medium">
                            {c.title?.replace(/^Board:\s*/, "") || "Board chat"}
                          </span>
                          <span className="mt-0.5 text-[10px] text-zinc-400">
                            {formatRelativeTime(c.created_at)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {chatMessages.length === 0 ? (
            <div className="flex min-h-0 flex-col items-center justify-start text-center py-6">
              <div className="mb-6">
                <Bot className="h-12 w-12 text-zinc-300 dark:text-zinc-600" />
              </div>
              <h1 className="mb-8 text-2xl font-bold">Turn your ideas into a viral media star!</h1>
            </div>
          ) : (
            <div ref={chatMessagesScrollRef} className="min-h-0 flex-1 overflow-y-auto px-1 pb-6">
              <div className="flex flex-col gap-3">
                {chatMessages.map((m) => {
                  const showRetry = m.kind !== "status" && m.role === "assistant" && m.id === lastAssistantMessageId;
                  return (
                    <div key={m.id} className="flex flex-col">
                    {m.kind === "status" ? (
                      <div className="mr-auto max-w-[85%]">
                        {m.content.trim() ? (
                          <div className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                            <span>✦</span>
                            <span className="max-w-[320px] truncate">{m.content}</span>
                          </div>
                        ) : (
                          <div className="w-[320px] max-w-full rounded-xl border border-white/30 bg-white/55 p-3 shadow-sm ring-1 ring-zinc-200/40 backdrop-blur-md dark:border-white/10 dark:bg-zinc-900/35 dark:ring-white/5">
                            <div className="flex flex-col gap-2">
                              <div className="h-3 w-2/3 max-w-full animate-pulse rounded bg-zinc-200/70 dark:bg-zinc-700/60" />
                              <div className="h-3 w-full max-w-full animate-pulse rounded bg-zinc-200/70 dark:bg-zinc-700/60" />
                              <div className="h-3 w-4/5 max-w-full animate-pulse rounded bg-zinc-200/70 dark:bg-zinc-700/60" />
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      m.role === "assistant" ? (
                        <div className="flex items-end gap-2">
                          <div className="max-w-[85%] rounded-xl bg-zinc-100 px-4 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">
                            {Array.isArray(m.attachedResourceIds) && m.attachedResourceIds.length > 0 && (
                              <div className="mb-2">{renderAttachedChips(m.attachedResourceIds)}</div>
                            )}
                            {Array.isArray(m.attachedPathRefs) && m.attachedPathRefs.length > 0 && (
                              <div className="mb-2">{renderPathRefChips(m.attachedPathRefs)}</div>
                            )}
                            <SimpleMarkdownRenderer content={m.content} />
                          </div>
                        </div>
                      ) : (
                        <div className="ml-auto max-w-[85%] rounded-xl bg-zinc-700 px-4 py-2 text-sm text-white">
                          {Array.isArray(m.attachedResourceIds) && m.attachedResourceIds.length > 0 && (
                            <div className="mb-2 flex justify-end">{renderAttachedChips(m.attachedResourceIds)}</div>
                          )}
                          {Array.isArray(m.attachedPathRefs) && m.attachedPathRefs.length > 0 && (
                            <div className="mb-2 flex justify-end">{renderPathRefChips(m.attachedPathRefs)}</div>
                          )}
                          <div className="whitespace-pre-wrap">{m.content}</div>
                        </div>
                      )
                    )}
                    {m.role === "assistant" && showRetry && (
                      <div className="mt-1 flex items-center justify-end gap-2 pr-2">
                        <button
                          type="button"
                          onClick={() => setOpenStatsForMessageId((prev) => (prev === m.id ? null : m.id))}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                          aria-label="Stats"
                          title="Stats"
                        >
                          <BarChart3 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void retryLastAssistantMessage()}
                          disabled={chatSending}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                          aria-label="Retry"
                          title="Retry"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    {m.role === "assistant" && openStatsForMessageId === m.id && (
                      <div className="mr-auto ml-2 mt-1 max-w-[85%] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[11px] text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                        {(() => {
                          let userIndex = chatMessagesRef.current.findIndex((x) => x.id === m.id) - 1;
                          while (userIndex >= 0 && chatMessagesRef.current[userIndex]?.role !== "user") userIndex -= 1;
                          const userMsg =
                            userIndex >= 0 && chatMessagesRef.current[userIndex]?.role === "user"
                              ? chatMessagesRef.current[userIndex]
                              : null;
                          const inputText = userMsg
                            ? withPathRefs((userMsg.content ?? "").toString(), userMsg.attachedPathRefs)
                            : "";
                          const ti = estimateTokens(inputText);
                          const to = estimateTokens((m.content ?? "").toString());
                          const total = ti + to;
                          const modelMeta = MODELS.find((mm) => mm.id === selectedModel) ?? MODELS[0]!;
                          const credits = creditsPerRequestForModelKey(modelMeta.id);
                          return (
                            <span>
                              {chatMode === "ask" ? (
                                <>Tokens: {total} (in {ti} / out {to}) · Credits {credits}</>
                              ) : (
                                <>Model: {modelMeta.name} · Tokens: {total} (in {ti} / out {to}) · Credits {credits}</>
                              )}
                            </span>
                          );
                        })()}
                      </div>
                    )}
                    {m.steps && m.steps.length > 0 && (
                      <div
                        className={
                          m.role === "user"
                            ? "ml-auto mt-1 flex w-full max-w-[85%] flex-col items-end gap-1 pr-2 text-[11px]"
                            : "mr-auto mt-1 flex w-full max-w-[85%] flex-col gap-1 pl-0 text-[11px]"
                        }
                      >
                        {(() => {
                          const infoSteps = m.steps.filter((s) => s.type !== "doc");
                          const docSteps = m.steps.filter((s) => s.type === "doc") as Extract<
                            ChatToolStep,
                            { type: "doc" }
                          >[];
                          const hasInlineImages = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/.test((m.content ?? "").toString());
                          const visibleDocSteps = docSteps.filter((step) => {
                            const rawType = (step.resourceType ?? "").toString();
                            const baseType = getBaseType(rawType);
                            const label = (step.label ?? "").toString().trim().toLowerCase();
                            const isGeneratedLabel = label === "生成图片" || label === "generated image" || label.includes("生成图片");
                            const isMediaType =
                              baseType === "photos" ||
                              baseType === "videos" ||
                              baseType.includes("photo") ||
                              baseType.includes("image") ||
                              baseType.includes("video");
                            if (hasInlineImages && isMediaType && isGeneratedLabel) return false;
                            return true;
                          });

                          return (
                            <>
                              {infoSteps.map((step) => (
                                <div
                                  key={step.id}
                                  className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                                >
                                  <span>✦</span>
                                  <span className="max-w-full whitespace-pre-wrap break-words">{step.label}</span>
                                </div>
                              ))}

                              {visibleDocSteps.length === 1 &&
                                (() => {
                                  const step = visibleDocSteps[0]!;
                                  const rawType = step.resourceType ?? "";
                                  const { meta } = parseTypeMeta(rawType);
                                  const baseType = getBaseType(rawType);
                                  const isFolder = baseType === "persona" && (meta.folder ?? "").trim() === "1";
                                  const badge = resolveResourceBadge(rawType, isFolder);

                                  return (
                                    <button
                                      key={step.id}
                                      type="button"
                                      onClick={() => {
                                        if (!step.docId) return;
                                        if (isFolder) {
                                          setSelectedResourcePersonaIdHint(step.personaId ?? null);
                                          setResourceViewMode("list");
                                          setListFolderId(step.docId);
                                          setLeftPaneMode("resources");
                                          return;
                                        }
                                        setSelectedResourcePersonaIdHint(step.personaId ?? null);
                                        setSelectedResourceId(step.docId);
                                        setLeftPaneMode("doc");
                                      }}
                                      className="mt-2 flex w-full max-w-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white text-left shadow-sm transition-all hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                                    >
                                      <div className="flex items-start gap-4 p-4">
                                        <div
                                          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${badge.badge}`}
                                        >
                                          <badge.Icon className={`h-6 w-6 ${badge.tone.replace("/50", "")}`} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                            {step.label}
                                          </div>
                                          <div className="mt-1 flex items-center gap-2">
                                            <span
                                              className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${badge.badge}`}
                                            >
                                              {badge.label}
                                            </span>
                                            <span className="text-[10px] text-zinc-400">Click to view</span>
                                          </div>
                                        </div>
                                      </div>
                                    </button>
                                  );
                                })()}

                              {visibleDocSteps.length > 1 && (
                                <div className="mt-2 grid w-full max-w-full grid-cols-1 gap-2 sm:grid-cols-2">
                                  {visibleDocSteps.map((step) => {
                                    const rawType = step.resourceType ?? "";
                                    const { meta } = parseTypeMeta(rawType);
                                    const baseType = getBaseType(rawType);
                                    const isFolder = baseType === "persona" && (meta.folder ?? "").trim() === "1";
                                    const badge = resolveResourceBadge(rawType, isFolder);

                                    return (
                                      <button
                                        key={step.id}
                                        type="button"
                                        onClick={() => {
                                          if (!step.docId) return;
                                          if (isFolder) {
                                            setSelectedResourcePersonaIdHint(step.personaId ?? null);
                                            setResourceViewMode("list");
                                            setListFolderId(step.docId);
                                            setLeftPaneMode("resources");
                                            return;
                                          }
                                          setSelectedResourcePersonaIdHint(step.personaId ?? null);
                                          setSelectedResourceId(step.docId);
                                          setLeftPaneMode("doc");
                                        }}
                                        className="group flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 text-left transition-all hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
                                      >
                                        <div className="flex items-center justify-between">
                                          <div
                                            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-transform group-hover:scale-105 ${badge.badge}`}
                                          >
                                            <badge.Icon className={`h-4 w-4 ${badge.tone.replace("/50", "")}`} />
                                          </div>
                                        </div>
                                        <div className="min-w-0">
                                          <div className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                                            {step.label}
                                          </div>
                                          <div className="mt-1 text-[10px] text-zinc-500">{badge.label}</div>
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                    {m.role === "assistant" && !m.meta?.automation && m.meta?.task_plan && m.meta.task_plan.length > 0 && (
                      <div className="mr-auto mt-2 flex w-full max-w-[85%] flex-col gap-2 pl-0 text-[11px]">
                        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
                          <div className="text-[11px] font-semibold">任务清单</div>
                          <ul className="mt-1 space-y-0.5 text-[10px] text-zinc-600 dark:text-zinc-300">
                            {m.meta.task_plan.map((t, idx) => (
                              <li key={`${m.id}:planonly:${idx}`} className="flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
                                <span className="flex-1 truncate">
                                  {t.title}
                                  {t.status && t.status !== "pending" ? ` · ${t.status}` : ""}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                    {m.role === "assistant" && m.meta?.automation && (
                      <div className="mr-auto mt-2 flex w-full max-w-[85%] flex-col gap-2 pl-0 text-[11px]">
                        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-500/60 dark:bg-amber-900/30 dark:text-amber-50">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[11px] font-semibold">
                                自动化任务预览：{m.meta.automation.name || "未命名自动化"}
                              </span>
                              <span className="text-[10px] text-amber-800/80 dark:text-amber-100/80">
                                调度：{m.meta.automation.cron} · 当前状态：{m.meta.automation.enabled ? "已启用" : "待确认"}
                              </span>
                            </div>
                          </div>
                          {m.meta.task_plan && m.meta.task_plan.length > 0 && (
                            <div className="mt-2 rounded-lg bg-amber-100/70 px-2 py-1.5 text-[10px] text-amber-900 dark:bg-amber-900/60 dark:text-amber-50">
                              <div className="mb-1 font-semibold">任务清单</div>
                              <ul className="space-y-0.5">
                                {m.meta.task_plan.map((t, idx) => (
                                  <li key={`${m.id}:plan:${idx}`} className="flex items-center gap-1.5">
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                    <span className="flex-1 truncate">
                                      {t.title}
                                      {t.status && t.status !== "pending" ? ` · ${t.status}` : ""}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {m.meta.automation.auto_confirm &&
                            !m.meta.automation.enabled &&
                            pendingAutomationConfirm?.id === m.meta.automation.id && (
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                              <span>
                                将在
                                {(() => {
                                  const a = m.meta!.automation!;
                                  const confirmAtMs = a.confirm_at ? Date.parse(a.confirm_at) : NaN;
                                  const s =
                                    Number.isFinite(confirmAtMs) ? Math.max(0, Math.ceil((confirmAtMs - autoConfirmNow) / 1000)) : a.confirm_timeout_seconds ?? 10;
                                  return ` ${s} 秒后自动启用（除非你取消）`;
                                })()}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const a = m.meta!.automation!;
                                    void enableAutomation(a.id);
                                    setPendingAutomationConfirm(null);
                                  }}
                                  className="rounded-md bg-amber-500 px-2 py-1 text-[10px] font-semibold text-white hover:bg-amber-600"
                                >
                                  立即启用
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const a = m.meta!.automation!;
                                    void cancelAutomation(a.id);
                                    setPendingAutomationConfirm(null);
                                  }}
                                  className="rounded-md border border-amber-400 px-2 py-1 text-[10px] font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-500/80 dark:text-amber-50 dark:hover:bg-amber-900/60"
                                >
                                  取消并删除
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {m.role === "user" && (
                      <div className="ml-auto mt-1 flex items-center gap-2 text-zinc-400">
                      <div className="relative group">
                        <button
                          type="button"
                          onClick={() => copyChatMessage(m.id, m.content)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                          aria-label="Copy all"
                        >
                          {copiedMessageId === m.id ? <CheckSquare className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </button>
                        <span className="pointer-events-none absolute bottom-full left-0 mb-2 w-max -translate-x-1/3 whitespace-nowrap rounded-md bg-black px-2 py-1 text-[11px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
                          {copiedMessageId === m.id ? "Copied" : "Copy all"}
                        </span>
                        <span className="pointer-events-none absolute bottom-full left-2 mb-1 h-2 w-2 -translate-x-1/3 rotate-45 bg-black opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                      <div className="relative group">
                        <button
                          type="button"
                          onClick={() => openConfirmAction("delete", m.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <span className="pointer-events-none absolute bottom-full left-0 mb-2 w-max -translate-x-1/3 whitespace-nowrap rounded-md bg-black px-2 py-1 text-[11px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
                          Delete
                        </span>
                        <span className="pointer-events-none absolute bottom-full left-2 mb-1 h-2 w-2 -translate-x-1/3 rotate-45 bg-black opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                      <div className="relative group">
                        <button
                          type="button"
                          onClick={() => openConfirmAction("revert", m.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                          aria-label="Revert to before this round?"
                        >
                          <Undo2 className="h-4 w-4" />
                        </button>
                        <span className="pointer-events-none absolute bottom-full left-0 mb-2 w-max -translate-x-1/2 whitespace-nowrap rounded-md bg-black px-2 py-1 text-[11px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
                          Revert to before this round?
                        </span>
                        <span className="pointer-events-none absolute bottom-full left-1 mb-1 h-2 w-2 -translate-x-1/2 rotate-45 bg-black opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {confirmAction && (
            <div className="mb-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_10px_20px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-col gap-3">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {confirmAction.type === "delete"
                    ? "Are you sure you want to delete? This action cannot be undone."
                    : "Are you sure you want to revert to this response and resend?"}
                </div>
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Possible files to be modified</div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
                  {confirmAction.affectedFiles.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {confirmAction.affectedFiles.map((raw) => {
                        const text = (raw ?? "").toString().trim();
                        const cleaned = text.replace(/^Updated:\s*/i, "").trim();
                        const candidateId = cleaned ? (resourceIdsByTitle.get(cleaned.toLowerCase())?.[0] ?? null) : null;
                        const doc = candidateId ? (resourcesRef.current.find((r) => r.id === candidateId) ?? null) : null;
                        const typeText = (doc?.type ?? "").toString().toLowerCase();
                        const badge = resolveResourceBadge(typeText, false);
                        const label = cleaned || text || "Untitled";
                        return (
                          <div
                            key={raw}
                            className="group flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-left text-sm shadow-[0_10px_20px_rgba(0,0,0,0.06)] transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-900/60"
                          >
                            <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${badge.badge}`}>
                              <badge.Icon className={`h-3.5 w-3.5 ${badge.tone}`} />
                              <span>{badge.label}</span>
                            </span>
                            <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-1 py-1 text-xs text-zinc-500 dark:text-zinc-400">No files detected.</div>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmAction(null)}
                    className="rounded-lg border border-zinc-200 bg-white px-4 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirmAction.type === "delete") {
                        void deleteChatMessage(confirmAction.messageId);
                      } else {
                        void undoChatRound(confirmAction.messageId, { revertDocs: true });
                      }
                      setConfirmAction(null);
                    }}
                    className={`rounded-lg px-4 py-1.5 text-xs font-semibold text-white ${
                      confirmAction.type === "delete"
                        ? "bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400"
                        : "bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                    }`}
                  >
                    {confirmAction.type === "delete" ? "Delete" : "Revert"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div
            ref={inputWindowRef}
            className={`${chatMessages.length === 0 ? "mt-4" : "mt-auto"} w-full max-w-full`}
          >
          {latestTaskPlan && latestTaskPlan.length > 0 && (
            <div className="mb-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-[11px] text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
              <div className="text-[11px] font-semibold">任务规划</div>
              <div className="mt-1 flex flex-col gap-1.5">
                {latestTaskPlan.map((t, idx) => (
                  <div key={`plan-panel-${idx}`} className="flex items-center gap-2">
                    {t.status === "completed" ? (
                      <CheckSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    ) : t.status === "in_progress" ? (
                      <RefreshCw className="h-4 w-4 animate-spin text-zinc-600 dark:text-zinc-300" />
                    ) : (
                      <span className="h-4 w-4 rounded border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950" />
                    )}
                    <div className="min-w-0 flex-1 truncate">{t.title}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
            className={`${pendingFiles.length > 0 || attachedResourceIds.length > 0 || attachedPathRefs.length > 0 ? "rounded-b-2xl" : "rounded-2xl"} divide-y-0 bg-white shadow-sm dark:bg-zinc-900`}
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

                let meta: { kind?: "persona" | "doc"; personaId?: string; dbId?: string; isFolder?: boolean } | null = null;
                const metaRaw = e.dataTransfer.getData("application/x-board-resource-meta")?.trim();
                if (metaRaw) {
                  try {
                    meta = JSON.parse(metaRaw) as { kind?: "persona" | "doc"; personaId?: string; dbId?: string; isFolder?: boolean };
                  } catch {
                    meta = null;
                  }
                }
                if (meta?.kind === "persona" && meta.personaId) {
                  setPersonaIds([meta.personaId]);
                  setSelectedResourcePersonaIdHint(meta.personaId);
                  setInputBarCollapsed(false);
                  return;
                }
                if (meta?.kind === "doc" && meta.dbId) {
                  handleAddIdsToChat([meta.dbId]);
                  setInputBarCollapsed(false);
                  return;
                }
                const resourceId =
                  e.dataTransfer.getData("application/x-board-resource-id")?.trim() ||
                  e.dataTransfer.getData("text/plain")?.trim();

                const resource = resourceId ? resources.find((res) => res.id === resourceId) : undefined;
                if (resourceId && resource) {
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

                {chatMode !== "ask" && (
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
                )}
              </AIInputTools>
              {chatSending && !message.trim() ? (
                <AIInputButton
                  type="button"
                  className="h-9 w-9 rounded-full bg-black p-0 text-white hover:bg-zinc-800"
                  onClick={() => {
                    stopAllRef.current = true;
                    chatSendQueueRef.current = [];
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
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                    <button
                      type="button"
                      onClick={() => setQuickAction(null)}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-md hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
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
          {chatMessages.length === 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
              <button
                type="button"
                onClick={() => {
                  if (chatMode === "ask") setChatMode("create");
                  setQuickAction((prev) => (prev === "Batch XHS Posts" ? null : "Batch XHS Posts"));
                }}
                className={`inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 ${
                  quickAction === "Batch XHS Posts" ? "ring-2 ring-zinc-900/10 dark:ring-white/10" : ""
                }`}
              >
                Batch XHS Posts
              </button>
              <button
                type="button"
                onClick={() => {
                  if (chatMode === "ask") setChatMode("create");
                  setQuickAction((prev) => (prev === "Scheduled Tasks" ? null : "Scheduled Tasks"));
                }}
                className={`inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 ${
                  quickAction === "Scheduled Tasks" ? "ring-2 ring-zinc-900/10 dark:ring-white/10" : ""
                }`}
              >
                Scheduled Tasks
              </button>
              <button
                type="button"
                onClick={() => {
                  if (chatMode === "ask") setChatMode("create");
                  setQuickAction((prev) => (prev === "Design Image" ? null : "Design Image"));
                }}
                className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 ${
                  quickAction === "Design Image" ? "ring-2 ring-zinc-900/10 dark:ring-white/10" : ""
                }`}
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
          </div>
        </div>
      )}
    </div>
  );
}
