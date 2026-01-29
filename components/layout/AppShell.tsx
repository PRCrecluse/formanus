"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { X } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import { usePathname, useSearchParams } from "next/navigation";

export type GlobalChatRow = {
  id: string;
  title: string | null;
  created_at: string | null;
};

export type GlobalChatMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string | null;
};

type ChatHistoryContextValue = {
  chats: GlobalChatRow[];
  setChats: Dispatch<SetStateAction<GlobalChatRow[]>>;
  upsertChat: (chat: GlobalChatRow) => void;
  messagesByChatId: Record<string, GlobalChatMessageRow[]>;
  setMessagesForChat: (chatId: string, messages: GlobalChatMessageRow[]) => void;
};

const ChatHistoryContext = createContext<ChatHistoryContextValue | null>(null);
const SidePeekContext = createContext<string | null>(null);

export function useChatHistory() {
  return useContext(ChatHistoryContext);
}

export function useSidePeekHref() {
  return useContext(SidePeekContext);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [sidePeekHref, setSidePeekHref] = useState<string | null>(null);
  const [chats, setChats] = useState<GlobalChatRow[]>([]);
  const [messagesByChatId, setMessagesByChatId] = useState<Record<string, GlobalChatMessageRow[]>>({});
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const embedded = useMemo(() => {
    if (searchParams.get("embed") === "1") return true;
    try {
      return typeof window !== "undefined" && window.self !== window.top;
    } catch {
      return true;
    }
  }, [searchParams]);

  const upsertChat = useCallback((chat: GlobalChatRow) => {
    setChats((prev) => {
      const next = [chat, ...prev.filter((c) => c.id !== chat.id)];
      return next;
    });
  }, []);

  const setMessagesForChat = useCallback((chatId: string, messages: GlobalChatMessageRow[]) => {
    setMessagesByChatId((prev) => ({ ...prev, [chatId]: messages }));
  }, []);

  const onOpenSidePeek = useMemo(() => {
    return (href: string) => {
      setSidePeekHref(href);
    };
  }, []);

  const ctxValue = useMemo<ChatHistoryContextValue>(() => {
    return {
      chats,
      setChats,
      upsertChat,
      messagesByChatId,
      setMessagesForChat,
    };
  }, [chats, messagesByChatId, setMessagesForChat, upsertChat]);

  if (embedded) {
    return <div className="h-dvh overflow-y-auto">{children}</div>;
  }

  const sidePeekSrc = sidePeekHref
    ? sidePeekHref.includes("?")
      ? `${sidePeekHref}&embed=1`
      : `${sidePeekHref}?embed=1`
    : null;

  const hideGlobalSidebar =
    pathname.startsWith("/adminPRC") || pathname === "/doc" || pathname === "/terms" || pathname === "/privacy";

  return (
    <ChatHistoryContext.Provider value={ctxValue}>
      <SidePeekContext.Provider value={sidePeekHref}>
        <div className="flex h-dvh overflow-hidden">
          {!sidePeekHref && !hideGlobalSidebar && (
            <Sidebar onOpenSidePeek={onOpenSidePeek} chats={chats} setChats={setChats} />
          )}
          <div className="flex min-w-0 flex-1 overflow-hidden">
            <div
              className={`${sidePeekHref ? "w-1/2" : "w-full"} relative z-10 h-dvh overflow-y-auto`}
            >
              {children}
            </div>
            {sidePeekSrc && (
              <div className="-ml-3 flex w-1/2 min-w-0 flex-col overflow-hidden rounded-l-2xl border-l border-zinc-200 bg-white shadow-2xl relative z-20 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex h-12 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
                  <div className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    Side peek
                  </div>
                  <button
                    type="button"
                    onClick={() => setSidePeekHref(null)}
                    className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <iframe
                  key={sidePeekSrc}
                  src={sidePeekSrc}
                  className="h-full w-full"
                  title="Side peek"
                />
              </div>
            )}
          </div>
        </div>
      </SidePeekContext.Provider>
    </ChatHistoryContext.Provider>
  );
}
