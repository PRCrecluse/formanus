import { initSQLite, isOpfsSupported, run } from "@subframe7536/sqlite-wasm";
import { useOpfsStorage as opfsStorage } from "@subframe7536/sqlite-wasm/opfs";
import { useIdbStorage as idbStorage } from "@subframe7536/sqlite-wasm/idb";

type DocRow = {
  id: string;
  persona_id: string | null;
  title: string | null;
  content: string | null;
  type: string | null;
  updated_at: string | null;
};

type PromptRow = {
  id: string;
  content: string | null;
  updated_at: string | null;
  version: number | null;
};

let ready = false;
let core: Awaited<ReturnType<typeof initSQLite>> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNullableString(value: unknown): string | null {
  if (typeof value === "string") return value;
  return null;
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function ensureInit() {
  if (ready) return;
  try {
    const useOpfs = await isOpfsSupported();
    core = await initSQLite(
      useOpfs
        ? opfsStorage("aipersona.db", {
            url: "https://cdn.jsdelivr.net/npm/@subframe7536/sqlite-wasm@0.5.8/dist/wa-sqlite.wasm",
          })
        : idbStorage("aipersona_idb.db", {
            url: "https://cdn.jsdelivr.net/npm/@subframe7536/sqlite-wasm@0.5.8/dist/wa-sqlite-async.wasm",
          })
    );
    await run(core, `CREATE TABLE IF NOT EXISTS persona_docs (
      id TEXT PRIMARY KEY,
      persona_id TEXT,
      title TEXT,
      content TEXT,
      type TEXT,
      updated_at TEXT
    )`);
    await run(core, `CREATE TABLE IF NOT EXISTS prompt_templates (
      id TEXT PRIMARY KEY,
      content TEXT,
      updated_at TEXT
    )`);
    try {
      await run(core, `ALTER TABLE prompt_templates ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);
    } catch {
      void 0;
    }
    ready = true;
  } catch (e) {
    const message = e instanceof Error ? e.message : "init_failed";
    postMessage({ type: "sqlite-error", error: message });
    throw e;
  }
}

onmessage = async (ev: MessageEvent) => {
  const raw: unknown = ev.data;
  if (!isRecord(raw) || typeof raw.type !== "string") {
    postMessage({ type: "sqlite-error", error: "invalid_message" });
    return;
  }

  const type = raw.type;

  if (type === "init") {
    await ensureInit();
    postMessage({ type: "sqlite-ready" });
    return;
  }

  const reqId = typeof raw.reqId === "string" ? raw.reqId : null;
  if (!reqId) {
    postMessage({ type: "sqlite-error", error: "missing_req_id" });
    return;
  }

  await ensureInit();
  if (!core) {
    postMessage({ type: "sqlite-error", error: "not_initialized", reqId });
    return;
  }

  if (type === "upsert-doc") {
    const payload = raw.payload;
    if (!isRecord(payload) || typeof payload.id !== "string") {
      postMessage({ type: "sqlite-error", reqId, error: "invalid_payload" });
      return;
    }
    const p: DocRow = {
      id: payload.id,
      persona_id: asNullableString(payload.persona_id),
      title: asNullableString(payload.title),
      content: asNullableString(payload.content),
      type: asNullableString(payload.type),
      updated_at: asNullableString(payload.updated_at),
    };
    await run(
      core,
      `INSERT INTO persona_docs(id, persona_id, title, content, type, updated_at)
       VALUES(?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         persona_id=COALESCE(excluded.persona_id, persona_docs.persona_id),
         title=COALESCE(excluded.title, persona_docs.title),
         content=COALESCE(excluded.content, persona_docs.content),
         type=COALESCE(excluded.type, persona_docs.type),
         updated_at=COALESCE(excluded.updated_at, persona_docs.updated_at)`,
      [p.id, p.persona_id ?? null, p.title ?? null, p.content ?? null, p.type ?? null, p.updated_at ?? null]
    );
    postMessage({ type: "ok", reqId });
    return;
  }

  if (type === "get-doc") {
    const payload = raw.payload;
    if (!isRecord(payload) || typeof payload.id !== "string") {
      postMessage({ type: "sqlite-error", reqId, error: "invalid_payload" });
      return;
    }
    const id = payload.id;
    const rows = await run(core, `SELECT id, persona_id, title, content, type, updated_at FROM persona_docs WHERE id=? LIMIT 1`, [id]);
    const row = rows[0] as DocRow | undefined;
    postMessage({ type: "doc", reqId, data: row ?? null });
    return;
  }

  if (type === "upsert-prompt") {
    const payload = raw.payload;
    if (!isRecord(payload) || typeof payload.id !== "string") {
      postMessage({ type: "sqlite-error", reqId, error: "invalid_payload" });
      return;
    }
    const p: PromptRow = {
      id: payload.id,
      content: asNullableString(payload.content),
      updated_at: asNullableString(payload.updated_at),
      version: asNullableNumber(payload.version),
    };
    let nextVersion = 1;
    try {
      const existingRows = await run(core, `SELECT content, version FROM prompt_templates WHERE id=? LIMIT 1`, [p.id]);
      const existing = existingRows[0] as { content?: unknown; version?: unknown } | undefined;
      if (existing) {
        const prevContent = asNullableString(existing.content);
        const prevVersion = asNullableNumber(existing.version) ?? 1;
        nextVersion = prevContent === p.content ? prevVersion : prevVersion + 1;
      }
    } catch {
      nextVersion = 1;
    }
    const updatedAt = p.updated_at ?? new Date().toISOString();
    await run(
      core,
      `INSERT INTO prompt_templates(id, content, updated_at, version)
       VALUES(?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         content=excluded.content,
         updated_at=excluded.updated_at,
         version=excluded.version`,
      [p.id, p.content ?? null, updatedAt, nextVersion]
    );
    postMessage({ type: "ok", reqId });
    return;
  }

  if (type === "get-prompt") {
    const payload = raw.payload;
    if (!isRecord(payload) || typeof payload.id !== "string") {
      postMessage({ type: "sqlite-error", reqId, error: "invalid_payload" });
      return;
    }
    const id = payload.id;
    const rows = await run(core, `SELECT id, content, updated_at, version FROM prompt_templates WHERE id=? LIMIT 1`, [id]);
    const row = rows[0] as PromptRow | undefined;
    postMessage({ type: "prompt", reqId, data: row ?? null });
    return;
  }

  if (type === "run") {
    const payload = raw.payload;
    if (!isRecord(payload) || typeof payload.sql !== "string") {
      postMessage({ type: "sqlite-error", reqId, error: "invalid_payload" });
      return;
    }
    const sql = payload.sql;
    const params = Array.isArray(payload.params) ? payload.params : [];
    const rows = await run(core, sql, params);
    postMessage({ type: "rows", reqId, data: rows });
    return;
  }

  postMessage({ type: "sqlite-error", reqId, error: "unknown_message_type" });
};
