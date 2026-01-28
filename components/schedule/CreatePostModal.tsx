"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Smile,
  Hash,
  Image as ImageIcon,
  Sparkles,
  ChevronDown,
  Calendar,
  FileVideo,
  Loader2,
} from "lucide-react";
import { createPortal } from "react-dom";
import { getSessionWithTimeout, supabase } from "@/lib/supabaseClient";

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    content: string;
    accounts: string[];
    personaId: string | null;
    targetPlatform?: string | null;
    targetAccount?: string | null;
    media?: Array<{
      kind: "image" | "video";
      url: string;
      duration_sec?: number | null;
    }>;
    action: "draft" | "schedule" | "postNow";
    scheduledAt?: Date | null;
  }) =>
    | Promise<{ ok: true; viewUrl?: string | null } | { ok: false; error?: string }>
    | { ok: true; viewUrl?: string | null }
    | { ok: false; error?: string };
}

type ConnectedAccount = {
  id: string;
  name: string;
  platform: "X";
  username?: string | null;
  avatarUrl?: string | null;
};

function toLocalDatetimeValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function CreatePostModal({ isOpen, onClose, onSubmit }: CreatePostModalProps) {
  const [content, setContent] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState<"X" | null>(null);
  const [isPlatformDropdownOpen, setIsPlatformDropdownOpen] = useState(false);
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const [isSchedulePopoverOpen, setIsSchedulePopoverOpen] = useState(false);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [media, setMedia] = useState<
    Array<{ id: string; kind: "image" | "video"; url: string; duration_sec?: number | null }>
  >([]);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [scheduledAtValue, setScheduledAtValue] = useState(() =>
    toLocalDatetimeValue(new Date(Date.now() + 60 * 60 * 1000))
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const canUseDOM = typeof document !== "undefined";

  useEffect(() => {
    if (isOpen) return;
    setContent("");
    setSelectedAccounts([]);
    setSelectedPlatform(null);
    setIsPlatformDropdownOpen(false);
    setIsAccountDropdownOpen(false);
    setIsSchedulePopoverOpen(false);
    setMedia([]);
    setMediaUploading(false);
    setSubmitError(null);
    setSubmitting(false);
  }, [isOpen]);

  const uploadToSupabase = async (file: File) => {
    const { session } = await getSessionWithTimeout({ timeoutMs: 8000, retries: 2, retryDelayMs: 250 });
    const uid = session?.user?.id;
    if (!uid) throw new Error("Not signed in");

    const bucket = "chat-attachments";
    const key = `${uid}/${crypto.randomUUID()}-${file.name}`;
    const { error } = await supabase.storage.from(bucket).upload(key, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from(bucket).getPublicUrl(key);
    if (!data.publicUrl) throw new Error("Failed to get public url");
    return data.publicUrl;
  };

  const getVideoDurationSeconds = async (file: File): Promise<number | null> => {
    if (typeof window === "undefined") return null;
    if (!file.type.startsWith("video/")) return null;

    const url = URL.createObjectURL(file);
    try {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.src = url;
      const duration = await new Promise<number | null>((resolve) => {
        let settled = false;
        const done = (value: number | null) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        const t = window.setTimeout(() => done(null), 4000);
        v.onloadedmetadata = () => {
          window.clearTimeout(t);
          const d = Number.isFinite(v.duration) ? v.duration : null;
          done(d);
        };
        v.onerror = () => {
          window.clearTimeout(t);
          done(null);
        };
      });
      return duration;
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const handlePickImage = () => {
    if (mediaUploading || submitting) return;
    imageInputRef.current?.click();
  };

  const handlePickVideo = () => {
    if (mediaUploading || submitting) return;
    videoInputRef.current?.click();
  };

  const handleFilesSelected = async (files: FileList | null, kind: "image" | "video") => {
    if (!files || files.length === 0) return;
    if (mediaUploading) return;
    setMediaUploading(true);
    setSubmitError(null);
    try {
      const next: Array<{ id: string; kind: "image" | "video"; url: string; duration_sec?: number | null }> = [];
      for (const file of Array.from(files)) {
        if (kind === "image" && !file.type.startsWith("image/")) continue;
        if (kind === "video" && !file.type.startsWith("video/")) continue;
        const url = await uploadToSupabase(file);
        const duration = kind === "video" ? await getVideoDurationSeconds(file) : null;
        next.push({ id: crypto.randomUUID(), kind, url, duration_sec: duration });
      }
      if (next.length > 0) setMedia((prev) => [...prev, ...next]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setSubmitError(msg);
    } finally {
      setMediaUploading(false);
    }
  };

  const currentAccount = useMemo(
    () => accounts.find((a) => selectedAccounts.includes(a.id)) ?? null,
    [accounts, selectedAccounts]
  );

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const run = async () => {
      const { session } = await getSessionWithTimeout({ timeoutMs: 8000, retries: 2, retryDelayMs: 250 });
      const token = session?.access_token ?? null;
      if (!token) {
        if (!cancelled) {
          setAccounts([]);
          setSelectedAccounts([]);
          setSelectedPlatform(null);
        }
        return;
      }
      const res = await fetch("/api/integrations/x/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        if (!cancelled) {
          setAccounts([]);
          setSelectedAccounts([]);
          setSelectedPlatform(null);
        }
        return;
      }
      const json = (await res.json()) as {
        connected?: boolean;
        username?: string | null;
        name?: string | null;
        profileImageUrl?: string | null;
        accounts?: Array<{
          id: string;
          username: string | null;
          name: string | null;
          profileImageUrl: string | null;
        }>;
      };
      if (cancelled) return;
      if (json && json.connected) {
        const rawAccounts =
          Array.isArray(json.accounts) && json.accounts.length > 0
            ? json.accounts
            : [
                {
                  id: json.username || "x",
                  username: json.username ?? null,
                  name: json.name ?? null,
                  profileImageUrl: json.profileImageUrl ?? null,
                },
              ];
        const mapped: ConnectedAccount[] = rawAccounts.map((a) => ({
          id: a.id || a.username || "x",
          name: a.name || a.username || "X account",
          platform: "X",
          username: a.username,
          avatarUrl: a.profileImageUrl ?? null,
        }));
        setAccounts(mapped);
        setSelectedAccounts((prev) =>
          prev.length > 0 && prev.every((id) => mapped.some((a) => a.id === id))
            ? prev
            : mapped.length > 0
            ? [mapped[0].id]
            : []
        );
        setSelectedPlatform((prev) => prev ?? "X");
      } else {
        setAccounts([]);
        setSelectedAccounts([]);
        setSelectedPlatform(null);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen || !canUseDOM) return null;

  const charCount = content.length;
  const charLimit = 25000;

  const runSubmit = async (data: {
    content: string;
    accounts: string[];
    personaId: string | null;
    targetPlatform?: string | null;
    targetAccount?: string | null;
    media?: Array<{ kind: "image" | "video"; url: string; duration_sec?: number | null }>;
    action: "draft" | "schedule" | "postNow";
    scheduledAt?: Date | null;
  }) => {
    if (submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await onSubmit(data);
      if (!res.ok) {
        setSubmitError(res.error ?? "Failed to save. Please try again.");
        return;
      }
      onClose();
    } catch {
      setSubmitError("Failed to save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    const firstAccount = selectedAccounts[0] ?? null;
    const platform =
      firstAccount ? (accounts.find((a) => a.id === firstAccount)?.platform ?? null) : null;
    await runSubmit({
      content,
      accounts: selectedAccounts,
      personaId: null,
      targetPlatform: platform,
      targetAccount: firstAccount,
      media,
      action: "draft",
    });
  };

  const handlePostNow = async () => {
    if (submitting) return;
    const firstAccount = selectedAccounts[0] ?? null;
    const platform =
      firstAccount ? (accounts.find((a) => a.id === firstAccount)?.platform ?? null) : null;
    setSubmitError(null);
    setSubmitting(true);
    onClose();
    void onSubmit({
      content,
      accounts: selectedAccounts,
      personaId: null,
      targetPlatform: platform,
      targetAccount: firstAccount,
      media,
      action: "postNow",
    });
  };

  const handleSchedule = async () => {
    const d = new Date(scheduledAtValue);
    if (Number.isNaN(d.getTime())) return;
    const firstAccount = selectedAccounts[0] ?? null;
    const platform =
      firstAccount ? (accounts.find((a) => a.id === firstAccount)?.platform ?? null) : null;
    await runSubmit({
      content,
      accounts: selectedAccounts,
      personaId: null,
      targetPlatform: platform,
      targetAccount: firstAccount,
      media,
      action: "schedule",
      scheduledAt: d,
    });
  };

  const toggleAccount = (accountId: string) => {
    setSelectedAccounts(prev => 
      prev.includes(accountId) 
        ? prev.filter(id => id !== accountId)
        : [...prev, accountId]
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 backdrop-blur-sm p-4 sm:p-8">
      <div className="flex h-[calc(100dvh-2rem)] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-950 sm:h-[calc(100dvh-4rem)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Create a post</h2>
          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-zinc-100 rounded-full dark:hover:bg-zinc-800 transition-colors">
                 <span className="sr-only">Minimize</span>
                 <svg width="16" height="2" viewBox="0 0 16 2" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="text-zinc-500">
                    <rect width="16" height="2" rx="1" />
                 </svg>
            </button>
            <button
                onClick={onClose}
                className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
                <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <>
          <div className="flex flex-1 overflow-hidden">
          {/* Left Column: Editor */}
          <div className="flex w-full flex-col overflow-y-auto border-r border-zinc-200 p-6 dark:border-zinc-800 md:w-1/2 lg:w-5/12">
            {/* Account Selector */}
            <div className="mb-6 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-bold uppercase text-zinc-500">Library</div>
              </div>
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (!accounts.length) return;
                      setIsPlatformDropdownOpen((v) => !v);
                      setIsAccountDropdownOpen(false);
                    }}
                    disabled={!accounts.length}
                    className="flex w-full items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left hover:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <span className="text-sm text-zinc-700 dark:text-zinc-200">
                      {selectedPlatform ?? "Select platform"}
                    </span>
                    <ChevronDown className="h-5 w-5 text-zinc-400" />
                  </button>
                  {isPlatformDropdownOpen && (
                    <div className="absolute top-full left-0 z-10 mt-2 w-full rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPlatform("X");
                          setIsPlatformDropdownOpen(false);
                          setSelectedAccounts((prev) =>
                            prev.filter((id) => accounts.some((a) => a.id === id && a.platform === "X"))
                          );
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                          selectedPlatform === "X"
                            ? "bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400"
                            : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        }`}
                      >
                        <span>X (Twitter)</span>
                        {selectedPlatform === "X" && <div className="h-2 w-2 rounded-full bg-orange-500" />}
                      </button>
                    </div>
                  )}
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedPlatform) return;
                      setIsAccountDropdownOpen(!isAccountDropdownOpen);
                      setIsPlatformDropdownOpen(false);
                    }}
                    disabled={!selectedPlatform}
                    className="flex w-full items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left hover:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedAccounts.length === 0 ? (
                        <span className="text-zinc-500">
                          {selectedPlatform ? "Select accounts..." : "Select platform first"}
                        </span>
                      ) : (
                        selectedAccounts.map((accountId) => {
                          const account = accounts.find((a) => a.id === accountId);
                          if (!account) return null;
                          return (
                            <div
                              key={accountId}
                              className="flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-sm font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                            >
                              {account.avatarUrl ? (
                                <img
                                  src={account.avatarUrl}
                                  alt=""
                                  className="h-6 w-6 rounded-full border border-orange-200 object-cover dark:border-orange-900/40"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="h-6 w-6 rounded-full bg-orange-200 dark:bg-orange-900/40" />
                              )}
                              <span>{account.name || account.username || accountId}</span>
                              <div
                                role="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleAccount(accountId);
                                }}
                                className="ml-1 hover:text-orange-900"
                              >
                                <X size={12} />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                    <ChevronDown className="h-5 w-5 text-zinc-400" />
                  </button>
                  {isAccountDropdownOpen && (
                    <div className="absolute top-full left-0 z-10 mt-2 w-full rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                      {accounts.filter((a) => a.platform === selectedPlatform).length === 0 ? (
                        <div className="px-4 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                          No accounts for this platform
                        </div>
                      ) : (
                        accounts
                          .filter((a) => a.platform === selectedPlatform)
                          .map((account) => (
                            <button
                              key={account.id}
                              type="button"
                              onClick={() => toggleAccount(account.id)}
                              className={`flex w-full items-center justify-between rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                                selectedAccounts.includes(account.id)
                                  ? "bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400"
                                  : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                {account.avatarUrl ? (
                                  <img
                                    src={account.avatarUrl}
                                    alt=""
                                    className="h-6 w-6 rounded-full border border-orange-200 object-cover dark:border-orange-900/40"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <div className="h-6 w-6 rounded-full bg-orange-200 dark:bg-orange-900/40" />
                                )}
                                <div className="flex flex-col items-start">
                                  <span>{account.name || account.username || account.id}</span>
                                  {account.username && (
                                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                      @{account.username}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {selectedAccounts.includes(account.id) && (
                                <div className="h-2 w-2 rounded-full bg-orange-500" />
                              )}
                            </button>
                          ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Editor Area */}
            <div className="flex-1">
                <div className="mb-2 flex items-center gap-2">
                    <div className="rounded-md bg-blue-900 px-3 py-1 text-xs font-bold text-white">
                        Your post
                    </div>
                </div>
                
                <div className="relative flex min-h-[300px] flex-col rounded-xl border border-zinc-200 bg-white transition-shadow focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-900">
                    <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder="Write your caption, then customize it for each social network"
                        className="flex-1 resize-none bg-transparent p-4 text-base outline-none placeholder:text-zinc-400 dark:text-zinc-50"
                    />
                    
                    {/* Toolbar inside textarea container */}
                    <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50/50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
                        <div className="flex items-center gap-4 text-xs text-zinc-500">
                             <span>{charCount} / {charLimit.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-purple-600 shadow-sm ring-1 ring-zinc-200 hover:bg-purple-50 dark:bg-zinc-800 dark:text-purple-400 dark:ring-zinc-700">
                                <Sparkles className="h-3 w-3" />
                                <span>Enhance with PersonaAI</span>
                            </button>
                            <button className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                                <Smile className="h-5 w-5" />
                            </button>
                             <button className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                                <Hash className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                    
                    {/* Media Upload Area */}
                     <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            void handleFilesSelected(e.target.files, "image");
                            e.currentTarget.value = "";
                          }}
                        />
                        <input
                          ref={videoInputRef}
                          type="file"
                          accept="video/*"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            void handleFilesSelected(e.target.files, "video");
                            e.currentTarget.value = "";
                          }}
                        />
                        <div className="flex items-center gap-3">
                             <button
                               type="button"
                               onClick={handlePickImage}
                               disabled={mediaUploading || submitting}
                               className="flex h-12 w-12 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800"
                               aria-label="Upload image"
                             >
                               {mediaUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-6 w-6" />}
                             </button>
                             <button
                               type="button"
                               onClick={handlePickVideo}
                               disabled={mediaUploading || submitting}
                               className="flex h-12 w-12 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800"
                               aria-label="Upload video"
                             >
                               {mediaUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileVideo className="h-6 w-6" />}
                             </button>
                             <div className="h-8 w-px bg-zinc-200 dark:bg-zinc-800 mx-2" />
                             {media.length > 0 && (
                               <div className="flex items-center gap-2">
                                 {media.slice(0, 4).map((m) => (
                                   <div
                                     key={m.id}
                                     className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
                                   >
                                     {m.kind === "image" ? (
                                       <img src={m.url} alt="" className="h-full w-full object-cover" />
                                     ) : (
                                       <FileVideo className="h-5 w-5 text-zinc-500" />
                                     )}
                                   </div>
                                 ))}
                               </div>
                             )}
                        </div>
                     </div>
                </div>
            </div>
          </div>

          {/* Right Column: Preview */}
          <div className="hidden w-1/2 flex-col bg-zinc-50 p-6 dark:bg-zinc-900/50 md:flex lg:w-7/12">
             <div className="flex items-center gap-2 mb-6">
                <div className="h-8 w-8 rounded-full bg-black text-white flex items-center justify-center font-bold text-sm">X</div>
                <span className="font-medium text-zinc-500">X (Twitter)</span>
             </div>

            <div className="flex-1 flex items-center justify-center">
                 <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                     <div className="flex gap-3">
                         {currentAccount?.avatarUrl ? (
                           <img
                             src={currentAccount.avatarUrl}
                             alt=""
                             className="h-10 w-10 flex-none rounded-full border border-zinc-200 object-cover dark:border-zinc-700"
                             referrerPolicy="no-referrer"
                           />
                         ) : (
                           <div className="h-10 w-10 flex-none rounded-full bg-zinc-200 dark:bg-zinc-800" />
                         )}
                         <div className="flex-1 min-w-0">
                             <div className="flex items-center gap-1">
                                 <span className="font-bold text-zinc-900 dark:text-zinc-50">
                                   {currentAccount?.name || currentAccount?.username || "X account"}
                                 </span>
                                 <span className="text-zinc-500">
                                   {currentAccount?.username ? `@${currentAccount.username}` : "@username"} · 1s
                                 </span>
                             </div>
                             <div className="mt-1 whitespace-pre-wrap text-zinc-900 dark:text-zinc-50 text-sm">
                                 {content || "Write your caption..."}
                             </div>
                             <div className="mt-3 flex items-center justify-between text-zinc-500 max-w-[80%]">
                                 <div className="h-4 w-4 rounded-full border border-zinc-300" />
                                 <div className="h-4 w-4 rounded-full border border-zinc-300" />
                                 <div className="h-4 w-4 rounded-full border border-zinc-300" />
                                 <div className="h-4 w-4 rounded-full border border-zinc-300" />
                             </div>
                         </div>
                     </div>
                 </div>
             </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
             <div className="flex items-center gap-2">
               <button
                 type="button"
                 onClick={handleSaveDraft}
                 disabled={submitting}
                 className="rounded-lg px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
               >
                 Save as draft
               </button>
             </div>
             <div className="flex items-center gap-3">
                {submitError ? <div className="mr-2 text-sm font-semibold text-red-600">{submitError}</div> : null}
                 <button
                    onClick={onClose}
                    disabled={submitting}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                    Cancel
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsSchedulePopoverOpen((v) => !v)}
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    <Calendar className="h-4 w-4" />
                    <span>Schedule for later</span>
                    <ChevronDown className="h-4 w-4 text-zinc-400" />
                  </button>

                  {isSchedulePopoverOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setIsSchedulePopoverOpen(false)} />
                      <div className="absolute right-0 z-20 mb-2 w-80 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950 bottom-full">
                        <div className="border-b border-zinc-200 px-4 py-3 text-sm font-bold text-zinc-900 dark:border-zinc-800 dark:text-zinc-50">
                          Schedule
                        </div>
                        <div className="p-4">
                          <input
                            value={scheduledAtValue}
                            onChange={(e) => setScheduledAtValue(e.target.value)}
                            type="datetime-local"
                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
                          />
                          <div className="mt-3 flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setIsSchedulePopoverOpen(false)}
                              className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                handleSchedule();
                                setIsSchedulePopoverOpen(false);
                              }}
                              disabled={submitting}
                              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                            >
                              Schedule
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handlePostNow}
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  <span>Post now</span>
                </button>
            </div>
        </div>
        </>
      </div>
    </div>,
    document.body
  );
}
