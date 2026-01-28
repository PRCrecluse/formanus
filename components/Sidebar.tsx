"use client";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { GlobalChatRow } from "@/components/AppShell";
import {
  HomeIcon,
  RectangleGroupIcon,
  CalendarDaysIcon,
  CreditCardIcon,
  ArrowRightStartOnRectangleIcon,
  BoltIcon,
} from "@heroicons/react/24/outline";
import {
  ChevronsLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  MoreHorizontal,
  ArrowUp,
  ArrowDown,
  Sun,
  Moon,
  Menu,
  Settings,
  Mail,
  Link2,
  Pencil,
  Move,
  ExternalLink,
  Columns,
  Trash2,
  X,
} from "lucide-react";
import { getSessionWithTimeout, supabase } from "@/lib/supabaseClient";
import { usePathname, useRouter } from "next/navigation";
import { getCleanPersonaDocId, makePersonaDocDbId, normalizePersonaDocType } from "@/lib/utils";

type UserInfo = {
  id?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  username?: string | null;
  credits?: number | null;
};

type PlanId = "basic_monthly" | "basic_yearly" | "pro_monthly" | "pro_yearly";

const LIVE_PLAN_CHECKOUT_URLS: Record<PlanId, string> = {
  basic_monthly: "https://buy.stripe.com/3cI14o6VCevr0mvcoI5ZC00",
  pro_monthly: "https://buy.stripe.com/6oUcN65Ry9b7gltbkE5ZC01",
  basic_yearly: "https://buy.stripe.com/bJedRafs8gDz7OX1K45ZC02",
  pro_yearly: "https://buy.stripe.com/5kQ3cwdk05YV1qzewQ5ZC03",
};

const TEST_PLAN_CHECKOUT_URLS: Partial<Record<PlanId, string>> = {
  basic_monthly: "https://buy.stripe.com/test_00w14pccc21PbclfyO2B200",
  basic_yearly: "https://buy.stripe.com/test_3cI28t2BCayl4NXdqG2B202",
  pro_yearly: "https://buy.stripe.com/test_00w28ta449uhgwFfyO2B203",
  pro_monthly: "https://buy.stripe.com/test_cNibJ3gss5e10xH86m2B201",
};

const STRIPE_ENV = process.env.NEXT_PUBLIC_STRIPE_ENV ?? "";
const useTestStripeLinks = STRIPE_ENV === "test";

const monthlyPlans = [
  {
    id: "basic_monthly" as const,
    title: "Basic Plan",
    price: "$40",
    cadence: "/mo",
    recommended: false,
    features: [
      "500 credits per month",
      "Create up to 5 personas",
      "Up to 5 automation workflows",
      "Unlimited integrations with Notion, Slack, and more",
      "Basic social media operation advice",
      "Social media calendar and reminders",
    ],
  },
  {
    id: "pro_monthly" as const,
    title: "Pro Plan",
    price: "$100",
    cadence: "/mo",
    recommended: true,
    features: [
      "1000 credits per month",
      "Unlimited personas",
      "Up to 30 automation workflows",
      "Unlimited integrations with Notion, Slack, and more",
      "Professional social media operation advice",
      "Social media calendar and reminders",
    ],
  },
];

const yearlyPlans = [
  {
    id: "basic_yearly" as const,
    title: "Basic Plan",
    price: "$400",
    cadence: "/yr",
    recommended: false,
    features: [
      "500 credits per month",
      "Create up to 5 personas",
      "Up to 5 automation workflows",
      "Unlimited integrations with Notion, Slack, and more",
      "Basic social media operation advice",
      "Social media calendar and reminders",
    ],
  },
  {
    id: "pro_yearly" as const,
    title: "Pro Plan",
    price: "$1000",
    cadence: "/yr",
    recommended: true,
    features: [
      "1000 credits per month",
      "Unlimited personas",
      "Up to 30 automation workflows",
      "Unlimited integrations with Notion, Slack, and more",
      "Professional social media operation advice",
      "Social media calendar and reminders",
    ],
  },
];

function UpgradePlanCard({
  title,
  price,
  cadence,
  recommended,
  features,
  checkoutUrl,
}: {
  title: string;
  price: string;
  cadence: string;
  recommended: boolean;
  features: string[];
  checkoutUrl: string | null;
}) {
  return (
    <div
      className={`relative w-full rounded-2xl border bg-white p-5 shadow-sm transition-colors dark:bg-zinc-950 ${
        recommended
          ? "border-zinc-900 dark:border-zinc-200"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="text-base font-semibold tracking-tight">{title}</div>
        {recommended && (
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-white dark:text-black">
            Recommended
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <div className="text-2xl font-semibold tracking-tight">{price}</div>
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {cadence}
        </div>
      </div>
      <div className="mt-4 space-y-1.5 text-xs text-zinc-700 dark:text-zinc-300">
        {features.map((f) => (
          <div key={f} className="flex items-start gap-2">
            <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-zinc-900 dark:bg-zinc-200" />
            <span className="leading-5">{f}</span>
          </div>
        ))}
      </div>
      {checkoutUrl ? (
        <a
          href={checkoutUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`mt-5 inline-flex w-full items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
            recommended
              ? "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
          }`}
        >
          Subscribe
        </a>
      ) : null}
    </div>
  );
}

function isImageLike(input?: string | null) {
  if (!input) return false;
  const v = input.trim();
  if (!v) return false;
  if (v.startsWith("http") || v.startsWith("blob:") || v.startsWith("/")) return true;
  return false;
}

function getFixedMenuPos(rect: DOMRect, menuWidth: number) {
  const padding = 8;
  const left = Math.min(Math.max(padding, rect.right - menuWidth), window.innerWidth - menuWidth - padding);
  const belowTop = rect.bottom + 4;
  const aboveAvailable = Math.max(0, rect.top - padding - 4);
  const belowAvailable = Math.max(0, window.innerHeight - belowTop - padding);
  const placement: "top" | "bottom" = belowAvailable >= 160 || belowAvailable >= aboveAvailable ? "bottom" : "top";
  const top = placement === "bottom" ? belowTop : rect.top - 4;
  const maxHeight = placement === "bottom" ? Math.max(80, belowAvailable) : Math.max(80, aboveAvailable);
  return { top, left, placement, maxHeight };
}

type PersonaItem = {
  id: string;
  title: string;
  badge?: string;
  rightLabel?: string;
  kind?: "persona" | "folder" | "doc";
  href?: string;
  children?: PersonaItem[];
  meta?: {
    personaId?: string;
    section?: "persona" | "albums" | "posts";
    dbId?: string;
    isFolder?: boolean;
    folderKind?: "section" | "doc";
  };
};

function buildDefaultPersonaChildren(personaId: string): PersonaItem[] {
  return [
    {
      id: `${personaId}:docs`,
      title: "Doc",
      kind: "folder",
      href: `/persona/${personaId}/docs`,
      meta: { personaId, section: "persona", folderKind: "section" },
    },
    {
      id: `${personaId}:albums`,
      title: "albums",
      kind: "folder",
      href: `/persona/${personaId}/albums`,
      meta: { personaId, section: "albums", folderKind: "section" },
    },
    {
      id: `${personaId}:posts`,
      title: "posts",
      kind: "folder",
      href: `/persona/${personaId}/posts`,
      meta: { personaId, section: "posts", folderKind: "section" },
    },
  ];
}

function makeInitialPersonas(): PersonaItem[] {
  const seeds = [
    { id: "1", title: "10k MRR" },
    { id: "2", title: "todolist" },
    { id: "3", title: "Winter Plan" },
  ];
  return seeds.map((p) => ({
    ...p,
    kind: "persona" as const,
  }));
}

const BOARD_CACHE_DB_NAME = "aipersona_board_cache";
const BOARD_CACHE_DB_VERSION = 1;
const BOARD_CACHE_STORE_DOCS = "persona_docs_meta_v1";
const BOARD_MAX_CACHED_DOCS = 200;

let boardCacheDbPromise: Promise<IDBDatabase> | null = null;

type BoardCacheDoc = {
  id: string;
  title: string | null;
  updated_at: string | null;
  persona_id?: string | null;
  type?: string | null;
};

function boardIdbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

async function openBoardCacheDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB unavailable");
  }
  if (boardCacheDbPromise) return boardCacheDbPromise;
  boardCacheDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(BOARD_CACHE_DB_NAME, BOARD_CACHE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BOARD_CACHE_STORE_DOCS)) {
        db.createObjectStore(BOARD_CACHE_STORE_DOCS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open cache db"));
  });
  return boardCacheDbPromise;
}

async function writeBoardCachedDocs(db: IDBDatabase, userId: string, docs: BoardCacheDoc[]): Promise<void> {
  try {
    const sorted = [...docs].sort((a, b) => {
      const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return tb - ta;
    });
    const tx = db.transaction(BOARD_CACHE_STORE_DOCS, "readwrite");
    const store = tx.objectStore(BOARD_CACHE_STORE_DOCS);
    await boardIdbRequest(
      store.put(
        {
          docs: sorted.slice(0, BOARD_MAX_CACHED_DOCS),
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

async function readBoardCachedDocs(db: IDBDatabase, userId: string): Promise<BoardCacheDoc[]> {
  const tx = db.transaction(BOARD_CACHE_STORE_DOCS, "readonly");
  const store = tx.objectStore(BOARD_CACHE_STORE_DOCS);
  const value = (await boardIdbRequest(store.get(userId))) as
    | { docs?: unknown; updatedAt?: unknown }
    | undefined;
  const docs = Array.isArray(value?.docs) ? (value?.docs as BoardCacheDoc[]) : [];
  return docs.filter((d) => d && typeof d === "object" && typeof (d as { id?: unknown }).id === "string");
}

function NavItem({
  href,
  label,
  Icon,
  active,
  collapsed,
  hoverTipText,
  onShowHoverTip,
  onHideHoverTip,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<React.ComponentProps<"svg">>;
  active?: boolean;
  collapsed?: boolean;
  hoverTipText?: string;
  onShowHoverTip?: (text: string, e: ReactMouseEvent) => void;
  onHideHoverTip?: () => void;
}) {
  const iconClassName = active
    ? "h-5 w-5 text-zinc-900 dark:text-zinc-50"
    : "h-5 w-5 text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300";

  return (
    <Link
      href={href}
      className={`group flex w-full items-center gap-2 rounded-md px-3 py-1 text-sm font-semibold transition-colors ${
        active
          ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300/75 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      } ${collapsed ? "justify-center px-2" : ""}`}
      onMouseEnter={(e) => {
        if (!hoverTipText || !onShowHoverTip) return;
        onShowHoverTip(hoverTipText, e);
      }}
      onMouseMove={(e) => {
        if (!hoverTipText || !onShowHoverTip) return;
        onShowHoverTip(hoverTipText, e);
      }}
      onMouseLeave={() => {
        if (!onHideHoverTip) return;
        onHideHoverTip();
      }}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center">
        <Icon className={iconClassName} strokeWidth={2} />
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

function PersonaNode({
  item,
  depth = 0,
  activeHref,
  onCreateDoc,
  onMovePersona,
  onMovePersonaToIndex,
  onStartRename,
  renamingId,
  renameValue,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onCopyLink,
  onMoveTo,
  onOpenInNewTab,
  onOpenInSidePeek,
  onDeleteItem,
  allowPersonaDelete = false,
  draggingDocId,
  dropTargetId,
  onDocDragStart,
  onDocDragEnd,
  onDropTargetOver,
  onDropTargetLeave,
  onDropOnTarget,
  personaIndex,
  personaCount,
  allowPersonaDrag = true,
  onShowHoverTip,
  onHideHoverTip,
}: {
  item: PersonaItem;
  depth?: number;
  activeHref: string;
  onCreateDoc: (item: PersonaItem) => void;
  onMovePersona: (personaId: string, direction: "up" | "down") => void;
  onMovePersonaToIndex: (personaId: string, nextIndex: number) => void;
  onStartRename: (item: PersonaItem) => void;
  renamingId: string | null;
  renameValue: string;
  onRenameValueChange: (next: string) => void;
  onCommitRename: (item: PersonaItem) => void;
  onCancelRename: () => void;
  onCopyLink: (item: PersonaItem) => void;
  onMoveTo: (item: PersonaItem) => void;
  onOpenInNewTab: (item: PersonaItem) => void;
  onOpenInSidePeek: (item: PersonaItem) => void;
  onDeleteItem: (item: PersonaItem) => void;
  allowPersonaDelete?: boolean;
  draggingDocId: string | null;
  dropTargetId: string | null;
  onDocDragStart: (item: PersonaItem, e: React.DragEvent) => void;
  onDocDragEnd: () => void;
  onDropTargetOver: (item: PersonaItem, e: React.DragEvent) => void;
  onDropTargetLeave: (item: PersonaItem) => void;
  onDropOnTarget: (item: PersonaItem, e: React.DragEvent) => void;
  personaIndex?: number;
  personaCount?: number;
  allowPersonaDrag?: boolean;
  onShowHoverTip?: (text: string, e: ReactMouseEvent) => void;
  onHideHoverTip?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; placement: "top" | "bottom"; maxHeight: number }>({
    top: 0,
    left: 0,
    placement: "bottom",
    maxHeight: 240,
  });
  const hasChildren = item.children && item.children.length > 0;
  const isPersona = item.kind === "persona";
  const isDoc = item.kind === "doc";
  const isSectionFolder = item.kind === "folder" && item.meta?.folderKind === "section";
  const isDocFolder = item.kind === "folder" && item.meta?.folderKind === "doc";
  const isExpandable = item.kind === "persona" || (item.kind === "folder" && hasChildren);
  const isActive = item.href ? activeHref === item.href : false;
  const isRenaming = renamingId === item.id;
  const isDraggablePersona = allowPersonaDrag && item.kind === "persona";
  const isDraggableDoc =
    (item.meta?.section === "persona" ||
      item.meta?.section === "albums" ||
      item.meta?.section === "posts") &&
    ((item.kind === "doc" && item.meta?.isFolder === false) ||
      (item.kind === "folder" && item.meta?.folderKind === "doc"));
  const isDraggableItem = isDraggablePersona || isDraggableDoc;
  const canAcceptDrop =
    item.kind === "folder" &&
    (item.meta?.section === "persona" || item.meta?.section === "albums" || item.meta?.section === "posts") &&
    (item.meta.folderKind === "section" || item.meta.folderKind === "doc");
  const isDragging = draggingDocId === (item.meta?.dbId ?? item.id);
  const isDropTarget = dropTargetId === item.id;

  const row = (
    <div
      className={`group relative mx-1 flex items-center gap-1.5 rounded-lg py-1 pr-2 text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer ${
        isActive
          ? "z-10 bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-50 dark:ring-zinc-800"
          : "z-0 text-zinc-600 dark:text-zinc-400"
      }`}
      style={{ paddingLeft: `${depth * 12 + 12}px` }}
      draggable={isDraggableItem}
      onDragStart={(e) => {
        if (!isDraggableItem) return;
        onDocDragStart(item, e);
      }}
      onDragEnd={() => {
        if (!isDraggableItem) return;
        onDocDragEnd();
      }}
      onDragOver={(e) => {
        if (!canAcceptDrop) return;
        onDropTargetOver(item, e);
      }}
      onDragLeave={() => {
        if (!canAcceptDrop) return;
        onDropTargetLeave(item);
      }}
      onDrop={(e) => {
        if (!canAcceptDrop) return;
        onDropOnTarget(item, e);
      }}
      onClick={() => {
        setMenuOpen(false);
        if (item.kind === "persona") setIsOpen((v) => !v);
        if (item.kind === "folder" && hasChildren) setIsOpen(true);
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (item.kind === "folder" && item.meta?.folderKind === "section") return;
        onStartRename(item);
      }}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {isExpandable && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsOpen((v) => !v);
            }}
            className="flex h-5 w-5 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-200/60 hover:text-zinc-600 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-300"
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        )}
      </span>
      {isRenaming ? (
        <input
          value={renameValue}
          onChange={(e) => onRenameValueChange(e.target.value)}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommitRename(item);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancelRename();
            }
          }}
          onBlur={() => onCommitRename(item)}
          className="h-6 w-[180px] max-w-full rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-blue-400 dark:focus:ring-blue-400/30"
        />
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          {item.badge ? (
            <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {item.badge}
            </span>
          ) : null}
          {item.rightLabel ? <span className="ml-2 text-xs text-zinc-400">{item.rightLabel}</span> : null}
        </>
      )}
      {!isRenaming && (isPersona || isSectionFolder || isDocFolder || isDoc) && (
        <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (menuOpen) {
                setMenuOpen(false);
                return;
              }
              const rect = e.currentTarget.getBoundingClientRect();
              setMenuPos(getFixedMenuPos(rect, 192));
              setMenuOpen(true);
            }}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-700/70"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {(isPersona || isSectionFolder || isDocFolder) && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCreateDoc(item);
                setIsOpen(true);
              }}
              onMouseEnter={(e) => {
                if (!onShowHoverTip) return;
                onShowHoverTip("Add a document", e);
              }}
              onMouseMove={(e) => {
                if (!onShowHoverTip) return;
                onShowHoverTip("Add a document", e);
              }}
              onMouseLeave={() => {
                if (!onHideHoverTip) return;
                onHideHoverTip();
              }}
              className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-700/70"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </span>
      )}
      {isDropTarget && <div className="pointer-events-none absolute left-3 right-3 top-0 h-0.5 bg-blue-500" />}
      {isDragging && <div className="pointer-events-none absolute inset-0 rounded-md bg-blue-500/10" />}
    </div>
  );

  return (
    <div>
      {item.href && item.kind !== "persona" ? <Link href={item.href} className="block">{row}</Link> : row}
      {menuOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
              }}
            />
            <div
              className="fixed z-50 w-48 overflow-x-hidden overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
              style={{
                top: menuPos.top,
                left: menuPos.left,
                maxHeight: menuPos.maxHeight,
                transform: menuPos.placement === "top" ? "translateY(-100%)" : undefined,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCopyLink(item);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-50 dark:hover:bg-zinc-800"
              >
                <Link2 className="h-4 w-4" />
                <span>CopyLink</span>
              </button>
              {!isSectionFolder && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartRename(item);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-50 dark:hover:bg-zinc-800"
                >
                  <Pencil className="h-4 w-4" />
                  <span>Rename</span>
                </button>
              )}
              {isPersona ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const max = typeof personaCount === "number" ? personaCount : 0;
                    const current = typeof personaIndex === "number" ? personaIndex + 1 : 1;
                    const raw = window.prompt(`Move to (1-${max})`, `${current}`)?.trim();
                    const nextPos = raw ? Number.parseInt(raw, 10) : NaN;
                    if (!Number.isFinite(nextPos) || nextPos < 1 || nextPos > max) {
                      setMenuOpen(false);
                      return;
                    }
                    onMovePersonaToIndex(item.id, nextPos - 1);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-50 dark:hover:bg-zinc-800"
                >
                  <Move className="h-4 w-4" />
                  <span>Move to</span>
                </button>
              ) : (
                !isSectionFolder && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveTo(item);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <Move className="h-4 w-4" />
                    <span>Move to</span>
                  </button>
                )
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenInNewTab(item);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-50 dark:hover:bg-zinc-800"
              >
                <ExternalLink className="h-4 w-4" />
                <span>Open in new Tab</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenInSidePeek(item);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-50 dark:hover:bg-zinc-800"
              >
                <Columns className="h-4 w-4" />
                <span>Open in side peek</span>
              </button>
              {(isDoc || isDocFolder || (isPersona && allowPersonaDelete)) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteItem(item);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-500 hover:bg-zinc-100 dark:text-red-400 dark:hover:bg-zinc-800"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Delete</span>
                </button>
              )}
            </div>
          </>,
          document.body
        )}
      {isOpen && hasChildren && (
        <div>
          {item.children!.map((child) => (
            <PersonaNode
              key={child.id}
              item={child}
              depth={depth + 1}
              activeHref={activeHref}
              onCreateDoc={onCreateDoc}
              onMovePersona={onMovePersona}
              onMovePersonaToIndex={onMovePersonaToIndex}
              onStartRename={onStartRename}
              renamingId={renamingId}
              renameValue={renameValue}
              onRenameValueChange={onRenameValueChange}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onCopyLink={onCopyLink}
              onMoveTo={onMoveTo}
              onOpenInNewTab={onOpenInNewTab}
              onOpenInSidePeek={onOpenInSidePeek}
              onDeleteItem={onDeleteItem}
              allowPersonaDelete={allowPersonaDelete}
              draggingDocId={draggingDocId}
              dropTargetId={dropTargetId}
              onDocDragStart={onDocDragStart}
              onDocDragEnd={onDocDragEnd}
              onDropTargetOver={onDropTargetOver}
              onDropTargetLeave={onDropTargetLeave}
              onDropOnTarget={onDropOnTarget}
              personaCount={personaCount}
              onShowHoverTip={onShowHoverTip}
              onHideHoverTip={onHideHoverTip}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChatNode({
  chat,
  active,
  onNavigate,
  onCopyLink,
  onRename,
  onOpenInNewTab,
  onOpenInSidePeek,
  onDelete,
}: {
  chat: GlobalChatRow;
  active: boolean;
  onNavigate: (chatId: string) => void;
  onCopyLink: (chatId: string) => void;
  onRename: (chatId: string) => void;
  onOpenInNewTab: (chatId: string) => void;
  onOpenInSidePeek: (chatId: string) => void;
  onDelete: (chatId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; placement: "top" | "bottom"; maxHeight: number }>({
    top: 0,
    left: 0,
    placement: "bottom",
    maxHeight: 240,
  });
  const title = (chat.title ?? "").toString().trim() || "Untitled";
  return (
    <div className="relative">
      <div
        className={`group relative mx-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer ${
          active
            ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-50 dark:ring-zinc-800"
            : "text-zinc-600 dark:text-zinc-400"
        }`}
        title={title}
        onClick={() => {
          setMenuOpen(false);
          onNavigate(chat.id);
        }}
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (menuOpen) {
                setMenuOpen(false);
                return;
              }
              const rect = e.currentTarget.getBoundingClientRect();
              setMenuPos(getFixedMenuPos(rect, 192));
              setMenuOpen(true);
            }}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-700/70"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </span>
      </div>
      {menuOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
              }}
            />
            <div
              className="fixed z-50 w-48 overflow-x-hidden overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
              style={{
                top: menuPos.top,
                left: menuPos.left,
                maxHeight: menuPos.maxHeight,
                transform: menuPos.placement === "top" ? "translateY(-100%)" : undefined,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCopyLink(chat.id);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-50 dark:hover:bg-zinc-800"
              >
                <Link2 className="h-4 w-4" />
                <span>CopyLink</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRename(chat.id);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-50 dark:hover:bg-zinc-800"
              >
                <Pencil className="h-4 w-4" />
                <span>Rename</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenInNewTab(chat.id);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-50 dark:hover:bg-zinc-800"
              >
                <ExternalLink className="h-4 w-4" />
                <span>Open in new Tab</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenInSidePeek(chat.id);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-50 dark:hover:bg-zinc-800"
              >
                <Columns className="h-4 w-4" />
                <span>Open in side peek</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(chat.id);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-500 hover:bg-zinc-100 dark:text-red-400 dark:hover:bg-zinc-800"
              >
                <Trash2 className="h-4 w-4" />
                <span>Delete</span>
              </button>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

export default function Sidebar({
  onOpenSidePeek,
  chats: externalChats,
  setChats: setExternalChats,
}: {
  onOpenSidePeek?: (href: string) => void;
  chats?: GlobalChatRow[];
  setChats?: Dispatch<SetStateAction<GlobalChatRow[]>>;
} = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const userRef = useRef<UserInfo | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const authReqIdRef = useRef(0);
  const personasLoadedForUserRef = useRef<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [chatList, setChatList] = useState<GlobalChatRow[]>([]);
  const chats = externalChats ?? chatList;
  const setChats = setExternalChats ?? setChatList;
  const [loggingOut, setLoggingOut] = useState(false);
  const [personas, setPersonas] = useState<PersonaItem[]>(() => makeInitialPersonas());
  const [privatePersonas, setPrivatePersonas] = useState<PersonaItem[]>([]);
  const docsScrollRef = useRef<HTMLDivElement | null>(null);
  const [docsScrolled, setDocsScrolled] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [personaDocsById, setPersonaDocsById] = useState<
    Record<
      string,
      Array<{
        id: string;
        title: string | null;
        type: string | null;
        updated_at: string | null;
        persona_id: string | null;
      }>
    >
  >({});
  const [draggingDocId, setDraggingDocId] = useState<string | null>(null);
  const [draggingSourcePersonaId, setDraggingSourcePersonaId] = useState<string | null>(null);
  const [draggingDocSection, setDraggingDocSection] = useState<"persona" | "albums" | "posts" | null>(null);
  const [draggingPersonaId, setDraggingPersonaId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [sectionOrder, setSectionOrder] = useState<Array<"private" | "personas" | "history">>([
    "private",
    "history",
  ]);
  const [activeHeaderMenu, setActiveHeaderMenu] = useState<"private" | "personas" | "history" | "private-plus" | null>(null);
  const [headerMenuPos, setHeaderMenuPos] = useState({ top: 0, left: 0 });
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [hoverTip, setHoverTip] = useState<{ x: number; y: number; visible: boolean; text: string }>({
    x: 0,
    y: 0,
    visible: false,
    text: "",
  });
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [activeBillingCycle, setActiveBillingCycle] = useState<"monthly" | "yearly">("monthly");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpenUpgrade = () => setShowUpgradeModal(true);
    window.addEventListener("aipersona:open-upgrade", onOpenUpgrade);
    return () => {
      window.removeEventListener("aipersona:open-upgrade", onOpenUpgrade);
    };
  }, []);
  const showHoverTip = useCallback((text: string, e: ReactMouseEvent) => {
    const rect = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect?.();
    if (!rect || typeof window === "undefined") {
      setHoverTip({ x: e.clientX + 12, y: e.clientY + 12, visible: true, text });
      return;
    }
    const padding = 8;
    const x = Math.min(rect.right + 12, window.innerWidth - padding);
    const y = Math.min(Math.max(padding, rect.top + rect.height / 2), window.innerHeight - padding);
    setHoverTip({ x, y, visible: true, text });
  }, []);
  const hideHoverTip = useCallback(() => {
    setHoverTip((p) => ({ ...p, visible: false }));
  }, []);

  useEffect(() => {
    if (pathname.startsWith("/board")) {
      setIsCollapsed(true);
    } else {
      setIsCollapsed(false);
    }
  }, [pathname]);

  useEffect(() => {
    const el = docsScrollRef.current;
    if (!el) return;
    const update = () => setDocsScrolled(el.scrollTop > 0);
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [isCollapsed, isHovered]);

  useEffect(() => {
    // Initialize theme
    const savedTheme = localStorage.getItem("theme");
    const isDark = savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) {
        setTheme("dark");
        document.documentElement.classList.add("dark");
    } else {
        setTheme("light");
        document.documentElement.classList.remove("dark");
    }
  }, []);

  useEffect(() => {
    const onProfileUpdated = (event: Event) => {
      const e = event as CustomEvent<{
        userId?: string;
        username?: string | null;
        avatar_url?: string | null;
      }>;
      const detail = e.detail;
      if (!detail) return;

      setUser((prev) => {
        if (!prev) return prev;
        if (prev.id && detail.userId && prev.id !== detail.userId) return prev;
        return {
          ...prev,
          username: detail.username !== undefined ? detail.username : prev.username,
          avatar_url: detail.avatar_url !== undefined ? detail.avatar_url : prev.avatar_url,
        };
      });
    };

    window.addEventListener("aipersona:profile-updated", onProfileUpdated as EventListener);
    return () => {
      window.removeEventListener("aipersona:profile-updated", onProfileUpdated as EventListener);
    };
  }, []);

  const toggleTheme = () => {
    if (theme === "dark") {
        setTheme("light");
        document.documentElement.classList.remove("dark");
        localStorage.setItem("theme", "light");
    } else {
        setTheme("dark");
        document.documentElement.classList.add("dark");
        localStorage.setItem("theme", "dark");
    }
  };

  const personaIndexById = useMemo(() => {
    const map = new Map<string, number>();
    privatePersonas.forEach((p, idx) => map.set(p.id, idx));
    return map;
  }, [privatePersonas]);

  const getPersonaHref = (personaId: string) => `/persona/${personaId}/docs`;

  const refreshPersonaDocs = async (personaIds: string[], opts?: { noCache?: boolean }) => {
    const res = await supabase.auth.getSession();
    const token = res.data.session?.access_token ?? "";
    if (!token) return;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const bust = Date.now();
    const noCache = Boolean(opts?.noCache);

    type PersonaDocRow = {
      id: string;
      title: string | null;
      type: string | null;
      updated_at: string | null;
      persona_id: string | null;
    };

    const docResults = await Promise.all(
      personaIds.map(async (personaId) => {
        const suffix = noCache ? `&noCache=1&ts=${bust}` : "";
        const r = await fetch(`/api/persona-docs?personaId=${encodeURIComponent(personaId)}${suffix}`, { headers });
        if (!r.ok) return { personaId, docs: [] as PersonaDocRow[] };
        const json = (await r.json()) as PersonaDocRow[];
        return { personaId, docs: json ?? [] };
      })
    );
    const privateSuffix = noCache ? `&noCache=1&ts=${bust}` : "";
    const privateRes = await fetch(`/api/persona-docs?personaId=${encodeURIComponent("__private__")}${privateSuffix}`, {
      headers,
    });
    let privateDocs: PersonaDocRow[] = [];
    if (privateRes.ok) {
      try {
        privateDocs = (await privateRes.json()) as PersonaDocRow[];
      } catch {
        privateDocs = [];
      }
    }

    setPersonaDocsById((prev) => {
      const next = { ...prev };
      for (const entry of docResults) next[entry.personaId] = entry.docs;
      next["__private__"] = privateDocs;
      return next;
    });
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        return true;
      } catch {
        return false;
      }
    }
  };

  useEffect(() => {
    let mounted = true;
    const startedAt = Date.now();
    const MAX_WAIT_MS = 4500;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const markResolved = () => {
      if (!mounted) return;
      setAuthResolved(true);
    };

    const clearSignedOut = () => {
      personasLoadedForUserRef.current = null;
      userRef.current = null;
      setUser(null);
      setChats([]);
      setPersonas([]);
      setPrivatePersonas([]);
      markResolved();
    };

    const applySignedInSession = async (session: { user: { id: string; email?: string | null; user_metadata?: unknown }; access_token?: string | null }, opts: { loadPersonas: boolean }) => {
      const reqId = ++authReqIdRef.current;
      const sessionUser = session.user;
      const token = session.access_token ?? "";
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

      const meta = (sessionUser.user_metadata ?? {}) as {
        avatar_url?: string;
        picture?: string;
      };
      const prevUser = userRef.current;
      const baseUser: UserInfo = {
        id: sessionUser.id,
        email: sessionUser.email ?? null,
        avatar_url: meta.avatar_url ?? meta.picture ?? prevUser?.avatar_url ?? null,
        username: prevUser?.id === sessionUser.id ? prevUser?.username ?? null : null,
        credits: prevUser?.id === sessionUser.id ? prevUser?.credits ?? null : null,
      };
      userRef.current = baseUser;
      setUser(baseUser);
      markResolved();

      if (opts.loadPersonas && personasLoadedForUserRef.current !== sessionUser.id) {
        try {
          const fetchPersonas = async () => {
            const r = await fetch("/api/personas", { headers });
            if (!r.ok) return null;
            const json = (await r.json()) as Array<{ id: string; name?: string | null; is_private?: boolean }>;
            return json;
          };

          let personaData = await fetchPersonas();
          if (personaData && personaData.length === 0) {
            await fetch("/api/personas/migrate", { method: "POST", headers });
            personaData = await fetchPersonas();
          }

          if (!mounted || reqId !== authReqIdRef.current) return;

          if (personaData) {
            try {
              const toPrivateIds = personaData.filter((p) => !p.is_private).map((p) => p.id);
              if (toPrivateIds.length > 0 && token) {
                await Promise.all(
                  toPrivateIds.map(async (id) => {
                    try {
                      await fetch(`/api/personas/${encodeURIComponent(id)}`, {
                        method: "PATCH",
                        headers: {
                          Authorization: `Bearer ${token}`,
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ is_private: true }),
                      });
                    } catch {
                      void 0;
                    }
                  })
                );
              }
            } catch {
              void 0;
            }

            const allPersonas = personaData.map((p) => ({
              id: p.id,
              title: p.name || "Untitled Persona",
              kind: "persona" as const,
            }));

            setPersonas([]);
            setPrivatePersonas(allPersonas);

            type PersonaDocRow = {
              id: string;
              title: string | null;
              type: string | null;
              updated_at: string | null;
              persona_id: string | null;
            };

            const docResults = await Promise.all(
              allPersonas.map(async (p) => {
                try {
                  const r = await fetch(`/api/persona-docs?personaId=${encodeURIComponent(p.id)}`, { headers });
                  if (!r.ok) return { personaId: p.id, docs: [] as PersonaDocRow[], ok: false };
                  const json = (await r.json()) as PersonaDocRow[];
                  return { personaId: p.id, docs: json ?? [], ok: true };
                } catch {
                  return { personaId: p.id, docs: [] as PersonaDocRow[], ok: false };
                }
              })
            );
            let privateDocs: PersonaDocRow[] = [];
            let privateDocsOk = false;
            try {
              const pr = await fetch(`/api/persona-docs?personaId=${encodeURIComponent("__private__")}`, { headers });
              if (pr.ok) {
                privateDocs = (await pr.json()) as PersonaDocRow[];
                privateDocsOk = true;
              }
            } catch {
              privateDocs = [];
              privateDocsOk = false;
            }

            const needsCacheFallback = docResults.some((r) => !r.ok) || !privateDocsOk;
            let cachedDocs: BoardCacheDoc[] = [];
            if (needsCacheFallback) {
              try {
                const db = await openBoardCacheDb();
                cachedDocs = await readBoardCachedDocs(db, sessionUser.id);
              } catch {
                cachedDocs = [];
              }
            }
            const cachedByPersonaId: Record<string, PersonaDocRow[]> = {};
            if (cachedDocs.length > 0) {
              for (const d of cachedDocs) {
                const pid = (d.persona_id ?? "__private__") || "__private__";
                const row: PersonaDocRow = {
                  id: d.id,
                  title: d.title ?? null,
                  type: d.type ?? null,
                  updated_at: d.updated_at ?? null,
                  persona_id: d.persona_id ?? null,
                };
                (cachedByPersonaId[pid] ??= []).push(row);
              }
            }

            if (!mounted || reqId !== authReqIdRef.current) return;

            setPersonaDocsById((prev) => {
              const next = { ...prev };
              for (const entry of docResults) {
                if (entry.ok) next[entry.personaId] = entry.docs;
                else if (cachedByPersonaId[entry.personaId]) next[entry.personaId] = cachedByPersonaId[entry.personaId]!;
                else next[entry.personaId] = [];
              }
              if (privateDocsOk) next["__private__"] = privateDocs;
              else if (cachedByPersonaId["__private__"]) next["__private__"] = cachedByPersonaId["__private__"]!;
              else next["__private__"] = [];
              return next;
            });
            try {
              const allDocs: BoardCacheDoc[] = [];
              for (const entry of docResults) {
                for (const d of entry.docs) {
                  allDocs.push({
                    id: d.id,
                    title: d.title,
                    updated_at: d.updated_at,
                    persona_id: d.persona_id,
                    type: d.type,
                  });
                }
              }
              for (const d of privateDocs) {
                allDocs.push({
                  id: d.id,
                  title: d.title,
                  updated_at: d.updated_at,
                  persona_id: d.persona_id,
                  type: d.type,
                });
              }
              if (allDocs.length > 0) {
                const db = await openBoardCacheDb();
                await writeBoardCachedDocs(db, sessionUser.id, allDocs);
              }
            } catch {
              void 0;
            }
            personasLoadedForUserRef.current = sessionUser.id;
          } else {
            setPersonas([]);
            setPrivatePersonas([]);
            personasLoadedForUserRef.current = sessionUser.id;
          }
        } catch (e) {
          console.error("Error loading personas", e);
        }
      }

      try {
        const { data: profileRow } = await supabase
          .from("users")
          .select("avatar, username, credits")
          .eq("id", sessionUser.id)
          .single();
        if (!mounted || reqId !== authReqIdRef.current) return;
        const nextUser = {
          ...baseUser,
          avatar_url: profileRow?.avatar ?? baseUser.avatar_url ?? null,
          username: profileRow?.username ?? baseUser.username ?? null,
          credits: typeof profileRow?.credits === "number" ? profileRow.credits : baseUser.credits ?? null,
        };
        userRef.current = nextUser;
        setUser(nextUser);
      } catch {
        if (!mounted || reqId !== authReqIdRef.current) return;
        userRef.current = baseUser;
        setUser(baseUser);
      }

      try {
        const res = await fetch("/api/settings/usage?limit=1", { headers });
        if (!mounted || reqId !== authReqIdRef.current) return;
        if (res.ok) {
          const json = (await res.json()) as { credits?: number };
          const credits =
            typeof json?.credits === "number" && Number.isFinite(json.credits) ? json.credits : null;
          if (credits !== null) {
            const prev = userRef.current ?? baseUser;
            const nextUser = { ...prev, credits };
            userRef.current = nextUser;
            setUser(nextUser);
          }
        }
      } catch {
        void 0;
      }

      {
        try {
          const { data: chatsData, error } = await supabase
            .from("chats")
            .select("id, title, created_at")
            .eq("user_id", sessionUser.id)
            .order("created_at", { ascending: false });

          if (!mounted || reqId !== authReqIdRef.current) return;
          if (!error && chatsData) {
            setChats(chatsData);
          }
        } catch {
          if (!mounted || reqId !== authReqIdRef.current) return;
        }
      }
    };

    const scheduleRetry = (delayMs: number) => {
      if (!mounted) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        void loadSession();
      }, delayMs);
    };

    const loadSession = async () => {
      const { session } = await getSessionWithTimeout({ timeoutMs: 1200, retries: 2, retryDelayMs: 140 });
      if (!mounted) return;
      if (session?.user) {
        await applySignedInSession(session as unknown as { user: { id: string; email?: string | null; user_metadata?: unknown }; access_token?: string | null }, { loadPersonas: true });
        return;
      }
      if (Date.now() - startedAt >= MAX_WAIT_MS) {
        if (!userRef.current) clearSignedOut();
        else markResolved();
        return;
      }
      scheduleRetry(500);
    };

    const awardDailyCredits = async (_uid: string) => {
      void _uid;
    };
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      const sessionUser = session?.user ?? null;
      if (!sessionUser) {
        if (event === "SIGNED_OUT") {
          clearSignedOut();
          return;
        }
        if (Date.now() - startedAt >= MAX_WAIT_MS && !userRef.current) {
          clearSignedOut();
          return;
        }
        scheduleRetry(600);
        return;
      }

      await applySignedInSession(session as unknown as { user: { id: string; email?: string | null; user_metadata?: unknown }; access_token?: string | null }, { loadPersonas: event === "SIGNED_IN" });
      if (event === "SIGNED_IN") {
        await awardDailyCredits(sessionUser.id);
      }
    });
    void loadSession();
    return () => {
      mounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      sub?.subscription.unsubscribe();
    };
  }, []);

  const personaIdsKey = useMemo(() => personas.map((p) => p.id).join("|"), [personas]);

  useEffect(() => {
    void refreshPersonaDocs(personas.map((p) => p.id));
  }, [pathname, personaIdsKey]);

  const initial = useMemo(() => {
    const source =
      user?.email?.trim() ||
      (user?.avatar_url ? "U" : undefined) ||
      undefined;
    return source ? source.charAt(0).toUpperCase() : "?";
  }, [user]);

  const isPaidUser = typeof user?.credits === "number";

  const buildCheckoutUrl = (planId: PlanId): string | null => {
    const baseUrl =
      (useTestStripeLinks ? TEST_PLAN_CHECKOUT_URLS[planId] : undefined) ??
      LIVE_PLAN_CHECKOUT_URLS[planId];
    if (!baseUrl) return null;
    const userId = (user?.id ?? "").toString().trim();
    if (!userId) return baseUrl;
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}client_reference_id=${encodeURIComponent(userId)}`;
  };

  const shouldHideSidebar =
    pathname === "/landing" ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/pricing" ||
    pathname === "/use-cases" ||
    pathname === "/doc" ||
    pathname.startsWith("/doc/") ||
    pathname.startsWith("/blog");

  const onLogoutClick = () => {
    setMenuOpen(false);
    setShowLogoutModal(true);
  };

  const confirmLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const signOutPromise = supabase.auth.signOut({ scope: "local" }).catch((error) => ({
        error,
      }));
      const result = await Promise.race([
        signOutPromise,
        new Promise<void>((resolve) => {
          setTimeout(() => resolve(), 2000);
        }),
      ]);
      if (result && "error" in result && result.error) {
        throw result.error;
      }
    } catch (error) {
      console.error("Error signing out:", error);
    } finally {
      setShowLogoutModal(false);
      setMenuOpen(false);
      setChats([]);
      userRef.current = null;
      setUser(null);
      setLoggingOut(false);
      router.push('/landing');
      router.refresh();
    }
  };

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

  const buildDocsTreeChildren = (personaId: string, sectionType: "persona" | "albums" | "posts") => {
    const rows = (personaDocsById[personaId] ?? []).filter((r) => normalizePersonaDocType(r.type) === sectionType);
    const sectionRootDbId =
      sectionType === "persona"
        ? makePersonaDocDbId(personaId, "persona-docs")
        : makePersonaDocDbId(personaId, sectionType);
    const cleaned = rows.map((r) => {
      const { meta } = parseTypeMeta(r.type);
      const cleanId = getCleanPersonaDocId(personaId, r.id);
      const isFolder = meta.folder === "1" || cleanId.startsWith("folder-");
      const rawParent = (meta.parent ?? "").toString().trim();
      const candidateParentDbId = rawParent
        ? rawParent.startsWith(`${personaId}-`)
          ? rawParent
          : makePersonaDocDbId(personaId, rawParent)
        : null;
      const parentDbId = candidateParentDbId === sectionRootDbId ? null : candidateParentDbId;
      return {
        ...r,
        cleanId,
        isFolder,
        parentDbId,
      };
    });

    const childrenByParent = new Map<string | null, typeof cleaned>();
    for (const row of cleaned) {
      const key = row.parentDbId;
      const list = childrenByParent.get(key);
      if (list) list.push(row);
      else childrenByParent.set(key, [row]);
    }

    const sortRows = (arr: typeof cleaned) => {
      arr.sort((a, b) => {
        const aIsFolder = a.isFolder ? 1 : 0;
        const bIsFolder = b.isFolder ? 1 : 0;
        if (aIsFolder !== bIsFolder) return bIsFolder - aIsFolder;
        const aTime = a.updated_at ? Date.parse(a.updated_at) : 0;
        const bTime = b.updated_at ? Date.parse(b.updated_at) : 0;
        return bTime - aTime;
      });
    };

    for (const [, list] of childrenByParent) sortRows(list);

    const seen = new Set<string>();
    const buildNode = (row: (typeof cleaned)[number]): PersonaItem => {
      const href = row.isFolder
        ? `/persona/${encodeURIComponent(personaId)}/${encodeURIComponent(
            sectionType === "persona" ? "docs" : sectionType
          )}?folder=${encodeURIComponent(row.cleanId)}`
        : `/persona/${encodeURIComponent(personaId)}/docs/${encodeURIComponent(row.cleanId)}`;
      const childRows = row.isFolder ? (childrenByParent.get(row.id) ?? []) : [];

      const next: PersonaItem = {
        id: row.id,
        title: row.title ?? "Untitled",
        kind: row.isFolder ? "folder" : "doc",
        href,
        meta: {
          personaId,
          section: sectionType,
          dbId: row.id,
          isFolder: row.isFolder,
          folderKind: row.isFolder ? "doc" : undefined,
        },
      };

      if (row.isFolder && childRows.length > 0 && !seen.has(row.id)) {
        seen.add(row.id);
        next.children = childRows.map(buildNode);
      }

      return next;
    };

    const roots = [...(childrenByParent.get(null) ?? []), ...(childrenByParent.get(sectionRootDbId) ?? [])];
    const uniqRoots = Array.from(new Map(roots.map((r) => [r.id, r])).values());
    return uniqRoots.map(buildNode);
  };

  const personaTree = useMemo(() => {
    return personas.map((p) => {
      const baseChildren = buildDefaultPersonaChildren(p.id);
      const docsFolder = baseChildren.find((c) => c.meta?.folderKind === "section" && c.meta.section === "persona");
      if (docsFolder) docsFolder.children = buildDocsTreeChildren(p.id, "persona");
      const albumsFolder = baseChildren.find((c) => c.meta?.folderKind === "section" && c.meta.section === "albums");
      if (albumsFolder) albumsFolder.children = buildDocsTreeChildren(p.id, "albums");
      const postsFolder = baseChildren.find((c) => c.meta?.folderKind === "section" && c.meta.section === "posts");
      if (postsFolder) postsFolder.children = buildDocsTreeChildren(p.id, "posts");
      return { ...p, children: baseChildren };
    });
  }, [personas, personaDocsById]);

  const privatePersonaTree = useMemo(() => {
    return privatePersonas.map((p) => {
      const baseChildren = buildDefaultPersonaChildren(p.id);
      const docsFolder = baseChildren.find((c) => c.meta?.folderKind === "section" && c.meta.section === "persona");
      if (docsFolder) docsFolder.children = buildDocsTreeChildren(p.id, "persona");
      const albumsFolder = baseChildren.find((c) => c.meta?.folderKind === "section" && c.meta.section === "albums");
      if (albumsFolder) albumsFolder.children = buildDocsTreeChildren(p.id, "albums");
      const postsFolder = baseChildren.find((c) => c.meta?.folderKind === "section" && c.meta.section === "posts");
      if (postsFolder) postsFolder.children = buildDocsTreeChildren(p.id, "posts");
      return { ...p, badge: "Persona", children: baseChildren };
    });
  }, [privatePersonas, personaDocsById]);

  const startRename = (item: PersonaItem) => {
    setRenamingId(item.id);
    setRenameValue(item.title);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const commitRename = async (item: PersonaItem) => {
    if (!renamingId || item.id !== renamingId) return;
    const title = renameValue.trim();
    if (!title) {
      cancelRename();
      return;
    }

    if (item.kind === "persona") {
      setPersonas((prev) => prev.map((p) => (p.id === item.id ? { ...p, title } : p)));
      setPrivatePersonas((prev) => prev.map((p) => (p.id === item.id ? { ...p, title } : p)));
      cancelRename();
      void (async () => {
        try {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token ?? "";
          if (!token) return;
          await fetch(`/api/personas/${encodeURIComponent(item.id)}`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ name: title }),
          });
        } catch {
          void 0;
        }
      })();
      return;
    }

    const dbId = item.meta?.dbId;
    const personaId = item.meta?.personaId;
    if (!dbId || !personaId) {
      cancelRename();
      return;
    }

    const nowIso = new Date().toISOString();
    setPersonaDocsById((prev) => {
      const list = prev[personaId] ?? [];
      return {
        ...prev,
        [personaId]: list.map((d) => (d.id === dbId ? { ...d, title, updated_at: nowIso } : d)),
      };
    });
    cancelRename();
    void (async () => {
      const q = supabase.from("persona_docs").update({ title, updated_at: nowIso }).eq("id", dbId);
      if (personaId === "__private__") {
        await q.is("persona_id", null);
      } else {
        await q.eq("persona_id", personaId);
      }
    })();
  };

  const createDocInContainer = async (target: PersonaItem) => {
    if (target.kind === "persona") {
      const personaId = target.id;
      const docId = `new-${Date.now()}`;
      const dbId = makePersonaDocDbId(personaId, docId);
      const nowIso = new Date().toISOString();
      const type = `persona;folder=0;parent=`;

      const { error } = await supabase.from("persona_docs").upsert({
        id: dbId,
        persona_id: personaId,
        title: "Untitled",
        content: "",
        type,
        updated_at: nowIso,
      });

      if (error) return;

      setPersonaDocsById((prev) => {
        const next = prev[personaId] ?? [];
        return {
          ...prev,
          [personaId]: [{ id: dbId, title: "Untitled", type, updated_at: nowIso, persona_id: personaId }, ...next],
        };
      });
      return;
    }

    if (target.kind !== "folder") return;
    const meta = target.meta;
    const personaId = meta?.personaId;
    const sectionType = meta?.section;
    if (!meta || !personaId || !sectionType) return;
    const parentDbId = meta.folderKind === "doc" ? (meta.dbId ?? null) : null;
    const docId = `new-${Date.now()}`;
    const dbId = makePersonaDocDbId(personaId, docId);
    const nowIso = new Date().toISOString();
    const type = `${sectionType};folder=0;parent=${parentDbId ?? ""}`;
    const title =
      sectionType === "posts" ? "Untitled Post" : sectionType === "albums" ? "Untitled Album" : "Untitled";

    const { error } = await supabase.from("persona_docs").upsert({
      id: dbId,
      persona_id: personaId,
      title,
      content: "",
      type,
      updated_at: nowIso,
    });

    if (error) return;

    setPersonaDocsById((prev) => {
      const next = prev[personaId] ?? [];
      return {
        ...prev,
        [personaId]: [{ id: dbId, title, type, updated_at: nowIso, persona_id: personaId }, ...next],
      };
    });
  };

  const moveItemToFolder = async (target: PersonaItem) => {
    if (target.kind === "persona") return;
    if (target.meta?.folderKind === "section") return;
    const personaId = target.meta?.personaId;
    const dbId = target.meta?.dbId;
    const sectionType = target.meta?.section;
    if (!personaId || !dbId || !sectionType) return;

    const list = personaDocsById[personaId] ?? [];
    const sourceRow = list.find((r) => r.id === dbId) ?? null;
    const sourceType = sourceRow?.type ?? null;
    if (!sourceType) return;

    const folders = list
      .filter((r) => normalizePersonaDocType(r.type) === sectionType)
      .map((r) => {
        const { meta } = parseTypeMeta(r.type);
        const cleanId = getCleanPersonaDocId(personaId, r.id);
        const isFolder = meta.folder === "1" || cleanId.startsWith("folder-");
        return { id: r.id, title: r.title ?? "Untitled", cleanId, isFolder };
      })
      .filter((r) => r.isFolder && r.id !== dbId)
      .sort((a, b) => a.title.localeCompare(b.title));

    const help = folders
      .slice(0, 20)
      .map((f) => `- ${f.title} (${f.cleanId})`)
      .join("\n");

    const raw = window
      .prompt(`Move to folder (enter clean id, or "root")\n${help}`, "root")
      ?.trim();
    if (!raw) return;

    const targetParentDbId =
      raw === "root" || raw === "/" || raw === "." || raw === "null"
        ? null
        : folders.find((f) => f.cleanId === raw || f.id === raw)?.id ?? null;

    if (targetParentDbId === undefined) return;
    if (targetParentDbId === dbId) return;

    const nowIso = new Date().toISOString();
    const nextType = updateTypeParent(sourceType, targetParentDbId);
    const q = supabase.from("persona_docs").update({ type: nextType, updated_at: nowIso }).eq("id", dbId);
    const { error } =
      personaId === "__private__" ? await q.is("persona_id", null) : await q.eq("persona_id", personaId);
    if (error) return;

    setPersonaDocsById((prev) => {
      const nextList = prev[personaId] ?? [];
      return {
        ...prev,
        [personaId]: nextList.map((r) => (r.id === dbId ? { ...r, type: nextType, updated_at: nowIso } : r)),
      };
    });
  };

  const getItemHref = (item: PersonaItem) => {
    if (item.kind === "persona") return getPersonaHref(item.id);
    return item.href ?? "";
  };

  const copyItemLink = (item: PersonaItem) => {
    const href = getItemHref(item);
    const absolute = typeof window !== "undefined" ? new URL(href, window.location.origin).toString() : href;
    void copyText(absolute);
  };

  const copyChatLink = (chatId: string) => {
    const href = `/chat/${encodeURIComponent(chatId)}`;
    const absolute = typeof window !== "undefined" ? new URL(href, window.location.origin).toString() : href;
    void copyText(absolute);
  };

  const renameChat = async (chatId: string) => {
    const current = (chats ?? []).find((c) => c.id === chatId)?.title ?? "";
    const next = window.prompt("Rename chat", (current ?? "").toString())?.trim();
    if (!next) return;
    const currentUserId = user?.id ?? null;
    if (!currentUserId) return;
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: next } : c)));
    try {
      await supabase.from("chats").update({ title: next }).eq("id", chatId).eq("user_id", currentUserId);
    } catch {
      void 0;
    }
  };

  const deleteChat = async (chatId: string) => {
    const currentUserId = user?.id ?? null;
    if (!currentUserId) return;
    try {
      await supabase.from("chats").delete().eq("id", chatId).eq("user_id", currentUserId);
    } catch {
      void 0;
    }
    setChats((prev) => prev.filter((c) => c.id !== chatId));
    if (pathname === `/chat/${chatId}` || pathname.startsWith(`/chat/${chatId}/`)) {
      router.push("/chat/new");
    }
  };

  const openChatInNewTab = (chatId: string) => {
    const href = `/chat/${encodeURIComponent(chatId)}`;
    window.open(href, "_blank", "noopener,noreferrer");
  };

  const openChatInSidePeek = (chatId: string) => {
    const href = `/chat/${encodeURIComponent(chatId)}`;
    onOpenSidePeek?.(href);
  };

  const openItemInNewTab = (item: PersonaItem) => {
    const href = getItemHref(item);
    if (!href) return;
    window.open(href, "_blank", "noopener,noreferrer");
  };

  const openItemInSidePeek = (item: PersonaItem) => {
    const href = getItemHref(item);
    if (!href) return;
    onOpenSidePeek?.(href);
  };

  const deletePersonaItem = async (item: PersonaItem) => {
    if (item.kind === "persona") {
      const personaId = item.id;
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? "";
        if (!token) return;
        await fetch(`/api/personas/${encodeURIComponent(personaId)}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } catch {
        void 0;
      }
      try {
        await supabase.from("persona_docs").delete().eq("persona_id", personaId);
      } catch {
        void 0;
      }
      setPersonas((prev) => prev.filter((p) => p.id !== personaId));
      setPrivatePersonas((prev) => prev.filter((p) => p.id !== personaId));
      setPersonaDocsById((prev) => {
        const next = { ...prev };
        delete next[personaId];
        return next;
      });
      if (pathname === `/persona/${personaId}` || pathname.startsWith(`/persona/${personaId}/`)) {
        router.push("/home");
      }
      return;
    }
    const dbId = item.meta?.dbId ?? item.id;
    const personaKey = item.meta?.personaId === "__private__" ? "__private__" : item.meta?.personaId ?? null;
    if (!dbId || !personaKey) return;
    const list = personaDocsById[personaKey] ?? [];
    const sourceRow = list.find((d) => d.id === dbId) ?? null;
    if (!sourceRow) return;
    const parsed = parseTypeMeta(sourceRow.type);
    const baseType = normalizePersonaDocType(sourceRow.type);
    const isFolder =
      (parsed.meta.folder ?? "") === "1" ||
      (item.kind === "folder" && item.meta?.folderKind === "doc");

    if (isFolder) {
      const childIdsByParent = new Map<string | null, string[]>();
      for (const row of list) {
        if (normalizePersonaDocType(row.type) !== baseType) continue;
        const p = parseTypeMeta(row.type);
        const parentRaw = (p.meta.parent ?? "").toString();
        const parentId = parentRaw ? parentRaw : null;
        const arr = childIdsByParent.get(parentId) ?? [];
        arr.push(row.id);
        childIdsByParent.set(parentId, arr);
      }
      const subtreeIds: string[] = [];
      const stack: string[] = [dbId];
      const seen = new Set<string>();
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (seen.has(current)) continue;
        seen.add(current);
        subtreeIds.push(current);
        const kids = childIdsByParent.get(current) ?? [];
        for (const k of kids) stack.push(k);
      }
      const q = supabase.from("persona_docs").delete().in("id", subtreeIds);
      const { error } =
        personaKey === "__private__" ? await q.is("persona_id", null) : await q.eq("persona_id", personaKey);
      if (error) return;
      setPersonaDocsById((prev) => {
        const nextList = (prev[personaKey] ?? []).filter((d) => !seen.has(d.id));
        return { ...prev, [personaKey]: nextList };
      });
      return;
    }

    const q = supabase.from("persona_docs").delete().eq("id", dbId);
    const { error } = personaKey === "__private__" ? await q.is("persona_id", null) : await q.eq("persona_id", personaKey);
    if (error) return;
    setPersonaDocsById((prev) => {
      const nextList = (prev[personaKey] ?? []).filter((d) => d.id !== dbId);
      return { ...prev, [personaKey]: nextList };
    });
  };

  const updateTypeParent = (raw: string | null | undefined, nextParentDbId: string | null) => {
    const parsed = parseTypeMeta(raw);
    const base = parsed.base || "persona";
    const meta = { ...parsed.meta };
    meta.parent = nextParentDbId ? nextParentDbId : "";
    if (!("folder" in meta)) meta.folder = "0";
    const keys = Object.keys(meta);
    const parts = [base, ...keys.map((k) => `${k}=${meta[k]}`)];
    return parts.join(";");
  };

  const moveDocToTarget = async (
    docDbId: string,
    sourcePersonaId: string,
    targetPersonaId: string,
    targetParentDbId: string | null,
    targetSection: "persona" | "albums" | "posts" | null
  ) => {
    const { data: sourceRow, error: readError } = await supabase
      .from("persona_docs")
      .select("*")
      .eq("id", docDbId)
      .eq("persona_id", sourcePersonaId)
      .maybeSingle();

    if (readError || !sourceRow) return;

    const baseType = normalizePersonaDocType(sourceRow.type);
    if (baseType !== "persona" && baseType !== "albums" && baseType !== "posts") return;
    if (targetSection && baseType !== targetSection) return;

    const { meta } = parseTypeMeta(sourceRow.type);
    const clean = getCleanPersonaDocId(sourcePersonaId, sourceRow.id);
    const isFolder = meta.folder === "1" || clean.startsWith("folder-") || Boolean(sourceRow.is_folder);
    if (targetParentDbId && targetParentDbId === sourceRow.id) return;
    if (isFolder && sourcePersonaId !== targetPersonaId) return;

    const nowIso = new Date().toISOString();
    const nextType = updateTypeParent(sourceRow.type, targetParentDbId);

    if (sourcePersonaId === targetPersonaId) {
      const { error } = await supabase
        .from("persona_docs")
        .update({ type: nextType, updated_at: nowIso })
        .eq("id", sourceRow.id)
        .eq("persona_id", sourcePersonaId);
      if (error) return;

      setPersonaDocsById((prev) => {
        const list = prev[sourcePersonaId] ?? [];
        return {
          ...prev,
          [sourcePersonaId]: list.map((d) => (d.id === sourceRow.id ? { ...d, type: nextType, updated_at: nowIso } : d)),
        };
      });
      return;
    }

    const nextDbId = makePersonaDocDbId(targetPersonaId, clean);
    const { error: upsertError } = await supabase.from("persona_docs").upsert({
      id: nextDbId,
      persona_id: targetPersonaId,
      title: sourceRow.title ?? "Untitled",
      content: sourceRow.content ?? "",
      type: nextType,
      updated_at: nowIso,
    });
    if (upsertError) return;

    const { error: deleteError } = await supabase
      .from("persona_docs")
      .delete()
      .eq("id", sourceRow.id)
      .eq("persona_id", sourcePersonaId);
    if (deleteError) return;

    setPersonaDocsById((prev) => {
      const fromList = (prev[sourcePersonaId] ?? []).filter((d) => d.id !== sourceRow.id);
      const toList = prev[targetPersonaId] ?? [];
      const nextRow = {
        id: nextDbId,
        title: (sourceRow.title ?? "Untitled") as string,
        type: nextType,
        updated_at: nowIso,
        persona_id: targetPersonaId,
      };
      return {
        ...prev,
        [sourcePersonaId]: fromList,
        [targetPersonaId]: [nextRow, ...toList],
      };
    });
  };

  const getCleanIdFromKnownPersonaPrefix = (dbId: string) => {
    const knownPersonaIds = [...personas, ...privatePersonas].map((p) => p.id);
    for (const personaId of knownPersonaIds) {
      if (dbId.startsWith(`${personaId}-`)) return dbId.slice(personaId.length + 1);
    }
    return dbId;
  };

  const movePrivateDocToTarget = async (
    docDbId: string,
    targetPersonaId: string,
    targetParentDbId: string | null,
    targetSection: "persona" | "albums" | "posts" | null
  ) => {
    const { data: sourceRow, error: readError } = await supabase
      .from("persona_docs")
      .select("*")
      .eq("id", docDbId)
      .is("persona_id", null)
      .maybeSingle();

    if (readError || !sourceRow) return;

    const baseType = normalizePersonaDocType(sourceRow.type);
    if (baseType !== "persona" && baseType !== "albums" && baseType !== "posts") return;
    if (targetSection && baseType !== targetSection) return;

    const { meta } = parseTypeMeta(sourceRow.type);
    const isFolder = meta.folder === "1" || docDbId.includes("folder-") || Boolean(sourceRow.is_folder);
    if (targetParentDbId && targetParentDbId === sourceRow.id) return;

    const nowIso = new Date().toISOString();

    if (!isFolder) {
      const clean = getCleanIdFromKnownPersonaPrefix(sourceRow.id);
      const nextDbId = makePersonaDocDbId(targetPersonaId, clean);
      const nextType = updateTypeParent(sourceRow.type, targetParentDbId);

      if (nextDbId === sourceRow.id) {
        const { error } = await supabase
          .from("persona_docs")
          .update({ persona_id: targetPersonaId, type: nextType, updated_at: nowIso })
          .eq("id", sourceRow.id)
          .is("persona_id", null);
        if (error) return;
      } else {
        const { error: upsertError } = await supabase.from("persona_docs").upsert({
          id: nextDbId,
          persona_id: targetPersonaId,
          title: sourceRow.title ?? "Untitled",
          content: sourceRow.content ?? "",
          type: nextType,
          updated_at: nowIso,
        });
        if (upsertError) return;

        const { error: deleteError } = await supabase.from("persona_docs").delete().eq("id", sourceRow.id).is("persona_id", null);
        if (deleteError) return;
      }

      setPersonaDocsById((prev) => {
        const fromList = (prev["__private__"] ?? []).filter((d) => d.id !== sourceRow.id);
        const toList = prev[targetPersonaId] ?? [];
        const nextRow = {
          id: nextDbId,
          title: (sourceRow.title ?? "Untitled") as string,
          type: nextType,
          updated_at: nowIso,
          persona_id: targetPersonaId,
        };
        return {
          ...prev,
          ["__private__"]: fromList,
          [targetPersonaId]: [nextRow, ...toList.filter((d) => d.id !== nextDbId)],
        };
      });

      void refreshPersonaDocs([targetPersonaId], { noCache: true });
      return;
    }

    const { data: privateRows, error: listError } = await supabase
      .from("persona_docs")
      .select("*")
      .is("persona_id", null)
      .like("type", `${baseType}%`);

    if (listError || !privateRows) return;

    const rows = privateRows as Array<{
      id: string;
      title: string | null;
      content: string | null;
      type: string | null;
      updated_at: string | null;
      persona_id: string | null;
      is_folder?: boolean | null;
    }>;

    const idSet = new Set<string>(rows.map((r) => r.id));
    const idByCleanId = new Map<string, string>();
    for (const row of rows) {
      idByCleanId.set(getCleanIdFromKnownPersonaPrefix(row.id), row.id);
    }

    const childIdsByParent = new Map<string | null, string[]>();
    for (const row of rows) {
      if (normalizePersonaDocType(row.type) !== baseType) continue;
      const parsed = parseTypeMeta(row.type);
      const parentRaw = (parsed.meta.parent ?? "").toString().trim();
      const resolvedParent = parentRaw
        ? idSet.has(parentRaw)
          ? parentRaw
          : (idByCleanId.get(parentRaw) ?? parentRaw)
        : null;
      const arr = childIdsByParent.get(resolvedParent) ?? [];
      arr.push(row.id);
      childIdsByParent.set(resolvedParent, arr);
    }

    const subtreeIds: string[] = [];
    const stack: string[] = [sourceRow.id];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      subtreeIds.push(current);
      const kids = childIdsByParent.get(current) ?? [];
      for (const k of kids) stack.push(k);
    }

    const subtreeRows = rows.filter((r) => seen.has(r.id));
    if (subtreeRows.length === 0) return;

    const newIdByOldId = new Map<string, string>();
    const newIdByOldCleanId = new Map<string, string>();
    for (const r of subtreeRows) {
      const clean = getCleanIdFromKnownPersonaPrefix(r.id);
      const nextId = makePersonaDocDbId(targetPersonaId, clean);
      newIdByOldId.set(r.id, nextId);
      newIdByOldCleanId.set(clean, nextId);
    }

    const nextRows = subtreeRows.map((r) => {
      const parsed = parseTypeMeta(r.type);
      const parentRaw = (parsed.meta.parent ?? "").toString().trim();
      const resolvedParent =
        parentRaw && (newIdByOldId.get(parentRaw) ?? newIdByOldCleanId.get(parentRaw) ?? null);
      const parentDbId = r.id === sourceRow.id ? targetParentDbId : resolvedParent;
      const nextType = updateTypeParent(r.type, parentDbId);
      return {
        id: newIdByOldId.get(r.id) ?? r.id,
        persona_id: targetPersonaId,
        title: r.title ?? "Untitled",
        content: r.content ?? "",
        type: nextType,
        updated_at: nowIso,
      };
    });

    const { error: upsertError } = await supabase.from("persona_docs").upsert(nextRows);
    if (upsertError) return;

    const { error: deleteError } = await supabase.from("persona_docs").delete().in("id", subtreeIds).is("persona_id", null);
    if (deleteError) return;

    setPersonaDocsById((prev) => {
      const fromList = (prev["__private__"] ?? []).filter((d) => !seen.has(d.id));
      const toList = prev[targetPersonaId] ?? [];
      const nextToList = [...toList];
      for (const nr of nextRows) {
        nextToList.unshift({
          id: nr.id,
          title: nr.title,
          type: nr.type,
          updated_at: nr.updated_at,
          persona_id: targetPersonaId,
        });
      }
      const dedup = new Map<string, (typeof nextToList)[number]>();
      for (const row of nextToList) dedup.set(row.id, row);
      return {
        ...prev,
        ["__private__"]: fromList,
        [targetPersonaId]: Array.from(dedup.values()),
      };
    });

    void refreshPersonaDocs([targetPersonaId], { noCache: true });
  };

  const movePersonaToPrivate = async (personaId: string) => {
    const title =
      personas.find((p) => p.id === personaId)?.title ??
      privatePersonas.find((p) => p.id === personaId)?.title ??
      "Untitled Persona";
    setPersonas((prev) => prev.filter((p) => p.id !== personaId));
    setPrivatePersonas((prev) => {
      const existing = prev.find((p) => p.id === personaId) ?? null;
      if (existing) return prev;
      return [{ id: personaId, title, kind: "persona" as const }, ...prev];
    });

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? "";
      if (!token) return;

      const res = await fetch(`/api/personas/${encodeURIComponent(personaId)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ is_private: true }),
      });
      if (!res.ok) {
        const { data: next } = await supabase.auth.getSession();
        const nextToken = next.session?.access_token ?? "";
        if (!nextToken) return;
        const headers: Record<string, string> = { Authorization: `Bearer ${nextToken}` };
        try {
          const r = await fetch("/api/personas", { headers });
          if (!r.ok) return;
          const json = (await r.json()) as Array<{ id: string; name?: string | null; is_private?: boolean }>;
          const publicPersonas = (json ?? [])
            .filter((p) => !p.is_private)
            .map((p) => ({ id: p.id, title: p.name || "Untitled Persona", kind: "persona" as const }));
          const privateLoaded = (json ?? [])
            .filter((p) => Boolean(p.is_private))
            .map((p) => ({ id: p.id, title: p.name || "Untitled Persona", kind: "persona" as const }));
          setPersonas(publicPersonas);
          setPrivatePersonas(privateLoaded);
        } catch {
          void 0;
        }
        return;
      }
    } catch {
      void 0;
    }
  };

  const movePersonaToPublic = async (personaId: string) => {
    const title =
      personas.find((p) => p.id === personaId)?.title ??
      privatePersonas.find((p) => p.id === personaId)?.title ??
      "Untitled Persona";
    setPrivatePersonas((prev) => prev.filter((p) => p.id !== personaId));
    setPersonas((prev) => {
      const existing = prev.find((p) => p.id === personaId) ?? null;
      if (existing) return prev;
      return [{ id: personaId, title, kind: "persona" as const }, ...prev];
    });

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? "";
      if (!token) return;

      const res = await fetch(`/api/personas/${encodeURIComponent(personaId)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ is_private: false }),
      });
      if (!res.ok) {
        const { data: next } = await supabase.auth.getSession();
        const nextToken = next.session?.access_token ?? "";
        if (!nextToken) return;
        const headers: Record<string, string> = { Authorization: `Bearer ${nextToken}` };
        try {
          const r = await fetch("/api/personas", { headers });
          if (!r.ok) return;
          const json = (await r.json()) as Array<{ id: string; name?: string | null; is_private?: boolean }>;
          const publicPersonas = (json ?? [])
            .filter((p) => !p.is_private)
            .map((p) => ({ id: p.id, title: p.name || "Untitled Persona", kind: "persona" as const }));
          const privateLoaded = (json ?? [])
            .filter((p) => Boolean(p.is_private))
            .map((p) => ({ id: p.id, title: p.name || "Untitled Persona", kind: "persona" as const }));
          setPersonas(publicPersonas);
          setPrivatePersonas(privateLoaded);
        } catch {
          void 0;
        }
        return;
      }
    } catch {
      void 0;
    }
  };

  const createPrivateDoc = async (typeKind: "doc" | "post") => {
    if (!user?.id) {
      console.error("[Sidebar] createPrivateDoc: User not logged in");
      return;
    }
    const dbId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const baseType = typeKind === "post" ? "posts" : "persona";
    const type = `${baseType};folder=0;parent=`;
    const title = typeKind === "post" ? "Untitled Post" : "Untitled";

    const { error } = await supabase.from("persona_docs").upsert({
      id: dbId,
      persona_id: null,
      title,
      content: "",
      type,
      updated_at: nowIso,
    });

    if (error) {
        console.error("[Sidebar] createPrivateDoc error:", JSON.stringify(error, null, 2));
        return;
    }

    setPersonaDocsById((prev) => {
      const next = prev["__private__"] ?? [];
      return {
        ...prev,
        ["__private__"]: [{ id: dbId, title, type, updated_at: nowIso, persona_id: null }, ...next],
      };
    });
    router.push(`/persona/__private__/docs/${encodeURIComponent(dbId)}`);
  };

  const moveDocToPrivate = async (docDbId: string, sourcePersonaId: string | null) => {
    console.log("[Sidebar] moveDocToPrivate called", { docDbId, sourcePersonaId });
    if (!sourcePersonaId) return;
    if (!user?.id) {
        console.warn("[Sidebar] moveDocToPrivate: no user id");
        return;
    }
    const list = personaDocsById[sourcePersonaId] ?? [];
    const sourceRow = list.find((d) => d.id === docDbId) ?? null;
    if (!sourceRow) {
      console.warn("[Sidebar] moveDocToPrivate sourceRow not found");
      return;
    }
    const { meta } = parseTypeMeta(sourceRow.type);
    const clean = getCleanPersonaDocId(sourcePersonaId, sourceRow.id);
    const isFolder = meta.folder === "1" || clean.startsWith("folder-");
    const nowIso = new Date().toISOString();
    const nextType = updateTypeParent(sourceRow.type, null);
    console.log("[Sidebar] moveDocToPrivate sending update", { 
      originalId: sourceRow.id, 
      cleanId: clean, 
      persona_id: null, 
      type: nextType 
    });

    if (isFolder) {
      const baseType = normalizePersonaDocType(sourceRow.type);

      const childIdsByParent = new Map<string | null, string[]>();
      for (const row of list) {
        if (normalizePersonaDocType(row.type) !== baseType) continue;
        const parsed = parseTypeMeta(row.type);
        const parentRaw = (parsed.meta.parent ?? "").toString();
        const parentId = parentRaw ? parentRaw : null;
        const arr = childIdsByParent.get(parentId) ?? [];
        arr.push(row.id);
        childIdsByParent.set(parentId, arr);
      }

      const subtreeIds: string[] = [];
      const stack: string[] = [sourceRow.id];
      const seen = new Set<string>();
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (seen.has(current)) continue;
        seen.add(current);
        subtreeIds.push(current);
        const kids = childIdsByParent.get(current) ?? [];
        for (const k of kids) stack.push(k);
      }

      const { data: rootUpdated, error: rootErr } = await supabase
        .from("persona_docs")
        .update({ persona_id: null, type: nextType, updated_at: nowIso })
        .eq("id", sourceRow.id)
        .eq("persona_id", sourcePersonaId)
        .select("id");

      if (rootErr) {
        console.error("[Sidebar] moveDocToPrivate folder root update error:", JSON.stringify(rootErr, null, 2));
        return;
      }
      if (!rootUpdated || rootUpdated.length === 0) {
        if (sourceRow.id.startsWith(`${sourcePersonaId}-`)) {
          const { data: fallbackRootUpdated, error: fallbackRootErr } = await supabase
            .from("persona_docs")
            .update({ persona_id: null, type: nextType, updated_at: nowIso })
            .eq("id", sourceRow.id)
            .select("id");
          if (fallbackRootErr) {
            console.error(
              "[Sidebar] moveDocToPrivate folder root fallback update error:",
              JSON.stringify(fallbackRootErr, null, 2)
            );
            return;
          }
          if (!fallbackRootUpdated || fallbackRootUpdated.length === 0) {
            console.warn("[Sidebar] moveDocToPrivate folder root affected 0 rows. Will refresh lists.");
            void refreshPersonaDocs([sourcePersonaId], { noCache: true });
            return;
          }
        } else {
          console.warn("[Sidebar] moveDocToPrivate folder root affected 0 rows. Will refresh lists.");
          void refreshPersonaDocs([sourcePersonaId], { noCache: true });
          return;
        }
      }

      const childIds = subtreeIds.filter((id) => id !== sourceRow.id);
      if (childIds.length > 0) {
        const { error: childErr } = await supabase
          .from("persona_docs")
          .update({ persona_id: null, updated_at: nowIso })
          .in("id", childIds)
          .eq("persona_id", sourcePersonaId);
        if (childErr) {
          if (sourceRow.id.startsWith(`${sourcePersonaId}-`)) {
            const { error: childFallbackErr } = await supabase
              .from("persona_docs")
              .update({ persona_id: null, updated_at: nowIso })
              .in("id", childIds);
            if (childFallbackErr) {
              console.error(
                "[Sidebar] moveDocToPrivate folder children update error:",
                JSON.stringify(childFallbackErr, null, 2)
              );
              return;
            }
          } else {
            console.error("[Sidebar] moveDocToPrivate folder children update error:", JSON.stringify(childErr, null, 2));
            return;
          }
        }
      }

      setPersonaDocsById((prev) => {
        const fromList = (prev[sourcePersonaId] ?? []).filter((d) => !seen.has(d.id));
        const toList = prev["__private__"] ?? [];
        const movedRows = (prev[sourcePersonaId] ?? [])
          .filter((d) => seen.has(d.id))
          .map((d) => ({
            ...d,
            persona_id: null,
            updated_at: nowIso,
            type: d.id === sourceRow.id ? nextType : d.type,
          }));

        const toListFiltered = toList.filter((d) => !seen.has(d.id));
        return {
          ...prev,
          [sourcePersonaId]: fromList,
          ["__private__"]: [...movedRows, ...toListFiltered],
        };
      });

      void refreshPersonaDocs([sourcePersonaId], { noCache: true });
      return;
    }
    
    const { data: updated, error: updateError } = await supabase
      .from("persona_docs")
      .update({ persona_id: null, type: nextType, updated_at: nowIso })
      .eq("id", sourceRow.id)
      .eq("persona_id", sourcePersonaId)
      .select("id");
      
    if (updateError) {
      console.error("[Sidebar] moveDocToPrivate update error:", JSON.stringify(updateError, null, 2));
      return;
    }
    if (!updated || updated.length === 0) {
      const { data: fallbackUpdated, error: fallbackError } = await supabase
        .from("persona_docs")
        .update({ persona_id: null, type: nextType, updated_at: nowIso })
        .eq("id", sourceRow.id)
        .select("id");

      if (fallbackError) {
        console.error("[Sidebar] moveDocToPrivate fallback update error:", JSON.stringify(fallbackError, null, 2));
        return;
      }
      if (!fallbackUpdated || fallbackUpdated.length === 0) {
        console.warn("[Sidebar] moveDocToPrivate: affected 0 rows. Will refresh lists to reflect server state.");
        void refreshPersonaDocs([sourcePersonaId], { noCache: true });
        return;
      }
    }
    
    console.log("[Sidebar] moveDocToPrivate update success");
    setPersonaDocsById((prev) => {
      const fromList = (prev[sourcePersonaId] ?? []).filter((d) => d.id !== sourceRow.id);
      const toList = (prev["__private__"] ?? []).filter((d) => d.id !== sourceRow.id);
      const nextRow = {
        id: sourceRow.id,
        title: (sourceRow.title ?? "Untitled") as string,
        type: nextType,
        updated_at: nowIso,
        persona_id: null,
      };
      return {
        ...prev,
        [sourcePersonaId]: fromList,
        ["__private__"]: [nextRow, ...toList],
      };
    });
    void refreshPersonaDocs([sourcePersonaId], { noCache: true });
  };

  const renderCollapsed = isCollapsed && !isHovered;

  if (shouldHideSidebar) return null;

  return (
    <>
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-950">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  Upgrade to unlock more features
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Get more monthly credits and unlock unlimited personas for your workflow.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowUpgradeModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex flex-col items-center gap-2">
              <div className="relative inline-flex items-center rounded-full border border-zinc-200 bg-white p-1 text-xs font-semibold text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                <div
                  className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-zinc-100 shadow-sm transition-transform duration-300 ease-out dark:bg-zinc-900 ${
                    activeBillingCycle === "monthly" ? "translate-x-0" : "translate-x-full"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setActiveBillingCycle("monthly")}
                  className="relative z-10 rounded-full px-3 py-1.5 transition-colors hover:text-zinc-900 dark:hover:text-zinc-50"
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setActiveBillingCycle("yearly")}
                  className="relative z-10 rounded-full px-3 py-1.5 transition-colors hover:text-zinc-900 dark:hover:text-zinc-50"
                >
                  Yearly
                </button>
              </div>
              <div className="text-center text-xs font-medium text-emerald-600 dark:text-emerald-400">
                Yearly plans save more compared to paying monthly.
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {(activeBillingCycle === "monthly" ? monthlyPlans : yearlyPlans).map((p) => (
                <UpgradePlanCard
                  key={p.id}
                  title={p.title}
                  price={p.price}
                  cadence={p.cadence}
                  recommended={p.recommended}
                  features={p.features}
                  checkoutUrl={buildCheckoutUrl(p.id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900 animate-in fade-in zoom-in duration-200">
            <div className="flex flex-col items-center p-6 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                 <div className="relative">
                    {isImageLike(user?.avatar_url) ? (
                      <Image
                        src={user!.avatar_url!}
                        alt="User"
                        width={32}
                        height={32}
                        unoptimized
                        className="h-8 w-8 rounded-full object-cover opacity-50"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-300 text-base">
                        {(user?.avatar_url && user.avatar_url.trim()) ? user.avatar_url : "?"}
                      </div>
                    )}
                    <div className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-500 text-white ring-2 ring-white dark:ring-zinc-900">
                        <ArrowRightStartOnRectangleIcon className="h-3 w-3" />
                    </div>
                 </div>
              </div>
              <h3 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Log out of your account?
              </h3>
              <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
                You will need to log back in to access your personas.
              </p>
              <div className="flex w-full flex-col gap-2">
                <button
                  type="button"
                  onClick={confirmLogout}
                  className={`w-full rounded-lg py-2.5 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900 ${
                    loggingOut ? "bg-red-400 cursor-not-allowed" : "bg-red-500 hover:bg-red-600"
                  }`}
                  disabled={loggingOut}
                >
                  {loggingOut ? "Logging out..." : "Log out"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowLogoutModal(false)}
                  className="w-full rounded-lg border border-zinc-200 bg-white py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-200 focus:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:focus:ring-zinc-700 dark:focus:ring-offset-zinc-900"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {hoverTip.visible && (
        <div
          style={{ left: hoverTip.x, top: hoverTip.y }}
          className="fixed z-50 pointer-events-none whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs text-white shadow-sm -translate-y-1/2"
        >
          {hoverTip.text}
        </div>
      )}
      <aside
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`sticky top-0 z-40 flex h-screen shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 transition-all duration-300 dark:border-zinc-800 dark:bg-zinc-950 ${
          isCollapsed && !isHovered ? "w-16" : "w-64"
        }`}
      >
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          {(!isCollapsed || isHovered) && (
            <div className="flex items-center gap-2">
              <div className="relative h-8 w-8 overflow-hidden rounded-md">
                <Image
                  src="/logo-light-icon.png"
                  alt="VibePersona"
                  fill
                  sizes="32px"
                  unoptimized
                  className="object-contain dark:hidden"
                />
                <Image
                  src="/logo-dark-icon.png"
                  alt="VibePersona"
                  fill
                  sizes="32px"
                  unoptimized
                  className="hidden object-contain dark:block"
                />
              </div>
              <span className="font-serif text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                VibePersona
              </span>
            </div>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            onMouseEnter={(e) => showHoverTip("Close sidebar", e)}
            onMouseMove={(e) => showHoverTip("Close sidebar", e)}
            onMouseLeave={hideHoverTip}
            className="ml-auto rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          >
            {isCollapsed && !isHovered ? <Menu className="h-5 w-5" /> : <ChevronsLeft className="h-5 w-5" />}
          </button>
        </div>

        <nav className="flex flex-col gap-0 px-2">
          <NavItem
            href="/home"
            label="Home"
            Icon={HomeIcon}
            active={pathname === "/home"}
            collapsed={renderCollapsed}
            hoverTipText="Access Recent Documents & Quick Start"
            onShowHoverTip={showHoverTip}
            onHideHoverTip={hideHoverTip}
          />
          <NavItem
            href="/board"
            label="Board"
            Icon={RectangleGroupIcon}
            active={pathname.startsWith("/board")}
            collapsed={renderCollapsed}
            hoverTipText="Board view"
            onShowHoverTip={showHoverTip}
            onHideHoverTip={hideHoverTip}
          />
          <NavItem
            href="/schedule"
            label="Schedule"
            Icon={CalendarDaysIcon}
            active={pathname.startsWith("/schedule")}
            collapsed={renderCollapsed}
            hoverTipText="Plan&Schedule Posts"
            onShowHoverTip={showHoverTip}
            onHideHoverTip={hideHoverTip}
          />
          <NavItem
            href="/automation"
            label="Automation"
            Icon={BoltIcon}
            active={pathname.startsWith("/automation")}
            collapsed={renderCollapsed}
            hoverTipText="Automation rules & social workflows"
            onShowHoverTip={showHoverTip}
            onHideHoverTip={hideHoverTip}
          />
          <NavItem
            href="/billing"
            label="Billing"
            Icon={CreditCardIcon}
            active={pathname.startsWith("/billing")}
            collapsed={renderCollapsed}
            hoverTipText="View Your Billing"
            onShowHoverTip={showHoverTip}
            onHideHoverTip={hideHoverTip}
          />
        </nav>

        {!renderCollapsed && (
          <>
            <div className="relative">
              <div className="mt-2 px-2 flex flex-col gap-1">
                <Link
                  href="/persona/create"
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                    pathname === "/persona/create"
                      ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                      : "text-zinc-500 dark:text-zinc-400"
                  } ${renderCollapsed ? "justify-center px-2" : ""}`}
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  {!renderCollapsed && <span>New persona / Set up my ip</span>}
                </Link>
              </div>
              <div
                className={`pointer-events-none absolute left-0 right-0 bottom-0 border-t border-zinc-200/80 dark:border-zinc-800/80 transition-opacity ${
                  docsScrolled ? "opacity-100" : "opacity-0"
                }`}
              />
            </div>
            <div ref={docsScrollRef} className="mt-3 flex-1 overflow-y-auto px-2">
            {sectionOrder.map((section) => {
              if (section === "personas") {
                return (
                  <div
                    key="personas"
                    className={`mb-6 ${dropTargetId === "__personas__" ? "ring-1 ring-blue-500/50 rounded-md" : ""}`}
                    onDragOver={(e) => {
                      let payload: { kind?: "doc" | "persona"; personaId?: string } | null = null;
                      try {
                        const raw = e.dataTransfer.getData("application/json");
                        if (raw) payload = JSON.parse(raw) as { kind?: "doc" | "persona"; personaId?: string };
                      } catch {
                        payload = null;
                      }
                      const kind = payload?.kind ?? null;
                      const personaId = payload?.personaId ?? draggingPersonaId;
                      if (kind === "persona" || (kind === null && personaId)) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDropTargetId("__personas__");
                      }
                    }}
                    onDragLeave={() => {
                      if (dropTargetId === "__personas__") setDropTargetId(null);
                    }}
                    onDrop={(e) => {
                      let payload: { kind?: "doc" | "persona"; personaId?: string } | null = null;
                      try {
                        const raw = e.dataTransfer.getData("application/json");
                        if (raw) payload = JSON.parse(raw) as { kind?: "doc" | "persona"; personaId?: string };
                      } catch {
                        payload = null;
                      }
                      const kind = payload?.kind ?? null;
                      const personaId = payload?.personaId ?? draggingPersonaId;
                      if (kind === "persona" || (kind === null && personaId)) {
                        e.preventDefault();
                        e.stopPropagation();
                        setDropTargetId(null);
                        setDraggingPersonaId(null);
                        if (!personaId) return;
                        void movePersonaToPublic(personaId);
                      }
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between px-2 text-xs font-semibold text-zinc-500">
                      <span>Personas</span>
                      <div className="relative flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHeaderMenuPos({ top: rect.bottom + 4, left: rect.right - 176 });
                            setActiveHeaderMenu(activeHeaderMenu === "personas" ? null : "personas");
                          }}
                          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-700/70"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            router.push("/persona/create");
                            /*
                            const newId = `${Date.now()}`;
                            setPersonas((prev) => [
                              { id: newId, title: "New Persona", kind: "persona", children: buildDefaultPersonaChildren(newId) },
                              ...prev,
                            ]);
                            */
                          }}
                          onMouseEnter={(e) => showHoverTip("Add a document", e)}
                          onMouseMove={(e) => showHoverTip("Add a document", e)}
                          onMouseLeave={hideHoverTip}
                          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-700/70"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      {personaTree.map((persona) => (
                        <PersonaNode
                          key={persona.id}
                          item={persona}
                          activeHref={pathname}
                          onCreateDoc={(item) => {
                            void createDocInContainer(item);
                          }}
                          onMovePersona={(personaId, direction) => {
                            setPersonas((prev) => {
                              const index = prev.findIndex((p) => p.id === personaId);
                              if (index === -1) return prev;
                              const nextIndex = direction === "up" ? index - 1 : index + 1;
                              if (nextIndex < 0 || nextIndex >= prev.length) return prev;
                              const copy = [...prev];
                              const temp = copy[index];
                              copy[index] = copy[nextIndex];
                              copy[nextIndex] = temp;
                              return copy;
                            });
                          }}
                          onMovePersonaToIndex={(personaId, nextIndex) => {
                            setPersonas((prev) => {
                              const index = prev.findIndex((p) => p.id === personaId);
                              if (index === -1) return prev;
                              const clamped = Math.max(0, Math.min(nextIndex, prev.length - 1));
                              if (clamped === index) return prev;
                              const copy = [...prev];
                              const [picked] = copy.splice(index, 1);
                              copy.splice(clamped, 0, picked);
                              return copy;
                            });
                          }}
                          onStartRename={startRename}
                          renamingId={renamingId}
                          renameValue={renameValue}
                          onRenameValueChange={setRenameValue}
                          onCommitRename={(item) => {
                            void commitRename(item);
                          }}
                          onCancelRename={cancelRename}
                          onCopyLink={(item) => {
                            copyItemLink(item);
                          }}
                          onMoveTo={(item) => {
                            void moveItemToFolder(item);
                          }}
                          onOpenInNewTab={(item) => {
                            openItemInNewTab(item);
                          }}
                          onOpenInSidePeek={(item) => {
                            openItemInSidePeek(item);
                          }}
                          onDeleteItem={(item) => {
                            void deletePersonaItem(item);
                          }}
                          draggingDocId={draggingDocId}
                          dropTargetId={dropTargetId}
                          onDocDragStart={(item, e) => {
                            if (item.kind === "persona") {
                              setDraggingPersonaId(item.id);
                              setDraggingDocId(null);
                              setDraggingSourcePersonaId(null);
                              setDraggingDocSection(null);
                              setDropTargetId(null);
                              try {
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("application/x-board-resource-id", item.id);
                                e.dataTransfer.setData(
                                  "application/x-board-resource-meta",
                                  JSON.stringify({ kind: "persona", personaId: item.id })
                                );
                                e.dataTransfer.setData(
                                  "application/json",
                                  JSON.stringify({ kind: "persona", personaId: item.id })
                                );
                              } catch {
                                void 0;
                              }
                              return;
                            }

                            const dbId = item.meta?.dbId ?? item.id;
                            const sourcePersonaId =
                              item.meta?.personaId === "__private__" ? null : item.meta?.personaId ?? null;
                            const section = item.meta?.section ?? null;
                            const personaId = item.meta?.personaId ?? null;
                            const isFolder = Boolean(item.meta?.isFolder || item.kind === "folder");
                            setDraggingPersonaId(null);
                            setDraggingDocId(dbId);
                            setDraggingSourcePersonaId(sourcePersonaId);
                            setDraggingDocSection(section);
                            setDropTargetId(null);
                            try {
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("application/x-board-resource-id", dbId);
                              e.dataTransfer.setData(
                                "application/x-board-resource-meta",
                                JSON.stringify({ kind: "doc", dbId, sourcePersonaId, section, personaId, isFolder })
                              );
                              e.dataTransfer.setData(
                                "application/json",
                                JSON.stringify({ kind: "doc", dbId, sourcePersonaId, section })
                              );
                            } catch {
                              void 0;
                            }
                          }}
                          onDocDragEnd={() => {
                            setDraggingDocId(null);
                            setDraggingSourcePersonaId(null);
                            setDraggingDocSection(null);
                            setDraggingPersonaId(null);
                            setDropTargetId(null);
                          }}
                          onDropTargetOver={(target, e) => {
                            if (!draggingDocId) return;
                            if (!target.meta?.personaId) return;
                            if (draggingDocSection && target.meta.section !== draggingDocSection) return;
                            if (target.meta.folderKind !== "section" && target.meta.folderKind !== "doc") return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            setDropTargetId(target.id);
                          }}
                          onDropTargetLeave={(target) => {
                            if (dropTargetId === target.id) setDropTargetId(null);
                          }}
                          onDropOnTarget={(target, e) => {
                            e.preventDefault();
                            const targetPersonaId = target.meta?.personaId;
                            if (!targetPersonaId) return;
                            const targetSection = target.meta?.section ?? null;
                            if (!targetSection) return;
                            if (draggingDocSection && targetSection !== draggingDocSection) return;
                            if (target.meta?.folderKind !== "section" && target.meta?.folderKind !== "doc") return;
                            const parentDbId = target.meta.folderKind === "doc" ? (target.meta.dbId ?? null) : null;
                            const sourcePersonaId = draggingSourcePersonaId;
                            const docDbId = draggingDocId;
                            setDropTargetId(null);
                            setDraggingDocId(null);
                            setDraggingSourcePersonaId(null);
                            setDraggingDocSection(null);
                            if (!docDbId) return;
                            if (parentDbId && parentDbId === docDbId) return;
                            if (sourcePersonaId) {
                              void moveDocToTarget(docDbId, sourcePersonaId, targetPersonaId, parentDbId, targetSection);
                            } else {
                              void movePrivateDocToTarget(docDbId, targetPersonaId, parentDbId, targetSection);
                            }
                          }}
                          onShowHoverTip={showHoverTip}
                          onHideHoverTip={hideHoverTip}
                          personaIndex={personaIndexById.get(persona.id)}
                          personaCount={personas.length}
                        />
                      ))}
                    </div>
                  </div>
                );
              }

              if (section === "private") {
                const privateList = (personaDocsById["__private__"] ?? []).slice().sort((a, b) => {
                  const ta = a.updated_at ? Date.parse(a.updated_at) : 0;
                  const tb = b.updated_at ? Date.parse(b.updated_at) : 0;
                  return tb - ta;
                });
                return (
                  <div
                    key="private"
                    className="mb-6"
                    onDragOver={(e) => {
                      e.preventDefault();
                      let payload:
                        | { kind?: "doc" | "persona"; dbId?: string; sourcePersonaId?: string | null; personaId?: string }
                        | null = null;
                      try {
                        const raw = e.dataTransfer.getData("application/json");
                        if (raw) {
                          payload = JSON.parse(raw) as {
                            kind?: "doc" | "persona";
                            dbId?: string;
                            sourcePersonaId?: string | null;
                            personaId?: string;
                          };
                        }
                      } catch {
                        payload = null;
                      }
                      const kind = payload?.kind ?? null;
                      const personaId = payload?.personaId ?? draggingPersonaId;
                      if (kind === "persona" || (kind === null && personaId)) {
                        e.dataTransfer.dropEffect = "move";
                        setDropTargetId("__private__");
                        return;
                      }
                      const docDbId = payload?.dbId ?? draggingDocId;
                      const sourcePersonaId = payload?.sourcePersonaId ?? draggingSourcePersonaId;
                      if (!docDbId || !sourcePersonaId) return;
                      e.dataTransfer.dropEffect = "move";
                      setDropTargetId("__private__");
                    }}
                    onDragLeave={() => {
                      if (dropTargetId === "__private__") setDropTargetId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      console.log("[Sidebar] Private onDrop event");
                      let payload:
                        | { kind?: "doc" | "persona"; dbId?: string; sourcePersonaId?: string | null; personaId?: string }
                        | null = null;
                      try {
                        const raw = e.dataTransfer.getData("application/json");
                        console.log("[Sidebar] Private onDrop raw data:", raw);
                        if (raw) {
                          payload = JSON.parse(raw) as {
                            kind?: "doc" | "persona";
                            dbId?: string;
                            sourcePersonaId?: string | null;
                            personaId?: string;
                          };
                        }
                      } catch (err) {
                        console.error("[Sidebar] Private onDrop parse error:", err);
                        payload = null;
                      }
                      const kind = payload?.kind ?? null;
                      const personaId = payload?.personaId ?? draggingPersonaId;
                      const docDbId = payload?.dbId ?? draggingDocId;
                      const sourcePersonaId = payload?.sourcePersonaId ?? draggingSourcePersonaId;
                      console.log("[Sidebar] Private onDrop resolved:", { docDbId, sourcePersonaId });
                      
                      setDropTargetId(null);
                      setDraggingDocId(null);
                      setDraggingSourcePersonaId(null);
                      setDraggingDocSection(null);
                      setDraggingPersonaId(null);
                      if (kind === "persona" || (kind === null && personaId)) {
                        if (!personaId) {
                          console.warn("[Sidebar] Private onDrop missing personaId");
                          return;
                        }
                        void movePersonaToPrivate(personaId);
                        return;
                      }
                      if (kind === "doc" || kind === null) {
                        if (!docDbId || !sourcePersonaId) {
                          console.warn("[Sidebar] Private onDrop missing ids");
                          return;
                        }
                        void moveDocToPrivate(docDbId, sourcePersonaId);
                        return;
                      }
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between px-2 text-xs font-semibold text-zinc-500">
                      <span>Private</span>
                      <div className="relative flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHeaderMenuPos({ top: rect.bottom + 4, left: rect.right - 176 });
                            setActiveHeaderMenu(activeHeaderMenu === "private" ? null : "private");
                          }}
                          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-700/70"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHeaderMenuPos({ top: rect.bottom + 4, left: rect.right - 176 });
                            setActiveHeaderMenu(activeHeaderMenu === "private-plus" ? null : "private-plus");
                          }}
                          onMouseEnter={(e) => showHoverTip("Add a document", e)}
                          onMouseMove={(e) => showHoverTip("Add a document", e)}
                          onMouseLeave={hideHoverTip}
                          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-700/70"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className={`flex flex-col gap-2 ${dropTargetId === "__private__" ? "ring-1 ring-blue-500/50 rounded-md" : ""}`}>
                      {privatePersonaTree.length > 0 && (
                        <div className="flex flex-col gap-1">
                          {privatePersonaTree.map((persona) => (
                            <PersonaNode
                              key={persona.id}
                              item={persona}
                              activeHref={pathname}
                              onCreateDoc={(item) => {
                                void createDocInContainer(item);
                              }}
                              onMovePersona={(personaId, direction) => {
                                setPrivatePersonas((prev) => {
                                  const index = prev.findIndex((p) => p.id === personaId);
                                  if (index === -1) return prev;
                                  const nextIndex = direction === "up" ? index - 1 : index + 1;
                                  if (nextIndex < 0 || nextIndex >= prev.length) return prev;
                                  const copy = [...prev];
                                  const temp = copy[index];
                                  copy[index] = copy[nextIndex];
                                  copy[nextIndex] = temp;
                                  return copy;
                                });
                              }}
                              onMovePersonaToIndex={(personaId, nextIndex) => {
                                setPrivatePersonas((prev) => {
                                  const index = prev.findIndex((p) => p.id === personaId);
                                  if (index === -1) return prev;
                                  const clamped = Math.max(0, Math.min(nextIndex, prev.length - 1));
                                  if (clamped === index) return prev;
                                  const copy = [...prev];
                                  const [picked] = copy.splice(index, 1);
                                  copy.splice(clamped, 0, picked);
                                  return copy;
                                });
                              }}
                              onStartRename={startRename}
                              renamingId={renamingId}
                              renameValue={renameValue}
                              onRenameValueChange={setRenameValue}
                              onCommitRename={(item) => {
                                void commitRename(item);
                              }}
                              onCancelRename={cancelRename}
                              onCopyLink={(item) => {
                                copyItemLink(item);
                              }}
                              onMoveTo={(item) => {
                                void moveItemToFolder(item);
                              }}
                              onOpenInNewTab={(item) => {
                                openItemInNewTab(item);
                              }}
                              onOpenInSidePeek={(item) => {
                                openItemInSidePeek(item);
                              }}
                              onDeleteItem={(item) => {
                                void deletePersonaItem(item);
                              }}
                              allowPersonaDelete={false}
                              draggingDocId={draggingDocId}
                              dropTargetId={dropTargetId}
                              onDocDragStart={(item, e) => {
                                if (item.kind === "persona") {
                                  setDraggingPersonaId(item.id);
                                  setDraggingPersonaId(item.id);
                                  setDraggingDocId(null);
                                  setDraggingSourcePersonaId(null);
                                  setDraggingDocSection(null);
                                  setDropTargetId(null);
                                  try {
                                    e.dataTransfer.effectAllowed = "move";
                                    e.dataTransfer.setData("application/x-board-resource-id", item.id);
                                    e.dataTransfer.setData(
                                      "application/x-board-resource-meta",
                                      JSON.stringify({ kind: "persona", personaId: item.id })
                                    );
                                    e.dataTransfer.setData(
                                      "application/json",
                                      JSON.stringify({ kind: "persona", personaId: item.id })
                                    );
                                  } catch {
                                    void 0;
                                  }
                                  return;
                                }

                                const dbId = item.meta?.dbId ?? item.id;
                                const sourcePersonaId =
                                  item.meta?.personaId === "__private__" ? null : item.meta?.personaId ?? null;
                                const section = item.meta?.section ?? null;
                                const personaId = item.meta?.personaId ?? null;
                                const isFolder = Boolean(item.meta?.isFolder || item.kind === "folder");
                                setDraggingPersonaId(null);
                                setDraggingDocId(dbId);
                                setDraggingSourcePersonaId(sourcePersonaId);
                                setDraggingDocSection(section);
                                setDropTargetId(null);
                                try {
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("application/x-board-resource-id", dbId);
                                  e.dataTransfer.setData(
                                    "application/x-board-resource-meta",
                                    JSON.stringify({ kind: "doc", dbId, sourcePersonaId, section, personaId, isFolder })
                                  );
                                  e.dataTransfer.setData(
                                    "application/json",
                                    JSON.stringify({ kind: "doc", dbId, sourcePersonaId, section })
                                  );
                                } catch {
                                  void 0;
                                }
                              }}
                              onDocDragEnd={() => {
                                setDraggingDocId(null);
                                setDraggingSourcePersonaId(null);
                                setDraggingDocSection(null);
                                setDraggingPersonaId(null);
                                setDropTargetId(null);
                              }}
                              onDropTargetOver={(target, e) => {
                                if (!draggingDocId) return;
                                if (!target.meta?.personaId) return;
                                if (draggingDocSection && target.meta.section !== draggingDocSection) return;
                                if (target.meta.folderKind !== "section" && target.meta.folderKind !== "doc") return;
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                                setDropTargetId(target.id);
                              }}
                              onDropTargetLeave={(target) => {
                                if (dropTargetId === target.id) setDropTargetId(null);
                              }}
                              onDropOnTarget={(target, e) => {
                                e.preventDefault();
                                const targetPersonaId = target.meta?.personaId;
                                if (!targetPersonaId) return;
                                const targetSection = target.meta?.section ?? null;
                                if (!targetSection) return;
                                if (draggingDocSection && targetSection !== draggingDocSection) return;
                                if (target.meta?.folderKind !== "section" && target.meta?.folderKind !== "doc") return;
                                const parentDbId = target.meta.folderKind === "doc" ? (target.meta.dbId ?? null) : null;
                                const sourcePersonaId = draggingSourcePersonaId;
                                const docDbId = draggingDocId;
                                setDropTargetId(null);
                                setDraggingDocId(null);
                                setDraggingSourcePersonaId(null);
                                setDraggingDocSection(null);
                                if (!docDbId) return;
                                if (parentDbId && parentDbId === docDbId) return;
                                if (sourcePersonaId) {
                                  void moveDocToTarget(docDbId, sourcePersonaId, targetPersonaId, parentDbId, targetSection);
                                } else {
                                  void movePrivateDocToTarget(docDbId, targetPersonaId, parentDbId, targetSection);
                                }
                              }}
                              allowPersonaDrag={true}
                              onShowHoverTip={showHoverTip}
                              onHideHoverTip={hideHoverTip}
                              personaIndex={personaIndexById.get(persona.id)}
                              personaCount={privatePersonas.length}
                            />
                          ))}
                        </div>
                      )}
                      {privateList.map((row) => {
                        let dateStr = "";
                        try {
                           if (row.updated_at) {
                             const d = new Date(row.updated_at);
                             if (!isNaN(d.getTime())) dateStr = d.toLocaleDateString();
                           }
                        } catch {
                           dateStr = "";
                        }
                        const section = normalizePersonaDocType(row.type);
                        const item: PersonaItem = {
                          id: row.id,
                          title: (row.title ?? "").toString().trim() || "Untitled",
                          kind: "doc",
                          href: `/persona/${encodeURIComponent("__private__")}/docs/${encodeURIComponent(row.id)}`,
                          meta: { personaId: "__private__", section, dbId: row.id, isFolder: false },
                          rightLabel: dateStr,
                        };
                        return (
                          <PersonaNode
                            key={row.id}
                            item={item}
                            activeHref={pathname}
                            onCreateDoc={() => {
                              void 0;
                            }}
                            onMovePersona={() => {
                              void 0;
                            }}
                            onMovePersonaToIndex={() => {
                              void 0;
                            }}
                            onStartRename={startRename}
                            renamingId={renamingId}
                            renameValue={renameValue}
                            onRenameValueChange={setRenameValue}
                            onCommitRename={(it) => {
                              void commitRename(it);
                            }}
                            onCancelRename={cancelRename}
                            onCopyLink={(it) => {
                              copyItemLink(it);
                            }}
                            onMoveTo={(it) => {
                              void moveItemToFolder(it);
                            }}
                            onOpenInNewTab={(it) => {
                              openItemInNewTab(it);
                            }}
                            onOpenInSidePeek={(it) => {
                              openItemInSidePeek(it);
                            }}
                            onDeleteItem={(it) => {
                              void deletePersonaItem(it);
                            }}
                            draggingDocId={draggingDocId}
                            dropTargetId={dropTargetId}
                            onDocDragStart={(it, e) => {
                              const dbId = it.meta?.dbId ?? it.id;
                              const section = it.meta?.section ?? null;
                              const personaId = it.meta?.personaId ?? null;
                              const isFolder = Boolean(it.meta?.isFolder || it.kind === "folder");
                              setDraggingPersonaId(null);
                              setDraggingDocId(dbId);
                              setDraggingSourcePersonaId(null);
                              setDraggingDocSection(section);
                              setDropTargetId(null);
                              try {
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("application/x-board-resource-id", dbId);
                                e.dataTransfer.setData(
                                  "application/x-board-resource-meta",
                                  JSON.stringify({ kind: "doc", dbId, sourcePersonaId: null, section, personaId, isFolder })
                                );
                                e.dataTransfer.setData(
                                  "application/json",
                                  JSON.stringify({ kind: "doc", dbId, sourcePersonaId: null, section })
                                );
                              } catch {
                                void 0;
                              }
                            }}
                            onDocDragEnd={() => {
                              setDraggingDocId(null);
                              setDraggingSourcePersonaId(null);
                              setDraggingDocSection(null);
                              setDraggingPersonaId(null);
                              setDropTargetId(null);
                            }}
                            onDropTargetOver={() => {
                              void 0;
                            }}
                            onDropTargetLeave={() => {
                              void 0;
                            }}
                            onDropOnTarget={() => {
                              void 0;
                            }}
                            allowPersonaDrag={false}
                          />
                        );
                      })}
                      {privateList.length === 0 && privatePersonaTree.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-zinc-400">No private docs</div>
                      )}
                    </div>
                  </div>
                );
              }

              return (
                <div key="history">
                  <div className="mb-2 flex items-center justify-between px-2 text-xs font-semibold text-zinc-500">
                    <span
                      onMouseEnter={(e) => showHoverTip("Chat history", e)}
                      onMouseMove={(e) => showHoverTip("Chat history", e)}
                      onMouseLeave={hideHoverTip}
                    >
                      Chat History
                    </span>
                    <div className="relative flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHeaderMenuPos({ top: rect.bottom + 4, left: rect.right - 176 });
                          setActiveHeaderMenu(activeHeaderMenu === "history" ? null : "history");
                        }}
                        className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-700/70"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      <Link
                        href="/chat/new"
                        className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-700/70"
                        onMouseEnter={(e) => showHoverTip("new chat", e)}
                        onMouseMove={(e) => showHoverTip("new chat", e)}
                        onMouseLeave={hideHoverTip}
                      >
                        <Plus className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                  <div className="flex flex-col gap-[2px]">
                    {(chats || []).map((chat) => {
                      const active = pathname === `/chat/${chat.id}` || pathname.startsWith(`/chat/${chat.id}/`);
                      return (
                        <ChatNode
                          key={chat.id}
                          chat={chat}
                          active={active}
                          onNavigate={(id) => {
                            setActiveHeaderMenu(null);
                            router.push(`/chat/${encodeURIComponent(id)}`);
                          }}
                          onCopyLink={copyChatLink}
                          onRename={(id) => {
                            void renameChat(id);
                          }}
                          onOpenInNewTab={openChatInNewTab}
                          onOpenInSidePeek={openChatInSidePeek}
                          onDelete={(id) => {
                            void deleteChat(id);
                          }}
                        />
                      );
                    })}
                    {(!chats || chats.length === 0) && (
                      <div className="px-2 py-1.5 text-xs text-zinc-400">
                        No chats yet
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            </div>
          </>
        )}

        {!renderCollapsed && (
        <div className="mt-auto">
          <div className="mx-2 mb-2 h-px bg-zinc-200 dark:bg-zinc-800" />
          <div
            className="relative mx-2"
            onMouseEnter={() => setMenuOpen(true)}
            onMouseLeave={() => setMenuOpen(false)}
          >
            <div className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">
              {isImageLike(user?.avatar_url) ? (
                <Image
                  src={user!.avatar_url!}
                  alt="avatar"
                  width={24}
                  height={24}
                  unoptimized
                  className="h-6 w-6 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-300 text-sm font-medium text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200">
                  {(user?.avatar_url && user.avatar_url.trim()) ? user.avatar_url : initial}
                </div>
              )}
              <div className="flex flex-1 items-center gap-3 text-left overflow-hidden min-w-0">
                <div className="flex flex-1 flex-col justify-center min-w-0">
                  <span className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    {authResolved ? (user?.username || user?.email?.split("@")[0] || "Guest") : (user?.username || user?.email?.split("@")[0] || "")}
                  </span>
                  <span className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {isPaidUser
                      ? `Credits: ${authResolved ? (user?.credits ?? "—") : (user ? (user.credits ?? "—") : "—")}`
                      : "Free user"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowUpgradeModal(true);
                  }}
                  className="flex items-center justify-center rounded-xl bg-white px-3 py-1 text-xs font-bold text-black shadow-sm hover:shadow-md dark:bg-white dark:text-black"
                >
                  Upgrade
                </button>
              </div>
            </div>
            {menuOpen && (
              <>
                <div className="absolute bottom-full -right-4 h-2 w-64" />
                <div className="absolute bottom-full -right-4 mb-2 z-50 w-64 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleTheme();
                    }}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium rounded-lg text-zinc-900 hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {theme === "dark" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
                      <span>{theme === "dark" ? "Dark mode" : "Light mode"}</span>
                    </div>
                    <div className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${theme === "dark" ? "bg-zinc-600" : "bg-zinc-300"}`}>
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${theme === "dark" ? "translate-x-5" : "translate-x-1"}`} />
                    </div>
                  </button>
                  
                  <Link
                    href="/integration"
                    onClick={() => setMenuOpen(false)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg text-zinc-900 hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Link2 className="h-5 w-5" />
                    <span>Integration</span>
                  </Link>

                  <Link
                    href="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg text-zinc-900 hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Settings className="h-5 w-5" />
                    <span>Settings</span>
                  </Link>

                  <div className="h-px w-full bg-zinc-100 dark:bg-zinc-800 my-1" />

                  <a
                    href="mailto:prcrecluse@gmail.com"
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg text-zinc-900 hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Mail className="h-5 w-5" />
                    <span>Contact us</span>
                  </a>
                  
                  <div className="h-px w-full bg-zinc-100 dark:bg-zinc-800 my-1" />
                  
                  <button
                    onClick={onLogoutClick}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                  >
                    <ArrowRightStartOnRectangleIcon className="h-5 w-5" />
                    <span>Log out</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        )}
      </aside>
      {activeHeaderMenu && activeHeaderMenu !== "private-plus" && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setActiveHeaderMenu(null)} />
          <div
            className="fixed z-50 w-44 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
            style={{ top: headerMenuPos.top, left: headerMenuPos.left }}
          >
            <button
              type="button"
              onClick={() => {
                setSectionOrder((prev) => {
                  const order = [...prev];
                  const idx = order.indexOf(activeHeaderMenu!);
                  if (idx > 0) {
                    const [picked] = order.splice(idx, 1);
                    order.splice(idx - 1, 0, picked);
                  }
                  return order;
                });
                setActiveHeaderMenu(null);
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-50 dark:hover:bg-zinc-800"
              disabled={sectionOrder[0] === activeHeaderMenu}
            >
              <ArrowUp className="h-4 w-4" />
              <span>Move up</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSectionOrder((prev) => {
                  const order = [...prev];
                  const idx = order.indexOf(activeHeaderMenu!);
                  if (idx >= 0 && idx < order.length - 1) {
                    const [picked] = order.splice(idx, 1);
                    order.splice(idx + 1, 0, picked);
                  }
                  return order;
                });
                setActiveHeaderMenu(null);
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-50 dark:hover:bg-zinc-800"
              disabled={sectionOrder[sectionOrder.length - 1] === activeHeaderMenu}
            >
              <ArrowDown className="h-4 w-4" />
              <span>Move down</span>
            </button>
          </div>
        </>
      )}
      {activeHeaderMenu === "private-plus" && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setActiveHeaderMenu(null)} />
          <div
            className="fixed z-50 w-44 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
            style={{ top: headerMenuPos.top, left: headerMenuPos.left }}
          >
            <button
              type="button"
              onClick={() => {
                void createPrivateDoc("doc");
                setActiveHeaderMenu(null);
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800"
            >
              <Pencil className="h-4 w-4" />
              <span>New Doc</span>
            </button>
            <button
              type="button"
              onClick={() => {
                void createPrivateDoc("post");
                setActiveHeaderMenu(null);
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800"
            >
              <Pencil className="h-4 w-4" />
              <span>New Post</span>
            </button>
          </div>
        </>
      )}
    </>
  );
}
