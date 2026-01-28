import { getMongoDb } from "@/lib/mongodb";

export type RagEmbeddingsConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  dimensions: number;
};

export type RagPersonaDocRow = {
  id: string;
  persona_id: string | null;
  title: string | null;
  content: string | null;
  type: string | null;
  updated_at: string | null;
  is_folder?: boolean | null;
};

export type RagIndexStats = {
  docsFetched: number;
  docsIndexed: number;
  chunksIndexed: number;
  indexedAt: string | null;
  indexedDocId: string | null;
};

type PostgrestErrorLike = { message: string } | null;
type PostgrestResponseLike<T> = { data: T | null; error: PostgrestErrorLike };

type PostgrestFilterBuilderLike<T> = PromiseLike<PostgrestResponseLike<T>> & {
  in: (column: string, values: unknown[]) => PostgrestFilterBuilderLike<T>;
  order: (column: string, opts?: { ascending?: boolean }) => PostgrestFilterBuilderLike<T>;
  range: (from: number, to: number) => PostgrestFilterBuilderLike<T>;
  gte: (column: string, value: string) => PostgrestFilterBuilderLike<T>;
  is: (column: string, value: null) => PostgrestFilterBuilderLike<T>;
  like: (column: string, pattern: string) => PostgrestFilterBuilderLike<T>;
  eq: (column: string, value: unknown) => PostgrestFilterBuilderLike<T>;
  lt: (column: string, value: string) => PostgrestFilterBuilderLike<T>;
  maybeSingle: () => PostgrestFilterBuilderLike<T>;
};

type PostgrestQueryBuilderLike<T> = {
  select: (columns?: string) => PostgrestFilterBuilderLike<T>;
  insert: (values: unknown) => PostgrestFilterBuilderLike<unknown>;
  delete: () => PostgrestFilterBuilderLike<unknown>;
  upsert: (values: unknown) => PostgrestFilterBuilderLike<unknown>;
};

type SupabaseLike = {
  from: (table: string) => unknown;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<PostgrestResponseLike<unknown>>;
};

function fromLike<T>(supabase: SupabaseLike, table: string) {
  return supabase.from(table) as unknown as PostgrestQueryBuilderLike<T>;
}

export function pickRagEmbeddingsConfig(): RagEmbeddingsConfig | null {
  const baseFromEnv = (process.env.RAG_EMBEDDINGS_BASE_URL ?? "").toString().trim();
  const modelRaw = (process.env.RAG_EMBEDDINGS_MODEL ?? "text-embedding-3-small").toString().trim();
  const dimsRaw = Number((process.env.RAG_EMBEDDINGS_DIMENSIONS ?? "1536").toString().trim());
  const dimensions = Number.isFinite(dimsRaw) && dimsRaw > 0 ? Math.floor(dimsRaw) : 1536;

  const apiKeyFromEnv = (process.env.RAG_EMBEDDINGS_API_KEY ?? "").toString().trim();
  if (apiKeyFromEnv) {
    const baseURL = baseFromEnv || "https://api.openai.com/v1";
    const model = modelRaw || "text-embedding-3-small";
    return { apiKey: apiKeyFromEnv, baseURL, model, dimensions };
  }

  const base = (process.env.NEXT_PUBLIC_OPENROUTER_BASE_URL ?? "").toString().trim();
  const baseURL = baseFromEnv || base || "https://openrouter.ai/api/v1";

  const fallbacks = [
    (process.env.NEXT_PUBLIC_OPENROUTER_API_KEY ?? "").toString().trim(),
    (process.env.NEXT_PUBLIC_GPT52_API_KEY ?? "").toString().trim(),
    (process.env.NEXT_PUBLIC_CLAUDE_API_KEY ?? "").toString().trim(),
    (process.env.NEXT_PUBLIC_MINIMAX_API_KEY ?? "").toString().trim(),
    (process.env.NEXT_PUBLIC_KIMI_API_KEY ?? "").toString().trim(),
  ].filter((v) => v.length > 0);

  const apiKey = fallbacks[0] ?? "";
  if (!apiKey) return null;

  let model = modelRaw || "text-embedding-3-small";
  if (baseURL.includes("openrouter.ai") && !model.includes("/")) {
    model = `openai/${model}`;
  }
  return { apiKey, baseURL, model, dimensions };
}

export function toPgVector(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

function normalizeTextForChunks(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function splitTextIntoChunks(input: string, opts?: { chunkSize?: number; overlap?: number }): string[] {
  const chunkSize = Math.max(200, Math.floor(opts?.chunkSize ?? Number(process.env.RAG_CHUNK_SIZE ?? 900)));
  const overlap = Math.max(0, Math.floor(opts?.overlap ?? Number(process.env.RAG_CHUNK_OVERLAP ?? 120)));
  const text = normalizeTextForChunks(input);
  if (!text) return [];
  if (text.length <= chunkSize) return [text];

  const paragraphs = text.split(/\n{2,}/g).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= chunkSize) {
      pieces.push(p);
      continue;
    }
    const sentences = p.split(/(?<=[。！？.!?])\s+/g).map((s) => s.trim()).filter(Boolean);
    if (sentences.length <= 1) {
      pieces.push(p);
      continue;
    }
    pieces.push(...sentences);
  }

  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (!current) {
      current = piece;
      continue;
    }
    const next = `${current}\n\n${piece}`;
    if (next.length <= chunkSize) {
      current = next;
      continue;
    }
    chunks.push(current);
    current = piece;
  }
  if (current) chunks.push(current);

  if (overlap <= 0 || chunks.length <= 1) return chunks;
  const overlapped: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    if (i === 0) {
      overlapped.push(chunk);
      continue;
    }
    const prev = overlapped[i - 1]!;
    const tail = prev.slice(Math.max(0, prev.length - overlap));
    overlapped.push(`${tail}\n${chunk}`);
  }
  return overlapped;
}

async function embedTexts(texts: string[], cfg: RagEmbeddingsConfig): Promise<number[][]> {
  if (texts.length === 0) return [];
  const url = `${cfg.baseURL.replace(/\/+$/g, "")}/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://aipersona.web",
      "X-Title": "AIPersona",
    },
    body: JSON.stringify({
      model: cfg.model,
      input: texts,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Embeddings request failed (${res.status}): ${text || res.statusText}`);
  }
  const json = (await res.json()) as { data?: Array<{ embedding?: unknown }> };
  const data = Array.isArray(json?.data) ? json.data : [];
  const out: number[][] = [];
  for (const item of data) {
    const emb = item?.embedding;
    if (!Array.isArray(emb)) throw new Error("Invalid embeddings response");
    const vec = emb.map((v) => (typeof v === "number" ? v : Number(v))).filter((n) => Number.isFinite(n));
    if (vec.length !== cfg.dimensions) {
      throw new Error(`Embedding dimensions mismatch (got ${vec.length}, expected ${cfg.dimensions})`);
    }
    out.push(vec);
  }
  if (out.length !== texts.length) {
    throw new Error("Embeddings response length mismatch");
  }
  return out;
}

export async function getUserPersonaIds(userId: string): Promise<string[]> {
  const db = await getMongoDb();
  const docs = await db
    .collection<{ _id: string; userId: string }>("personas")
    .find({ userId })
    .project<{ _id: string }>({ _id: 1 })
    .toArray();
  return docs.map((p) => p._id).filter((id) => typeof id === "string" && id.length > 0);
}

export async function fetchPersonaDocsForIndex(args: {
  supabase: SupabaseLike;
  personaIds: string[];
  userId: string;
  updatedAfterIso: string | null;
}): Promise<RagPersonaDocRow[]> {
  const { supabase, personaIds, userId, updatedAfterIso } = args;
  const pageSize = 200;
  const all: RagPersonaDocRow[] = [];

  const fetchPaged = async (builderFactory: (from: number, to: number) => PromiseLike<PostgrestResponseLike<RagPersonaDocRow[]>>) => {
    for (let offset = 0; offset < 100_000; offset += pageSize) {
      const { data, error } = await builderFactory(offset, offset + pageSize - 1);
      if (error) throw new Error(error.message);
      const rows = ((data ?? []) as RagPersonaDocRow[]).filter(Boolean);
      all.push(...rows);
      if (rows.length < pageSize) break;
    }
  };

  if (personaIds.length > 0) {
    await fetchPaged((from, to) => {
      let q = fromLike<RagPersonaDocRow[]>(supabase, "persona_docs")
        .select("id,persona_id,title,content,type,updated_at")
        .in("persona_id", personaIds)
        .order("updated_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (updatedAfterIso) q = q.gte("updated_at", updatedAfterIso);
      return q;
    });
  }

  const privatePrefix = `private-${userId}-`;
  await fetchPaged((from, to) => {
    let q = fromLike<RagPersonaDocRow[]>(supabase, "persona_docs")
      .select("id,persona_id,title,content,type,updated_at")
      .is("persona_id", null)
      .like("id", `${privatePrefix}%`)
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (updatedAfterIso) q = q.gte("updated_at", updatedAfterIso);
    return q;
  });

  const seen = new Set<string>();
  const deduped: RagPersonaDocRow[] = [];
  for (const d of all) {
    if (!d?.id || seen.has(d.id)) continue;
    seen.add(d.id);
    deduped.push(d);
  }
  return deduped;
}

export async function indexPersonaDocs(args: {
  supabase: SupabaseLike;
  userId: string;
  docs: RagPersonaDocRow[];
  embeddings: RagEmbeddingsConfig;
}): Promise<RagIndexStats> {
  const { supabase, userId, docs, embeddings } = args;

  const candidates = docs
    .filter((d) => {
      const content = (d.content ?? "").toString().trim();
      if (!content) return false;
      const isFolder = Boolean(d.is_folder) || (d.type ?? "").toString().includes("folder=1");
      if (isFolder) return false;
      return true;
    })
    .map((d) => ({
      id: d.id,
      persona_id: d.persona_id ?? null,
      updated_at: d.updated_at ?? null,
      title: (d.title ?? "").toString(),
      content: (d.content ?? "").toString(),
    }));

  let docsIndexed = 0;
  let chunksIndexed = 0;
  let indexedAt: string | null = null;
  let indexedDocId: string | null = null;

  if (candidates.length === 0) {
    return { docsFetched: docs.length, docsIndexed, chunksIndexed, indexedAt, indexedDocId };
  }

  for (const doc of candidates) {
    const base = doc.title ? `${doc.title}\n\n${doc.content}` : doc.content;
    const chunks = splitTextIntoChunks(base);
    if (chunks.length === 0) continue;

    const { error: delError } = await fromLike<unknown>(supabase, "persona_doc_chunks").delete().eq("user_id", userId).eq("doc_id", doc.id);
    if (delError) throw new Error(delError.message);

    const rows: Array<{
      user_id: string;
      doc_id: string;
      persona_id: string | null;
      chunk_index: number;
      content: string;
      embedding: string;
      doc_updated_at: string | null;
    }> = [];

    const batchSize = 96;
    for (let start = 0; start < chunks.length; start += batchSize) {
      const slice = chunks.slice(start, start + batchSize);
      const vecs = await embedTexts(slice, embeddings);
      for (let i = 0; i < slice.length; i++) {
        const chunkText = slice[i]!;
        const vec = vecs[i]!;
        rows.push({
          user_id: userId,
          doc_id: doc.id,
          persona_id: doc.persona_id,
          chunk_index: start + i,
          content: chunkText,
          embedding: toPgVector(vec),
          doc_updated_at: doc.updated_at,
        });
      }
    }

    const insertBatchSize = 200;
    for (let start = 0; start < rows.length; start += insertBatchSize) {
      const batch = rows.slice(start, start + insertBatchSize);
      const { error } = await fromLike<unknown>(supabase, "persona_doc_chunks").insert(batch);
      if (error) throw new Error(error.message);
    }

    docsIndexed += 1;
    chunksIndexed += rows.length;
    indexedAt = doc.updated_at ?? indexedAt;
    indexedDocId = doc.id;
  }

  return { docsFetched: docs.length, docsIndexed, chunksIndexed, indexedAt, indexedDocId };
}

export async function ensureUserIndexUpToDate(args: {
  supabase: SupabaseLike;
  userId: string;
  personaIds: string[];
  embeddings: RagEmbeddingsConfig;
}): Promise<RagIndexStats> {
  const { supabase, userId, personaIds, embeddings } = args;

  const stateRes = (await fromLike<unknown>(supabase, "rag_user_index_state")
    .select("last_indexed_at,last_indexed_doc_id")
    .eq("user_id", userId)
    .maybeSingle()) as PostgrestResponseLike<{ last_indexed_at?: unknown; last_indexed_doc_id?: unknown }>;

  const lastAtRaw =
    stateRes.error || !stateRes.data?.last_indexed_at ? null : new Date(stateRes.data.last_indexed_at as string).toISOString();
  const lastDocIdRaw = stateRes.error ? "" : String((stateRes.data?.last_indexed_doc_id ?? "") as string);

  const docs = await fetchPersonaDocsForIndex({ supabase, personaIds, userId, updatedAfterIso: lastAtRaw });
  const filtered =
    lastAtRaw && lastDocIdRaw
      ? docs.filter((d) => {
          const t = d.updated_at ? new Date(d.updated_at).toISOString() : "";
          if (!t) return false;
          if (t > lastAtRaw) return true;
          if (t < lastAtRaw) return false;
          return d.id > lastDocIdRaw;
        })
      : docs;

  if (filtered.length === 0) {
    return { docsFetched: docs.length, docsIndexed: 0, chunksIndexed: 0, indexedAt: null, indexedDocId: null };
  }

  const stats = await indexPersonaDocs({ supabase, userId, docs: filtered, embeddings });

  const nextAt = stats.indexedAt;
  const nextDocId = stats.indexedDocId;
  if (nextAt && nextDocId) {
    await fromLike<unknown>(supabase, "rag_user_index_state").upsert({
      user_id: userId,
      last_indexed_at: nextAt,
      last_indexed_doc_id: nextDocId,
      updated_at: new Date().toISOString(),
    });
  }

  return stats;
}

export async function retrieveRelevantDocs(args: {
  supabase: SupabaseLike;
  personaIds: string[];
  query: string;
  embeddings: RagEmbeddingsConfig;
  maxDocs?: number;
}): Promise<RagPersonaDocRow[]> {
  const { supabase, personaIds, query, embeddings } = args;
  const maxDocs = Math.min(Math.max(args.maxDocs ?? 6, 1), 12);

  const [queryVec] = await embedTexts([query], embeddings);
  if (!queryVec) return [];

  const rpcRes = await supabase.rpc("match_persona_doc_chunks", {
    query_embedding: toPgVector(queryVec),
    match_count: 24,
    persona_ids: personaIds,
  });

  if (rpcRes.error) throw new Error(rpcRes.error.message);
  const matches = (rpcRes.data ?? []) as Array<{ doc_id?: unknown; similarity?: unknown }>;
  const scored = matches
    .map((m) => ({
      docId: typeof m.doc_id === "string" ? m.doc_id : "",
      score: typeof m.similarity === "number" ? m.similarity : Number(m.similarity),
    }))
    .filter((m) => m.docId.length > 0 && Number.isFinite(m.score))
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const docIds: string[] = [];
  for (const m of scored) {
    if (seen.has(m.docId)) continue;
    seen.add(m.docId);
    docIds.push(m.docId);
    if (docIds.length >= maxDocs) break;
  }
  if (docIds.length === 0) return [];

  const { data, error } = await fromLike<RagPersonaDocRow[]>(supabase, "persona_docs")
    .select("id,persona_id,title,content,type,updated_at")
    .in("id", docIds);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as RagPersonaDocRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return docIds.map((id) => byId.get(id)).filter((d): d is RagPersonaDocRow => Boolean(d));
}
