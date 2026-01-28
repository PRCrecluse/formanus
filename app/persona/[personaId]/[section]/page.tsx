"use client";

import { useEffect, useMemo, useRef, useState, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Folder, FolderOpen, Plus, FileText, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { cn, getCleanPersonaDocId, makePersonaDocDbId, normalizePersonaDocType } from "@/lib/utils";

type Row = {
  id: string;
  title: string | null;
  type: string | null;
  content: string | null;
  updated_at: string | null;
  is_folder?: boolean | null;
  parent_id?: string | null;
};

export default function PersonaSectionPage({
  params,
}: {
  params: Promise<{ personaId: string; section: string }>;
}) {
  const { personaId: rawPersonaId, section: rawSection } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  const personaId = useMemo(() => decodeURIComponent(rawPersonaId), [rawPersonaId]);
  const rawSectionName = useMemo(() => decodeURIComponent(rawSection), [rawSection]);

  const sectionType = useMemo(() => {
    const normalized = normalizePersonaDocType(rawSectionName);
    if (rawSectionName === "albums" || rawSectionName === "photos" || rawSectionName === "videos") return "albums";
    if (rawSectionName === "posts") return "posts";
    if (normalized === "persona") return null;
    return normalized;
  }, [rawSectionName]);

  const folderId = searchParams.get("folder");

  const [folders, setFolders] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [folderTitle, setFolderTitle] = useState<string | null>(null);
  const [resolvedParentDbId, setResolvedParentDbId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [folderChildItems, setFolderChildItems] = useState<Record<string, Row[]>>({});
  const [hoveredPreviewKey, setHoveredPreviewKey] = useState<string | null>(null);
  const [showAlbumUpload, setShowAlbumUpload] = useState(false);
  const [albumUploadError, setAlbumUploadError] = useState<string | null>(null);
  const [albumUploading, setAlbumUploading] = useState(false);
  const albumFileInputRef = useRef<HTMLInputElement>(null);

  const title = useMemo(() => {
    if (sectionType === "albums") return "Photos&Videos";
    if (sectionType === "posts") return "Posts";
    return rawSectionName;
  }, [rawSectionName, sectionType]);

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

  const getRowParentId = (row: Row) => {
    if (row.parent_id !== undefined && row.parent_id !== null) return row.parent_id;
    const { meta } = parseTypeMeta(row.type);
    const p = meta.parent ? meta.parent.trim() : "";
    return p ? p : null;
  };

  const getRowIsFolder = (row: Row) => {
    if (row.is_folder !== undefined && row.is_folder !== null) return Boolean(row.is_folder);
    const clean = getCleanPersonaDocId(personaId, row.id);
    if (clean.startsWith("folder-")) return true;
    const { meta } = parseTypeMeta(row.type);
    return meta.folder === "1";
  };

  const renderPreviewStack = (hostId: string, previews: Row[]) => {
    const visible = previews.slice(0, 3).map((p) => ({
      id: p.id,
      title: (p.title ?? "").toString(),
      updated_at: (p.updated_at ?? "").toString(),
    }));

    if (visible.length === 0) {
      return (
        <div className="flex items-end">
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className={`h-[140px] w-[110px] shrink-0 rounded-[18px] bg-zinc-100/70 dark:bg-zinc-800/40 ${
                idx === 0 ? "" : "-ml-[18px]"
              }`}
              style={{ zIndex: 30 - idx }}
            />
          ))}
        </div>
      );
    }

    return (
      <div className="flex items-end">
        {visible.map((p, idx) => {
          const key = `${hostId}:${p.id}`;
          const isHovered = hoveredPreviewKey === key;
          return (
            <div
              key={p.id}
              onMouseEnter={() => setHoveredPreviewKey(key)}
              onMouseLeave={() => setHoveredPreviewKey(null)}
              className={cn(
                "h-[140px] w-[110px] shrink-0 rounded-[18px] border border-zinc-200 bg-white p-3 shadow-[0_10px_20px_rgba(0,0,0,0.10)] transition-transform duration-150 dark:border-zinc-800 dark:bg-zinc-950",
                idx === 0 ? "" : "-ml-[18px]",
                isHovered ? "-translate-y-2" : ""
              )}
              style={{ zIndex: isHovered ? 50 : 30 - idx }}
            >
              <div className="flex h-full flex-col">
                <div className="line-clamp-2 text-[12px] font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                  {p.title || "Untitled"}
                </div>
                <div className="mt-auto text-[11px] text-zinc-500 dark:text-zinc-400">
                  {p.updated_at ? new Date(p.updated_at).toLocaleDateString() : "—"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setErrorText(null);

      if (!sectionType) {
        setFolders([]);
        setItems([]);
        setFolderTitle(null);
        setLoading(false);
        return;
      }

      try {
        const base = supabase.from("persona_docs").select("*");
        const builder =
          personaId === "__private__"
            ? base.is("persona_id", null)
            : base.or(`persona_id.eq.${personaId},id.like.${personaId}-%`);
        const { data, error } = await builder.order("updated_at", { ascending: false });

        if (error) throw new Error(error.message);

        const allRows = ((data as Row[]) ?? []).filter((r) => normalizePersonaDocType(r.type) === sectionType);
        const candidates = folderId ? [makePersonaDocDbId(personaId, folderId), folderId] : [];
        const foundFolder = folderId ? allRows.find((r) => getRowIsFolder(r) && candidates.includes(r.id)) : null;
        const parentId = folderId ? (foundFolder?.id ?? candidates[0]) : null;

        const visibleRows = allRows.filter((r) => {
          const p = getRowParentId(r);
          if (!parentId) return p === null;
          return p === parentId || (folderId ? p === folderId || p === makePersonaDocDbId(personaId, folderId) : false);
        });

        const childItemsMap: Record<string, Row[]> = {};
        const childrenByParent: Record<string, Row[]> = {};
        for (const r of allRows) {
          const p = getRowParentId(r);
          if (!p) continue;
          if (!childrenByParent[p]) childrenByParent[p] = [];
          childrenByParent[p].push(r);
        }
        for (const f of visibleRows.filter((r) => getRowIsFolder(r))) {
          const children = (childrenByParent[f.id] ?? []).filter((r) => !getRowIsFolder(r));
          childItemsMap[f.id] = [...children]
            .sort((a, b) => {
              const aTime = a.updated_at ? Date.parse(a.updated_at) : 0;
              const bTime = b.updated_at ? Date.parse(b.updated_at) : 0;
              return bTime - aTime;
            })
            .slice(0, 4);
        }

        if (!mounted) return;
        setResolvedParentDbId(parentId);
        setFolderTitle(parentId ? (allRows.find((r) => r.id === parentId)?.title ?? null) : null);
        setFolders(visibleRows.filter((r) => getRowIsFolder(r)));
        setItems(visibleRows.filter((r) => !getRowIsFolder(r)));
        setFolderChildItems(childItemsMap);
      } catch (err) {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : "Load failed";
        setErrorText(message);
        setFolders([]);
        setItems([]);
        setFolderChildItems({});
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [personaId, sectionType, folderId]);

  useEffect(() => {
    if (sectionType !== "albums") return;
    for (const d of items.slice(0, 12)) {
      const cleanId = getCleanPersonaDocId(personaId, d.id);
      router.prefetch(`/persona/${encodeURIComponent(personaId)}/docs/${encodeURIComponent(cleanId)}`);
    }
  }, [items, personaId, router, sectionType]);

  const goRoot = () => {
    router.push(`/persona/${encodeURIComponent(personaId)}/${encodeURIComponent(rawSectionName)}`);
  };

  const openFolder = (dbId: string) => {
    const cleanId = getCleanPersonaDocId(personaId, dbId);
    router.push(
      `/persona/${encodeURIComponent(personaId)}/${encodeURIComponent(rawSectionName)}?folder=${encodeURIComponent(cleanId)}`
    );
  };

  const openDoc = (dbId: string) => {
    const cleanId = getCleanPersonaDocId(personaId, dbId);
    router.push(`/persona/${encodeURIComponent(personaId)}/docs/${encodeURIComponent(cleanId)}`);
  };

  const createFolder = async () => {
    if (!sectionType) return;
    const name = window.prompt("Folder name")?.trim();
    if (!name) return;
    const folderDocId = `folder-${Date.now()}`;
    const dbId = makePersonaDocDbId(personaId, folderDocId);

    const nowIso = new Date().toISOString();
    const type = `${sectionType};folder=1;parent=${resolvedParentDbId ?? ""}`;
    const { error } = await supabase.from("persona_docs").upsert({
      id: dbId,
      persona_id: personaId,
      title: name,
      content: "",
      type,
      updated_at: nowIso,
    });

    if (error) {
      window.alert(error.message);
      return;
    }

    router.refresh();
    openFolder(dbId);
  };

  const createItem = async () => {
    if (!sectionType) return;
    if (sectionType === "albums") {
      setAlbumUploadError(null);
      setShowAlbumUpload(true);
      return;
    }
    const docId = `new-${Date.now()}`;
    const dbId = makePersonaDocDbId(personaId, docId);

    const nowIso = new Date().toISOString();
    const type = `${sectionType};folder=0;parent=${resolvedParentDbId ?? ""}`;
    const { error } = await supabase.from("persona_docs").upsert({
      id: dbId,
      persona_id: personaId,
      title: sectionType === "posts" ? "Untitled Post" : "Untitled Album",
      content: "",
      type,
      updated_at: nowIso,
    });

    if (error) {
      window.alert(error.message);
      return;
    }

    openDoc(dbId);
  };

  const uploadToSupabase = async (file: File) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) throw new Error("Not signed in");

    const primaryBucket = "persona-media";
    const fallbackBucket = "chat-attachments";
    const safeName = (file.name || "upload").replace(/[^\w.\- ]+/g, "_");
    const key = `${uid}/${personaId}/${resolvedParentDbId ?? "root"}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;

    const attempt = async (bucket: string) => {
      const { error } = await supabase.storage.from(bucket).upload(key, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from(bucket).getPublicUrl(key);
      if (!data.publicUrl) throw new Error("Failed to get public url");
      return { bucket, key, url: data.publicUrl };
    };

    try {
      return await attempt(primaryBucket);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      if (!/bucket/i.test(msg) && !/not found/i.test(msg)) throw e instanceof Error ? e : new Error(msg);
      return await attempt(fallbackBucket);
    }
  };

  const handleAlbumFilesSelected = async (files: FileList | null) => {
    if (!sectionType || sectionType !== "albums") return;
    if (!files || files.length === 0) return;
    if (albumUploading) return;
    setAlbumUploading(true);
    setAlbumUploadError(null);
    try {
      for (const file of Array.from(files)) {
        const isImage = file.type.startsWith("image/");
        const isVideo = file.type.startsWith("video/");
        if (!isImage && !isVideo) continue;
        const uploaded = await uploadToSupabase(file);
        const docId = `media-${Date.now()}-${crypto.randomUUID()}`;
        const dbId = makePersonaDocDbId(personaId, docId);
        const nowIso = new Date().toISOString();
        const type = `albums;folder=0;parent=${resolvedParentDbId ?? ""};media=1`;
        const mediaHtml = isImage
          ? `<p><img src="${uploaded.url}" /></p>`
          : `<p><video src="${uploaded.url}" controls></video></p>`;
        const { error } = await supabase.from("persona_docs").upsert({
          id: dbId,
          persona_id: personaId,
          title: file.name || "Untitled",
          content: mediaHtml,
          type,
          updated_at: nowIso,
        });
        if (error) throw new Error(error.message);
      }
      setShowAlbumUpload(false);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setAlbumUploadError(
        msg.includes("Bucket") || msg.includes("bucket")
          ? `${msg}. 请在 Supabase Storage 创建 bucket: persona-media（建议设为 public），并允许 authenticated 上传。`
          : msg
      );
    } finally {
      setAlbumUploading(false);
    }
  };

  const getAlbumItemPreview = (row: Row) => {
    const html = (row.content ?? "").toString();
    const img = /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1] ?? null;
    if (img) return { kind: "image" as const, src: img };
    const vid = /<video[^>]+src=["']([^"']+)["']/i.exec(html)?.[1] ?? null;
    if (vid) return { kind: "video" as const, src: vid };
    return null;
  };

  if (!sectionType) {
    return (
      <div className="p-6">
        <div className="text-2xl font-semibold">{rawSectionName}</div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col">
      <div className="flex items-center justify-between bg-white px-6 py-5 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          {resolvedParentDbId && (
            <button
              type="button"
              onClick={goRoot}
              className="inline-flex items-center gap-2 rounded-xl bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back</span>
            </button>
          )}
          <div className="flex flex-col">
            <div className="text-2xl font-bold">{title}</div>
            {resolvedParentDbId && (
              <div className="text-sm text-zinc-500">{folderTitle || "Folder"}</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={createFolder}
            className="inline-flex items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Folder className="h-4 w-4" />
            <span>New Folder</span>
          </button>
          <button
            type="button"
            onClick={createItem}
            className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-zinc-50 dark:text-zinc-900"
          >
            <Plus className="h-4 w-4" />
            <span>New</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {errorText && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
            {errorText}
          </div>
        )}

        {loading && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {[1, 2, 3, 4, 5, 6].map((k) => (
              <div key={k} className="h-28 rounded-xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && (
          <>
            {!folderId ? (
              <div className="space-y-4">
                {folders.length === 0 ? (
                  <div className="text-sm text-zinc-400">No folders</div>
                ) : (
                  folders.map((f) => {
                    const previews = folderChildItems[f.id] ?? [];
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => openFolder(f.id)}
                        className="w-full rounded-3xl border border-[#ECECEC] bg-[#F7F7F7] p-6 text-left shadow-[0_10px_20px_rgba(0,0,0,0.10)] transition-shadow hover:shadow-[0_10px_20px_rgba(0,0,0,0.12)] dark:border-zinc-800 dark:bg-zinc-900"
                      >
                        <div className="flex min-w-0 items-center gap-4">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            <FolderOpen className="h-6 w-6" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                              {f.title || "Untitled"}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4">{renderPreviewStack(f.id, previews)}</div>
                      </button>
                    );
                  })
                )}

                {folders.length === 0 && items.length > 0 && (
                  <div>
                    <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                      {sectionType === "posts" ? "Posts" : "Albums"}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => openDoc(d.id)}
                          draggable
                          onDragStart={(e) => {
                            try {
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData(
                                "application/json",
                                JSON.stringify({ dbId: d.id, sourcePersonaId: personaId })
                              );
                            } catch {
                              void 0;
                            }
                          }}
                          className="flex items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm hover:bg-zinc-50 hover:shadow-md transition-shadow dark:bg-zinc-900 dark:hover:bg-zinc-900/60"
                        >
                          {sectionType === "albums" ? (
                            <div className="h-10 w-10 overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800">
                              {(() => {
                                const prev = getAlbumItemPreview(d);
                                if (!prev) return null;
                                if (prev.kind === "image") {
                                  return <img src={prev.src} alt="" className="h-full w-full object-cover" />;
                                }
                                return (
                                  <video
                                    src={prev.src}
                                    muted
                                    playsInline
                                    preload="metadata"
                                    className="h-full w-full object-cover"
                                  />
                                );
                              })()}
                            </div>
                          ) : (
                            <FileText className="h-5 w-5 text-blue-500" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                              {d.title || "Untitled"}
                            </div>
                            <div className="mt-1 text-xs text-zinc-500">
                              {d.updated_at ? new Date(d.updated_at).toLocaleDateString() : "Unknown"}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-8">
                <div>
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Folders</div>
                  {folders.length === 0 ? (
                    <div className="text-sm text-zinc-400">No folders</div>
                  ) : (
                    <div className="space-y-3">
                      {folders.map((f) => {
                        const previews = folderChildItems[f.id] ?? [];
                        return (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => openFolder(f.id)}
                            className="w-full rounded-3xl border border-[#ECECEC] bg-[#F7F7F7] p-6 text-left shadow-[0_10px_20px_rgba(0,0,0,0.10)] transition-shadow hover:shadow-[0_10px_20px_rgba(0,0,0,0.12)] dark:border-zinc-800 dark:bg-zinc-900"
                          >
                            <div className="flex min-w-0 items-center gap-4">
                              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                <FolderOpen className="h-6 w-6" />
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                                  {f.title || "Untitled"}
                                </div>
                              </div>
                            </div>

                            <div className="mt-4">{renderPreviewStack(f.id, previews)}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {sectionType === "posts" ? "Posts" : "Albums"}
                  </div>
                  {items.length === 0 ? (
                    <div className="text-sm text-zinc-400">No items</div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => openDoc(d.id)}
                          draggable
                          onDragStart={(e) => {
                            try {
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData(
                                "application/json",
                                JSON.stringify({ dbId: d.id, sourcePersonaId: personaId })
                              );
                            } catch {
                              void 0;
                            }
                          }}
                          className="flex items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm hover:bg-zinc-50 hover:shadow-md transition-shadow dark:bg-zinc-900 dark:hover:bg-zinc-900/60"
                        >
                          {sectionType === "albums" ? (
                            <div className="h-10 w-10 overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800">
                              {(() => {
                                const prev = getAlbumItemPreview(d);
                                if (!prev) return null;
                                if (prev.kind === "image") {
                                  return <img src={prev.src} alt="" className="h-full w-full object-cover" />;
                                }
                                return (
                                  <video
                                    src={prev.src}
                                    muted
                                    playsInline
                                    preload="metadata"
                                    className="h-full w-full object-cover"
                                  />
                                );
                              })()}
                            </div>
                          ) : (
                            <FileText className="h-5 w-5 text-blue-500" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                              {d.title || "Untitled"}
                            </div>
                            <div className="mt-1 text-xs text-zinc-500">
                              {d.updated_at ? new Date(d.updated_at).toLocaleDateString() : "Unknown"}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showAlbumUpload && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => {
              if (albumUploading) return;
              setShowAlbumUpload(false);
            }}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
              <div className="text-lg font-bold text-zinc-900 dark:text-zinc-50">Upload photos & videos</div>
              <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {resolvedParentDbId ? "This will upload into the current folder." : "This will upload into Albums."}
              </div>

              {albumUploadError ? (
                <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">
                  {albumUploadError}
                </div>
              ) : null}

              <input
                ref={albumFileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleAlbumFilesSelected(e.target.files);
                  e.currentTarget.value = "";
                }}
              />

              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  disabled={albumUploading}
                  onClick={() => albumFileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  Choose files
                </button>
                <button
                  type="button"
                  disabled={albumUploading}
                  onClick={() => setShowAlbumUpload(false)}
                  className="ml-auto rounded-lg px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  Cancel
                </button>
              </div>

              {albumUploading ? (
                <div className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Uploading…</div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
