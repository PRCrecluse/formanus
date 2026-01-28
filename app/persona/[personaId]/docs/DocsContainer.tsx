"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { FileText, ArrowLeft, Folder, FolderOpen, Plus } from "lucide-react";
import { cn, getCleanPersonaDocId, makePersonaDocDbId, normalizePersonaDocType } from "@/lib/utils";

interface Doc {
  id: string;
  title: string;
  type?: string | null;
  updated_at: string;
}

interface DocsContainerProps {
  personaId: string;
  initialDocs: Doc[];
  folderName?: string | null;
  folderId?: string | null;
}

export default function DocsContainer({ personaId, initialDocs, folderName, folderId }: DocsContainerProps) {
  const [docs, setDocs] = useState<Doc[]>(initialDocs);
  const [hoveredPreviewKey, setHoveredPreviewKey] = useState<string | null>(null);
  const [previewSnippets, setPreviewSnippets] = useState<Record<string, string>>({});
  const router = useRouter();

  const toPlainTextSnippet = (raw: string) => {
    const noScripts = raw.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ");
    const noStyles = noScripts.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ");
    const noTags = noStyles.replace(/<[^>]+>/g, " ");
    return noTags.replace(/\s+/g, " ").trim();
  };

  useEffect(() => {
    setDocs(initialDocs);
  }, [initialDocs]);

  const getCleanDocId = (dbId: string) => getCleanPersonaDocId(personaId, dbId);

  const folderState = useMemo(() => {
    type Row = Doc & { is_folder?: boolean | null; parent_id?: string | null };

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

    const allRows = ((docs as Row[]) ?? []).filter((r) => normalizePersonaDocType(r.type) === "persona");

    const effectiveFolderId = folderId ?? null;
    const isPersonaDocsRoot = effectiveFolderId === "persona-docs";

    const candidates =
      effectiveFolderId && !isPersonaDocsRoot
        ? [makePersonaDocDbId(personaId, effectiveFolderId), effectiveFolderId]
        : [];

    const foundFolder =
      effectiveFolderId && !isPersonaDocsRoot
        ? allRows.find((r) => getRowIsFolder(r) && candidates.includes(r.id))
        : null;

    const parentDbId = isPersonaDocsRoot
      ? null
      : effectiveFolderId
        ? (foundFolder?.id ?? candidates[0] ?? null)
        : null;

    const visibleRows = allRows.filter((r) => {
      const p = getRowParentId(r);
      if (!parentDbId) return p === null;
      return (
        p === parentDbId ||
        (effectiveFolderId
          ? p === effectiveFolderId || p === makePersonaDocDbId(personaId, effectiveFolderId)
          : false)
      );
    });

    const childrenByParent: Record<string, Row[]> = {};
    for (const r of allRows) {
      const p = getRowParentId(r);
      if (!p) continue;
      if (!childrenByParent[p]) childrenByParent[p] = [];
      childrenByParent[p].push(r);
    }

    const childItemsMap: Record<string, Row[]> = {};
    for (const f of visibleRows.filter((r) => getRowIsFolder(r))) {
      const children = (childrenByParent[f.id] ?? []).filter((r) => !getRowIsFolder(r));
      childItemsMap[f.id] = [...children]
        .sort((a, b) => {
          const aTime = a.updated_at ? Date.parse(a.updated_at) : 0;
          const bTime = b.updated_at ? Date.parse(b.updated_at) : 0;
          return bTime - aTime;
        })
        .slice(0, 3);
    }

    return {
      isPersonaDocsRoot,
      parentDbId,
      folders: visibleRows.filter((r) => getRowIsFolder(r)),
      items: visibleRows.filter((r) => !getRowIsFolder(r)),
      folderChildItems: childItemsMap,
    };
  }, [docs, folderId, personaId]);

  const openFolder = (dbId: string) => {
    const cleanId = getCleanDocId(dbId);
    router.push(`/persona/${encodeURIComponent(personaId)}/docs?folder=${encodeURIComponent(cleanId)}`);
  };

  const goUp = () => {
    if (folderId === "persona-docs") {
      router.push(`/persona/${encodeURIComponent(personaId)}/docs`);
      return;
    }
    router.push(`/persona/${encodeURIComponent(personaId)}/docs?folder=persona-docs`);
  };

  const isInDocsSecondLevel = Boolean(folderId);

  const createFolder = async () => {
    const name = window.prompt("Folder name")?.trim();
    if (!name) return;
    const folderDocId = `folder-${Date.now()}`;
    const dbId = makePersonaDocDbId(personaId, folderDocId);
    const nowIso = new Date().toISOString();
    const type = `persona;folder=1;parent=${folderState.parentDbId ?? ""}`;
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
    setDocs((prev) => [{ id: dbId, title: name, type, updated_at: nowIso }, ...prev]);
    openFolder(dbId);
  };

  const createDoc = async () => {
    const docId = `new-${Date.now()}`;
    const dbId = makePersonaDocDbId(personaId, docId);
    const nowIso = new Date().toISOString();
    const type = `persona;folder=0;parent=${folderState.parentDbId ?? ""}`;
    const { error } = await supabase.from("persona_docs").upsert({
      id: dbId,
      persona_id: personaId,
      title: "Untitled",
      content: "",
      type,
      updated_at: nowIso,
    });
    if (error) {
      window.alert(error.message);
      return;
    }
    setDocs((prev) => [{ id: dbId, title: "Untitled", type, updated_at: nowIso }, ...prev]);
    router.push(`/persona/${encodeURIComponent(personaId)}/docs/${encodeURIComponent(docId)}`);
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const previewIds = Object.values(folderState.folderChildItems)
        .flat()
        .map((r) => r.id)
        .filter(Boolean);
      const uniqueIds = Array.from(new Set(previewIds));
      const idsToFetch = uniqueIds.filter((id) => !(id in previewSnippets)).slice(0, 60);
      if (idsToFetch.length === 0) return;

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!token) return;

      const results = await Promise.all(
        idsToFetch.map(async (docDbId) => {
          const r = await fetch(`/api/persona-docs/${encodeURIComponent(docDbId)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!r.ok) return { id: docDbId, snippet: "" };
          const data = (await r.json()) as { content?: string | null };
          const raw = (data?.content ?? "").toString();
          const text = toPlainTextSnippet(raw);
          return { id: docDbId, snippet: text };
        })
      );

      if (cancelled) return;
      setPreviewSnippets((prev) => {
        const next = { ...prev };
        for (const it of results) next[it.id] = it.snippet;
        return next;
      });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [folderState.folderChildItems, previewSnippets]);

  const renderPreviewStack = (
    hostId: string,
    previews: Array<{ id: string; title: string; updated_at: string }>
  ) => {
    if (previews.length === 0) {
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
        {previews.map((p, idx) => {
          const key = `${hostId}:${p.id}`;
          const isHovered = hoveredPreviewKey === key;
          const snippet = (previewSnippets[p.id] ?? "").trim();
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
                <div className="mt-2 line-clamp-3 flex-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                  {snippet ? snippet : "—"}
                </div>
                <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {p.updated_at ? new Date(p.updated_at).toLocaleDateString() : "—"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const handleDocClick = (dbId: string) => {
    const cleanId = getCleanDocId(dbId);
    router.push(`/persona/${encodeURIComponent(personaId)}/docs/${encodeURIComponent(cleanId)}`);
  };

  const getGroupKey = (t: unknown) => {
    const raw = typeof t === "string" ? t : String(t ?? "");
    const base = raw.split(/[;:#|]/)[0];
    if (base === "persona") return "persona";
    if (base === "posts") return "posts";
    if (base === "videos") return "videos";
    if (base === "photos") return "photos";
    if (base === "albums") return "photos";
    return "persona";
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]"> 
      {/* Toolbar */}
      <div className="flex items-center justify-between bg-white px-6 py-3 dark:bg-zinc-900">
        <div className="flex min-w-0 items-center gap-3">
          {isInDocsSecondLevel && (
            <button
              type="button"
              onClick={goUp}
              className="inline-flex items-center gap-2 rounded-xl bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back</span>
            </button>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">
              Docs
            </div>
            {folderName && folderId !== "persona-docs" && (
              <div className="truncate text-xs text-zinc-500">{folderName}</div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void createFolder()}
            className="inline-flex items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Folder className="h-4 w-4" />
            <span>New Folder</span>
          </button>
          <button
            type="button"
            onClick={() => void createDoc()}
            className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-zinc-50 dark:text-zinc-900"
          >
            <Plus className="h-4 w-4" />
            <span>New</span>
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden">
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto h-full">
          {folderState.folders.map((f) => {
            const previews = folderState.folderChildItems[f.id] ?? [];
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

          {folderState.items.map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => handleDocClick(doc.id)}
              draggable
              onDragStart={(e) => {
                try {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData(
                    "application/json",
                    JSON.stringify({ dbId: doc.id, sourcePersonaId: personaId })
                  );
                } catch {
                  void 0;
                }
              }}
              className="flex flex-col p-6 rounded-xl bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer dark:bg-zinc-900 text-left"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                  <FileText size={24} />
                </div>
                {doc.type && (
                  <span className="text-xs px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 capitalize">
                    {getGroupKey(doc.type)}
                  </span>
                )}
              </div>
              <h3 className="font-semibold text-lg mb-2 line-clamp-1">{doc.title || "Untitled"}</h3>
              <p className="text-xs text-zinc-500 mt-auto">
                Last edited {doc.updated_at ? new Date(doc.updated_at).toLocaleDateString() : "Unknown"}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
