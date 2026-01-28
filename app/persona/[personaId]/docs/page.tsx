"use client";

import { useEffect, useMemo, useState, use } from "react";
import { supabase } from "@/lib/supabaseClient";
import DocsContainer from "./DocsContainer";
import { useRouter, useSearchParams } from "next/navigation";
import { Folder, FolderOpen, Plus } from "lucide-react";
import { getSqliteClient } from "@/lib/sqliteClient";
import { makePersonaDocDbId, normalizePersonaDocType } from "@/lib/utils";

const MAX_CACHED_DOCS = 200;

export default function DocsPage({ params }: { params: Promise<{ personaId: string }> }) {
  const { personaId: rawPersonaId } = use(params);
  const personaId = decodeURIComponent(rawPersonaId);
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeFolder = searchParams.get("folder");
  const [docs, setDocs] = useState<
    { id: string; title: string; type?: string | null; updated_at: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [hoveredPreviewId, setHoveredPreviewId] = useState<string | null>(null);
  const [previewSnippets, setPreviewSnippets] = useState<Record<string, string>>({});

  const toPlainTextSnippet = (raw: string) => {
    const noScripts = raw.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ");
    const noStyles = noScripts.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ");
    const noTags = noStyles.replace(/<[^>]+>/g, " ");
    return noTags.replace(/\s+/g, " ").trim();
  };

  useEffect(() => {
    let active = true;

    const readFromSqlite = async () => {
      try {
        const sqlite = await getSqliteClient();
        const rows = await sqlite.run(
          `SELECT id, title, type, updated_at
           FROM persona_docs
           WHERE (persona_id = ? OR id LIKE ?)
           ORDER BY updated_at DESC`,
          [personaId, `${personaId}-%`]
        );

        if (!active) return;

        const cached = rows
          .map((r) => {
            const id = typeof r.id === "string" ? r.id : "";
            const title = typeof r.title === "string" ? r.title : "";
            const type = typeof r.type === "string" ? r.type : null;
            const updated_at = typeof r.updated_at === "string" ? r.updated_at : "";
            return { id, title, type, updated_at };
          })
          .filter((d) => Boolean(d.id));

        if (cached.length > 0) {
          setDocs(cached.slice(0, MAX_CACHED_DOCS));
          setLoading(false);
        }
      } catch {
        void 0;
      }
    };

    const fetchDocs = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token ?? "";

        const r = await fetch(`/api/persona-docs?personaId=${encodeURIComponent(personaId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!r.ok) {
          const text = await r.text().catch(() => "");
          console.error("Error fetching docs:", text || r.statusText);
          return;
        }

        const data = (await r.json()) as Array<{
          id: string;
          title: string | null;
          type: string | null;
          updated_at: string | null;
        }>;

        const nextDocs = (data ?? []).map((d) => ({
          id: d.id,
          title: d.title ?? "",
          type: d.type,
          updated_at: d.updated_at ?? "",
        })) as typeof docs;

        if (active) setDocs(nextDocs);

        try {
          const sqlite = await getSqliteClient();
          await Promise.all(
            nextDocs.slice(0, MAX_CACHED_DOCS).map((d) =>
              sqlite.upsertDoc({
                id: d.id,
                persona_id: personaId,
                title: d.title ?? null,
                content: null,
                type: (d.type ?? null) as string | null,
                updated_at: d.updated_at ? d.updated_at : null,
              })
            )
          );
          const ids = nextDocs.map((d) => d.id).filter((id) => Boolean(id));
          if (ids.length === 0) {
            await sqlite.run(
              `DELETE FROM persona_docs WHERE (persona_id = ? OR id LIKE ?)`,
              [personaId, `${personaId}-%`]
            );
          } else {
            const placeholders = ids.map(() => "?").join(",");
            await sqlite.run(
              `DELETE FROM persona_docs WHERE (persona_id = ? OR id LIKE ?) AND id NOT IN (${placeholders})`,
              [personaId, `${personaId}-%`, ...ids]
            );
          }
        } catch {
          void 0;
        }
      } catch (err) {
        console.error("Unexpected error:", err);
      } finally {
        if (active) setLoading(false);
      }
    };

    void readFromSqlite();
    void fetchDocs();
    return () => {
      active = false;
    };
  }, [personaId]);

  const recentDocs = useMemo(() => {
    return docs
      .filter((d) => normalizePersonaDocType(d.type) === "persona")
      .filter((d) => Boolean(d.title || d.updated_at))
      .slice(0, 3);
  }, [docs]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (recentDocs.length === 0) return;
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!token) return;

      const idsToFetch = recentDocs.map((d) => d.id).filter((id) => !(id in previewSnippets));
      if (idsToFetch.length === 0) return;

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
  }, [previewSnippets, recentDocs]);

  const folderName = useMemo(() => {
    if (!activeFolder) return null;
    if (activeFolder === "persona-docs") return "Persona's docs";
    const candidates = [`${personaId}-${activeFolder}`, activeFolder];
    const found = docs.find((d) => candidates.includes(d.id));
    return found?.title || activeFolder;
  }, [activeFolder, docs, personaId]);

  if (!activeFolder) {
    const createFolder = async () => {
      const name = window.prompt("Folder name")?.trim();
      if (!name) return;
      const folderDocId = `folder-${Date.now()}`;
      const dbId = makePersonaDocDbId(personaId, folderDocId);
      const nowIso = new Date().toISOString();
      const type = `persona;folder=1;parent=`;
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
      router.push(`/persona/${encodeURIComponent(personaId)}/docs?folder=${encodeURIComponent(folderDocId)}`);
    };

    const createDoc = async () => {
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
      if (error) {
        window.alert(error.message);
        return;
      }
      router.push(`/persona/${encodeURIComponent(personaId)}/docs/${encodeURIComponent(docId)}`);
    };

    return (
      <div className="flex h-[calc(100vh-64px)] flex-col">
        <div className="flex items-center justify-between bg-white px-6 py-3 dark:bg-zinc-900">
          <div className="text-lg font-semibold">Docs</div>
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

        <div className="flex-1 overflow-y-auto p-6">
          <button
            type="button"
            onClick={() => {
              router.push(`/persona/${encodeURIComponent(personaId)}/docs?folder=persona-docs`);
            }}
            className="w-full rounded-3xl border border-[#ECECEC] bg-[#F7F7F7] p-6 text-left shadow-[0_10px_20px_rgba(0,0,0,0.10)] transition-shadow hover:shadow-[0_10px_20px_rgba(0,0,0,0.12)] dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <FolderOpen className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  Persona&apos;s docs
                </div>
              </div>
            </div>

            <div className="mt-4 hidden md:flex items-end">
              {recentDocs.length === 0 ? (
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
              ) : (
                <div className="flex items-end">
                  {recentDocs.map((d, idx) => {
                    const isHovered = hoveredPreviewId === d.id;
                    const snippet = (previewSnippets[d.id] ?? "").trim();
                    return (
                      <div
                        key={d.id}
                        onMouseEnter={() => setHoveredPreviewId(d.id)}
                        onMouseLeave={() => setHoveredPreviewId(null)}
                        className={`h-[140px] w-[110px] shrink-0 rounded-[18px] border border-zinc-200 bg-white p-3 shadow-[0_10px_20px_rgba(0,0,0,0.10)] transition-transform duration-150 dark:border-zinc-800 dark:bg-zinc-950 ${
                          idx === 0 ? "" : "-ml-[18px]"
                        } ${isHovered ? "-translate-y-2" : ""}`}
                        style={{ zIndex: isHovered ? 50 : 30 - idx }}
                      >
                        <div className="flex h-full flex-col">
                          <div className="line-clamp-2 text-[12px] font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                            {d.title || "Untitled"}
                          </div>
                          <div className="mt-2 line-clamp-3 flex-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                            {snippet ? snippet : "—"}
                          </div>
                          <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                            {d.updated_at ? new Date(d.updated_at).toLocaleDateString() : "—"}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </button>
        </div>
      </div>
    );
  }

  if (loading && docs.length === 0) {
    return (
      <div className="p-8 space-y-4">
        <div className="h-8 w-48 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-zinc-100 dark:bg-zinc-800 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return <DocsContainer personaId={personaId} initialDocs={docs} folderName={folderName} folderId={activeFolder} />;
}
