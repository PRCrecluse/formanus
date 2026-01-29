"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getSessionWithTimeout, supabase } from "@/lib/supabaseClient";
import { FileVideo, Image as ImageIcon, Loader2 } from "lucide-react";
import { ensureDocHtmlContent, makePersonaDocDbId, normalizePersonaDocType, type PersonaDocType } from "@/lib/utils";
import { getSqliteClient } from "@/lib/sqliteClient";
import dynamic from "next/dynamic";

export type DocType = PersonaDocType;

const docCache = new Map<
  string,
  { title: string; content: string; type: string; updated_at: string | null }
>();

const RichEditor = dynamic(() => import("@/components/Editor"), {
  ssr: false,
  loading: () => (
    <div className="space-y-4 animate-pulse mt-8">
      <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4"></div>
      <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-1/2"></div>
      <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-5/6"></div>
      <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-2/3"></div>
    </div>
  ),
});

interface DocEditorProps {
  personaId?: string | null;
  docId: string;
  onDocUpdate?: (doc: { id: string; title: string; content: string; type: string; updated_at: string }) => void;
  diffBefore?: string | null;
  diffAfter?: string | null;
  onDiffResolved?: () => void;
}

export default function DocEditor({
  personaId,
  docId,
  onDocUpdate,
  diffBefore,
  diffAfter,
  onDiffResolved,
}: DocEditorProps) {
  const resolvedPersonaId = (personaId ?? "").toString().trim();
  const isPrivatePersona = resolvedPersonaId === "__private__";
  const hasPersonaId = resolvedPersonaId.length > 0 && !isPrivatePersona;
  const initialDbId =
    hasPersonaId && docId.startsWith(`${resolvedPersonaId}-`) ? docId : hasPersonaId ? makePersonaDocDbId(resolvedPersonaId, docId) : docId;
  const [resolvedDbId, setResolvedDbId] = useState(initialDbId);

  const [title, setTitle] = useState("Untitled");
  const [content, setContent] = useState("");
  const [docTypeRaw, setDocTypeRaw] = useState<string>("persona");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const saveTimeoutRef = useRef<NodeJS.Timeout>(null);
  const isDirtyRef = useRef(false);
  const modeOverrideRef = useRef<"view" | "edit" | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("edit");

  const [pendingDiff, setPendingDiff] = useState<{ before: string; after: string } | null>(null);
  const [isReverting, setIsReverting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const streamingTimerRef = useRef<number | null>(null);

  const typeBase = useMemo(() => normalizePersonaDocType(docTypeRaw), [docTypeRaw]);
  const isAlbum = typeBase === "albums";
  const isPost = typeBase === "posts";

  const extractMediaItems = useCallback((html: string) => {
    const raw = (html ?? "").toString();
    const items: { kind: "image" | "video"; src: string }[] = [];
    const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
    const vidRe = /<video[^>]+src=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(raw))) items.push({ kind: "image", src: m[1] });
    while ((m = vidRe.exec(raw))) items.push({ kind: "video", src: m[1] });
    const seen = new Set<string>();
    const uniq: { kind: "image" | "video"; src: string }[] = [];
    for (const it of items) {
      const key = `${it.kind}:${it.src}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(it);
    }
    return uniq;
  }, []);

  const albumMedia = useMemo(() => {
    if (!isAlbum) return [];
    return extractMediaItems(content);
  }, [content, extractMediaItems, isAlbum]);

  useEffect(() => {
    let active = true;
    const currentDbId = resolvedDbId;
    const remoteAbort = new AbortController();
    isDirtyRef.current = false;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    setLastSaved(null);

    const applyDoc = (doc: { title?: string | null; content?: string | null; type?: string | null }) => {
      if (!active) return;
      setTitle(doc.title || "Untitled");
      setContent(ensureDocHtmlContent(doc.content || ""));
      setDocTypeRaw((doc.type ?? "persona").toString() || "persona");
    };

    const cached = docCache.get(currentDbId);
    let cachedUpdatedAt: string | null = cached?.updated_at ?? null;
    let hasRendered = false;

    if (cached) {
      applyDoc(cached);
      setIsLoading(false);
      hasRendered = true;
    } else {
      setIsLoading(true);
    }

    const readFromSqlite = async () => {
      if (cached) return;
      try {
        const sqlite = await getSqliteClient();
        const row = await sqlite.getDoc(currentDbId);
        if (!active || !row) return;

        cachedUpdatedAt = row.updated_at ?? null;
        docCache.set(currentDbId, {
          title: row.title ?? "Untitled",
          content: row.content ?? "",
          type: (row.type ?? "persona").toString() || "persona",
          updated_at: row.updated_at ?? null,
        });

        if (!hasRendered) {
          applyDoc(row);
          setIsLoading(false);
          hasRendered = true;
        }
      } catch {
        void 0;
      }
    };

    const writeToSqlite = async (payload: {
      id: string;
      persona_id: string | null;
      title: string;
      content: string;
      type: string;
      updated_at: string | null;
    }) => {
      try {
        const sqlite = await getSqliteClient();
        await sqlite.upsertDoc(payload);
      } catch {
        void 0;
      }
    };

    const readFromRemote = async () => {
      try {
        const timeoutId = window.setTimeout(() => remoteAbort.abort(), 15000);
        try {
          const sessionInfo = await getSessionWithTimeout({
            timeoutMs: 2500,
            retries: 2,
            retryDelayMs: 120,
            signal: remoteAbort.signal,
          });
          const token = sessionInfo.session?.access_token ?? "";
          const legacyEnabled = hasPersonaId && !docId.startsWith(`${resolvedPersonaId}-`);

          if (!active) return;

          const query = legacyEnabled
            ? `?personaId=${encodeURIComponent(resolvedPersonaId)}&legacyId=${encodeURIComponent(docId)}`
            : "";
          const r = await fetch(`/api/persona-docs/${encodeURIComponent(currentDbId)}${query}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: remoteAbort.signal,
          });

          if (!active) return;

          if (r.ok) {
            const data = (await r.json()) as {
              id: string;
              persona_id: string | null;
              title: string | null;
              content: string | null;
              type: string | null;
              updated_at: string | null;
            };

            const remoteUpdatedAt = data.updated_at ?? null;
            const shouldApply = !cachedUpdatedAt || remoteUpdatedAt !== cachedUpdatedAt || !hasRendered;

            if (shouldApply) {
              applyDoc(data);
            }

            docCache.set(currentDbId, {
              title: data.title ?? "Untitled",
              content: data.content ?? "",
              type: (data.type ?? "persona").toString() || "persona",
              updated_at: remoteUpdatedAt,
            });

            setIsLoading(false);
            hasRendered = true;

            void writeToSqlite({
              id: currentDbId,
              persona_id: (data.persona_id ?? resolvedPersonaId) || null,
              title: data.title ?? "Untitled",
              content: data.content ?? "",
              type: (data.type ?? "persona").toString() || "persona",
              updated_at: remoteUpdatedAt,
            });

            return;
          }

          if (r.status !== 404) {
            const text = await r.text().catch(() => "");
            console.error("Error loading doc:", text || r.statusText);
            if (!hasRendered) setIsLoading(false);
            return;
          }

          if (legacyEnabled) {
            const { data: legacyData, error: legacyError } = await supabase
              .from("persona_docs")
              .select("*")
              .eq("id", docId)
              .eq("persona_id", resolvedPersonaId)
              .maybeSingle();

            if (!active) return;

            if (legacyError) {
              console.error("Error loading legacy doc:", legacyError);
            } else if (legacyData) {
              const nowIso = new Date().toISOString();
              const migratePayload = {
                id: initialDbId,
                persona_id: resolvedPersonaId,
                title: legacyData.title ?? "Untitled",
                content: legacyData.content ?? "",
                type: legacyData.type ?? "persona",
                updated_at: nowIso,
              };

              await supabase.from("persona_docs").upsert(migratePayload);
              await supabase.from("persona_docs").delete().eq("id", docId).eq("persona_id", resolvedPersonaId);

              if (!active) return;

              setResolvedDbId(initialDbId);
              applyDoc(migratePayload);
              docCache.set(initialDbId, {
                title: migratePayload.title ?? "Untitled",
                content: migratePayload.content ?? "",
                type: (migratePayload.type ?? "persona").toString() || "persona",
                updated_at: migratePayload.updated_at ?? null,
              });
              setIsLoading(false);
              hasRendered = true;

              void writeToSqlite({
                id: initialDbId,
                persona_id: resolvedPersonaId || null,
                title: migratePayload.title ?? "Untitled",
                content: migratePayload.content ?? "",
                type: (migratePayload.type ?? "persona").toString() || "persona",
                updated_at: migratePayload.updated_at ?? null,
              });

              return;
            }
          }

          if (!hasRendered) setIsLoading(false);
        } finally {
          window.clearTimeout(timeoutId);
        }
      } catch (e) {
        if (!active) return;
        console.error("Unexpected error loading doc:", e);
        setIsLoading(false);
      }
    };

    void readFromSqlite();
    void readFromRemote();

    return () => {
      active = false;
      remoteAbort.abort();
    };
  }, [docId, hasPersonaId, resolvedPersonaId, initialDbId, resolvedDbId]);

  useEffect(() => {
    if (diffAfter) {
      setPendingDiff({
        before: (diffBefore ?? "").toString(),
        after: diffAfter.toString(),
      });
    } else {
      setPendingDiff(null);
    }
  }, [diffBefore, diffAfter]);

  const escapeHtml = useCallback((text: string) => {
    return (text ?? "")
      .toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }, []);

  const splitHtmlToChunks = useCallback(
    (html: string) => {
      const raw = (html ?? "").toString();
      if (!raw.trim()) return [""];
      try {
        const parsed = new DOMParser().parseFromString(raw, "text/html");
        const children = Array.from(parsed.body.childNodes);
        const chunks: string[] = [];
        for (const n of children) {
          if (n.nodeType === 1) {
            chunks.push((n as Element).outerHTML);
          } else if (n.nodeType === 3) {
            const t = (n.textContent ?? "").toString().trim();
            if (t) chunks.push(`<p>${escapeHtml(t)}</p>`);
          }
        }
        if (chunks.length > 0) return chunks;
      } catch {
        void 0;
      }
      const lines = raw
        .split(/\r?\n/g)
        .map((l) => l.trimEnd())
        .filter(Boolean);
      if (lines.length === 0) return [raw];
      return lines.map((l) => `<p>${escapeHtml(l)}</p>`);
    },
    [escapeHtml]
  );

  useEffect(() => {
    if (streamingTimerRef.current !== null) {
      window.clearInterval(streamingTimerRef.current);
      streamingTimerRef.current = null;
    }
    if (!pendingDiff) {
      setIsStreaming(false);
      return;
    }
    const before = (pendingDiff.before ?? "").toString();
    const after = (pendingDiff.after ?? "").toString();
    if (!after.trim() || after === before) {
      setIsStreaming(false);
      return;
    }
    setIsStreaming(true);
    setContent(before);
    const chunks = splitHtmlToChunks(after);
    let index = 0;
    const tickMs = Math.min(320, Math.max(140, Math.round(3000 / Math.max(1, chunks.length))));
    streamingTimerRef.current = window.setInterval(() => {
      index = Math.min(index + 1, chunks.length);
      const next = chunks.slice(0, index).join("");
      setContent(next);
      if (index >= chunks.length) {
        if (streamingTimerRef.current !== null) {
          window.clearInterval(streamingTimerRef.current);
          streamingTimerRef.current = null;
        }
        setContent(after);
        setIsStreaming(false);
      }
    }, tickMs);

    return () => {
      if (streamingTimerRef.current !== null) {
        window.clearInterval(streamingTimerRef.current);
        streamingTimerRef.current = null;
      }
    };
  }, [pendingDiff, splitHtmlToChunks]);

  const stopStreaming = useCallback(() => {
    if (streamingTimerRef.current !== null) {
      window.clearInterval(streamingTimerRef.current);
      streamingTimerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (modeOverrideRef.current) return;
    if (isAlbum) {
      setMode("view");
      return;
    }
    setMode("edit");
  }, [isAlbum, isLoading]);

  const toggleMode = () => {
    const next = mode === "edit" ? "view" : "edit";
    modeOverrideRef.current = next;
    setMode(next);
  };

  const saveDoc = useCallback(async (currentContent: string, currentTitle: string, currentTypeRaw: string) => {
    try {
      setIsSaving(true);
      const payload = {
        id: resolvedDbId,
        persona_id: resolvedPersonaId || null,
        title: currentTitle,
        content: currentContent,
        type: currentTypeRaw,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("persona_docs")
        .upsert(payload);

      if (error) {
        console.error("Error saving doc:", error);
      } else {
        setLastSaved(new Date());
        docCache.set(resolvedDbId, {
          title: payload.title ?? "Untitled",
          content: payload.content ?? "",
          type: (payload.type ?? "persona").toString() || "persona",
          updated_at: payload.updated_at ?? null,
        });
        try {
          const sqlite = await getSqliteClient();
          await sqlite.upsertDoc({
            id: resolvedDbId,
            persona_id: resolvedPersonaId || null,
            title: payload.title ?? "Untitled",
            content: payload.content ?? "",
            type: (payload.type ?? "persona").toString() || "persona",
            updated_at: payload.updated_at ?? null,
          });
        } catch {
          void 0;
        }
        if (onDocUpdate) {
          onDocUpdate(payload);
        }
      }
    } catch (error) {
      console.error("Error saving doc:", error);
    } finally {
      setIsSaving(false);
    }
  }, [resolvedDbId, resolvedPersonaId, onDocUpdate]);

  const debouncedSave = useCallback((newContent: string, newTitle: string, newTypeRaw: string) => {
    if (isReverting) return;
    if (!isDirtyRef.current) return;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveDoc(newContent, newTitle, newTypeRaw);
    }, 500);
  }, [isReverting, saveDoc]);

  const handleAcceptDiff = () => {
    setPendingDiff(null);
    if (onDiffResolved) {
      onDiffResolved();
    }
  };

  const handleRevertDiff = async () => {
    if (!pendingDiff) return;
    try {
      setIsReverting(true);
      const nextContent = (pendingDiff.before ?? "").toString();
      setContent(nextContent);
      await saveDoc(nextContent, title, docTypeRaw);
      setPendingDiff(null);
      if (onDiffResolved) {
        onDiffResolved();
      }
    } catch {
      setPendingDiff(pendingDiff);
    } finally {
      setIsReverting(false);
    }
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isReverting) return;
    const newTitle = e.target.value;
    setTitle(newTitle);
    isDirtyRef.current = true;
    debouncedSave(content, newTitle, docTypeRaw);
  };

  const handleContentUpdate = (newContent: string) => {
    if (isReverting) return;
    if (isStreaming) stopStreaming();
    setContent(newContent);
    debouncedSave(newContent, title, docTypeRaw);
  };


  type PostMediaItem = { id: string; kind: "image" | "video"; url: string; duration_sec?: number | null };
  type PostDraft = {
    text: string;
    platform: string | null;
    account: string | null;
    media: PostMediaItem[];
    postType: string;
  };

  const mockAccounts = useMemo(
    () => [
      { id: "PRCrecluse674", name: "PRCrecluse674", platform: "X" },
      { id: "AIPersona_IG", name: "AIPersona Official", platform: "Instagram" },
      { id: "TechDaily", name: "Tech Daily News", platform: "LinkedIn" },
    ],
    []
  );

  const platformOptions = useMemo(() => ["X", "Instagram", "LinkedIn", "TikTok", "YouTube"], []);

  type UiLang = "en" | "zh";
  const uiLang = useMemo<UiLang>(() => {
    if (typeof navigator === "undefined") return "en";
    const v = (navigator.language ?? "en").toString().toLowerCase();
    return v.startsWith("zh") ? "zh" : "en";
  }, []);

  const formatPostTypeLabel = useCallback(
    (raw: string) => {
      const value = (raw ?? "").toString().trim();
      const normalized = value.toLowerCase();
      const code =
        value === "纯文字" || normalized === "text" || normalized === "pure_text" || normalized === "plain_text"
          ? "text"
          : value === "图文" || normalized === "image_text" || normalized === "image+text" || normalized === "image_text_post"
            ? "image_text"
            : value === "短视频" || normalized === "video_short" || normalized === "short_video"
              ? "video_short"
              : value === "长视频" || normalized === "video_long" || normalized === "long_video"
                ? "video_long"
                : "";

      if (uiLang === "zh") {
        if (code === "text") return "纯文字";
        if (code === "image_text") return "图文";
        if (code === "video_short") return "短视频";
        if (code === "video_long") return "长视频";
        return value || "纯文字";
      }

      if (code === "text") return "Text";
      if (code === "image_text") return "Image + text";
      if (code === "video_short") return "Short video";
      if (code === "video_long") return "Long video";
      return value || "Text";
    },
    [uiLang]
  );

  const computePostType = useCallback((draft: { media: PostMediaItem[] }) => {
    const media = Array.isArray(draft.media) ? draft.media : [];
    const videos = media.filter((m) => m.kind === "video");
    const images = media.filter((m) => m.kind === "image");
    if (videos.length > 0) {
      const max = Math.max(
        ...videos.map((v) => (typeof v.duration_sec === "number" && Number.isFinite(v.duration_sec) ? v.duration_sec : 0))
      );
      return max > 60 ? "video_long" : "video_short";
    }
    if (images.length > 0) return "image_text";
    return "text";
  }, []);

  const [postText, setPostText] = useState("");
  const [postPlatform, setPostPlatform] = useState<string | null>(null);
  const [postAccount, setPostAccount] = useState<string | null>(null);
  const [postMedia, setPostMedia] = useState<PostMediaItem[]>([]);
  const [postMediaUploading, setPostMediaUploading] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const postImageInputRef = useRef<HTMLInputElement>(null);
  const postVideoInputRef = useRef<HTMLInputElement>(null);
  const parsedPostRef = useRef(false);

  const buildPostDraft = useCallback(
    (overrides: Partial<PostDraft> = {}): PostDraft => {
      const base: PostDraft = {
        text: postText,
        platform: postPlatform,
        account: postAccount,
        media: postMedia,
        postType: computePostType({ media: postMedia }),
      };
      const next = { ...base, ...overrides };
      next.postType = computePostType({ media: next.media });
      return next;
    },
    [computePostType, postAccount, postMedia, postPlatform, postText]
  );

  const savePostDraft = useCallback(
    (draft: PostDraft) => {
      const json = JSON.stringify(draft);
      setContent(json);
      isDirtyRef.current = true;
      debouncedSave(json, title, docTypeRaw);
    },
    [debouncedSave, docTypeRaw, title]
  );

  useEffect(() => {
    if (isLoading) return;
    if (!isPost) {
      parsedPostRef.current = false;
      return;
    }
    if (parsedPostRef.current) return;
    const raw = (content ?? "").toString();
    try {
      const parsed = JSON.parse(raw) as Partial<PostDraft>;
      const text = typeof parsed.text === "string" ? parsed.text : "";
      const platform = typeof parsed.platform === "string" ? parsed.platform : null;
      const account = typeof parsed.account === "string" ? parsed.account : null;
      const media = Array.isArray(parsed.media)
        ? parsed.media
            .map((m): PostMediaItem | null => {
              const mo = (m ?? {}) as Record<string, unknown>;
              const kind: PostMediaItem["kind"] = mo.kind === "video" ? "video" : "image";
              const url = String(mo.url ?? "");
              const duration_sec =
                typeof mo.duration_sec === "number" && Number.isFinite(mo.duration_sec) ? mo.duration_sec : null;
              const id = String(mo.id ?? crypto.randomUUID());
              if (!url) return null;
              return { id, kind, url, duration_sec };
            })
            .filter((m): m is PostMediaItem => m !== null)
        : [];
      setPostText(text);
      setPostPlatform(platform);
      setPostAccount(account);
      setPostMedia(media);
      parsedPostRef.current = true;
    } catch {
      setPostText(raw);
      setPostPlatform(null);
      setPostAccount(null);
      setPostMedia([]);
      parsedPostRef.current = true;
    }
  }, [content, isLoading, isPost]);

  const uploadToSupabase = useCallback(async (file: File) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) throw new Error("Not signed in");

    const primaryBucket = "persona-media";
    const fallbackBucket = "chat-attachments";
    const safeName = (file.name || "upload").replace(/[^\w.\- ]+/g, "_");
    const personaSegment = resolvedPersonaId || "no-persona";
    const key = `${uid}/${personaSegment}/${resolvedDbId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;

    const attempt = async (bucket: string) => {
      const { error } = await supabase.storage.from(bucket).upload(key, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from(bucket).getPublicUrl(key);
      if (!data.publicUrl) throw new Error("Failed to get public url");
      return data.publicUrl;
    };

    try {
      return await attempt(primaryBucket);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      if (!/bucket/i.test(msg) && !/not found/i.test(msg)) throw e instanceof Error ? e : new Error(msg);
      return await attempt(fallbackBucket);
    }
  }, [resolvedPersonaId, resolvedDbId]);

  const getVideoDurationSeconds = useCallback(async (file: File): Promise<number | null> => {
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
  }, []);

  const handlePostFilesSelected = useCallback(
    async (files: FileList | null, kind: "image" | "video") => {
      if (!isPost) return;
      if (!files || files.length === 0) return;
      if (postMediaUploading) return;
      setPostMediaUploading(true);
      setPostError(null);
      try {
        const next: PostMediaItem[] = [];
        for (const file of Array.from(files)) {
          if (kind === "image" && !file.type.startsWith("image/")) continue;
          if (kind === "video" && !file.type.startsWith("video/")) continue;
          const url = await uploadToSupabase(file);
          const duration = kind === "video" ? await getVideoDurationSeconds(file) : null;
          next.push({ id: crypto.randomUUID(), kind, url, duration_sec: duration });
        }
        if (next.length > 0) {
          const merged = [...postMedia, ...next];
          setPostMedia(merged);
          savePostDraft(buildPostDraft({ media: merged }));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Upload failed";
        setPostError(
          msg.includes("Bucket") || msg.includes("bucket")
            ? `${msg}. 请在 Supabase Storage 创建 bucket: persona-media（建议设为 public），并允许 authenticated 上传。`
            : msg
        );
      } finally {
        setPostMediaUploading(false);
      }
    },
    [buildPostDraft, getVideoDurationSeconds, isPost, postMedia, postMediaUploading, savePostDraft, uploadToSupabase]
  );

  return (
    <div className="mx-auto max-w-4xl px-8 pb-8 pt-4 bg-white dark:bg-zinc-950 h-full overflow-y-auto">
      <div className="pb-4">
        <div className="mb-8 group relative">
          <input
            type="text"
            value={title}
            onChange={handleTitleChange}
            placeholder="Untitled"
            disabled={isStreaming || isReverting}
            className="w-full bg-transparent text-4xl font-bold text-zinc-900 placeholder:text-zinc-300 focus:outline-none dark:text-zinc-50 dark:placeholder:text-zinc-700"
          />
          <div className="mt-4 flex items-center gap-4 text-sm text-zinc-500">
             {isAlbum && (
               <button
                 type="button"
                 onClick={toggleMode}
                 className="px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-600 dark:text-zinc-300"
               >
                 {mode === "edit" ? "View" : "Edit"}
               </button>
             )}
             
             <div className="flex items-center gap-2">
               {isSaving && <span className="text-zinc-400">Saving...</span>}
               {!isSaving && lastSaved && (
                 <span className="text-zinc-400">Saved {lastSaved.toLocaleTimeString()}</span>
               )}
             </div>
          </div>
        </div>
      </div>
      {pendingDiff && (
        <div className="pb-4">
          <div className="mb-6 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-medium">
                {isStreaming ? "Applying changes..." : "Changes completed, please confirm adoption."}
              </div>
              {!isStreaming && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleAcceptDiff}
                    className="inline-flex items-center justify-center rounded-lg border border-emerald-500 bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
                    disabled={isReverting}
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    onClick={handleRevertDiff}
                    className="inline-flex items-center justify-center rounded-lg border border-red-500 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-500 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-950/40"
                    disabled={isReverting}
                  >
                    {isReverting ? "Reverting..." : "Revert"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )
      }

      <div className="min-h-[500px]">
        {!isLoading && isPost && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Platform</div>
                <select
                  value={(postPlatform ?? "").toString()}
                  onChange={(e) => {
                    const nextPlatform = e.target.value || null;
                    setPostPlatform(nextPlatform);
                    const nextAccount =
                      nextPlatform && postAccount
                        ? mockAccounts.find((a) => a.id === postAccount && a.platform === nextPlatform)
                          ? postAccount
                          : null
                        : postAccount;
                    setPostAccount(nextAccount);
                    savePostDraft(buildPostDraft({ platform: nextPlatform, account: nextAccount }));
                  }}
                  className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                >
                  <option value="">Select</option>
                  {platformOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Account</div>
                <select
                  value={(postAccount ?? "").toString()}
                  onChange={(e) => {
                    const nextAccount = e.target.value || null;
                    setPostAccount(nextAccount);
                    const nextPlatform = nextAccount
                      ? (mockAccounts.find((a) => a.id === nextAccount)?.platform ?? postPlatform)
                      : postPlatform;
                    if (nextPlatform !== postPlatform) setPostPlatform(nextPlatform ?? null);
                    savePostDraft(buildPostDraft({ account: nextAccount, platform: nextPlatform ?? null }));
                  }}
                  className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                  disabled={!postPlatform}
                >
                  <option value="">{postPlatform ? "Select" : "Select platform first"}</option>
                  {mockAccounts
                    .filter((a) => !postPlatform || a.platform === postPlatform)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="ml-auto inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                {uiLang === "zh" ? "类型" : "Type"}
                {uiLang === "zh" ? "：" : ":"} {formatPostTypeLabel(computePostType({ media: postMedia }))}
              </div>
            </div>

            {postError ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">
                {postError}
              </div>
            ) : null}

            <div className="relative flex min-h-[280px] flex-col rounded-xl border border-zinc-200 bg-white transition-shadow focus-within:border-zinc-400 focus-within:ring-1 focus-within:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950">
              <textarea
                value={postText}
                onChange={(e) => {
                  const nextText = e.target.value;
                  setPostText(nextText);
                  savePostDraft(buildPostDraft({ text: nextText }));
                }}
                placeholder="What’s happening?"
                className="flex-1 resize-none bg-transparent p-4 text-base text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50"
              />

              <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50/50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/30">
                <div className="text-xs text-zinc-500">{postText.length} / 25000</div>
                <div className="flex items-center gap-2">
                  <input
                    ref={postImageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void handlePostFilesSelected(e.target.files, "image");
                      e.currentTarget.value = "";
                    }}
                  />
                  <input
                    ref={postVideoInputRef}
                    type="file"
                    accept="video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void handlePostFilesSelected(e.target.files, "video");
                      e.currentTarget.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => postImageInputRef.current?.click()}
                    disabled={postMediaUploading}
                    className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-200 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    aria-label="Add image"
                  >
                    {postMediaUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-5 w-5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => postVideoInputRef.current?.click()}
                    disabled={postMediaUploading}
                    className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-200 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    aria-label="Add video"
                  >
                    {postMediaUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileVideo className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {postMedia.length > 0 ? (
                <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {postMedia.map((m) => (
                      <div key={m.id} className="relative overflow-hidden rounded-2xl bg-zinc-100 dark:bg-zinc-900">
                        {m.kind === "image" ? (
                          <img src={m.url} alt="" className="h-36 w-full object-cover" />
                        ) : (
                          <video src={m.url} controls preload="metadata" className="h-36 w-full object-cover" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {!isLoading && !isPost && mode === "edit" && (
          <div
            onPointerDownCapture={() => {
              isDirtyRef.current = true;
            }}
            onKeyDownCapture={() => {
              isDirtyRef.current = true;
            }}
          >
            <RichEditor
              initialContent={content}
              value={content}
              onUpdate={handleContentUpdate}
              editable={!isReverting}
              diff={pendingDiff ? { before: pendingDiff.before, after: content } : null}
            />
          </div>
        )}
        {!isLoading && mode === "view" && isAlbum && (
          <div className="space-y-4">
            {albumMedia.length === 0 ? (
              <div className="text-sm text-zinc-400">No media</div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {albumMedia.map((it) => (
                  <div
                    key={`${it.kind}:${it.src}`}
                    className="relative overflow-hidden rounded-2xl bg-zinc-100 shadow-sm dark:bg-zinc-900"
                  >
                    {it.kind === "image" ? (
                      <img src={it.src} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <video src={it.src} controls preload="metadata" className="h-full w-full object-cover" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {isLoading && (
          <div className="space-y-4 animate-pulse mt-8">
            <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4"></div>
            <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-1/2"></div>
            <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-5/6"></div>
            <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-2/3"></div>
          </div>
        )}
      </div>
    </div>
  );
}
