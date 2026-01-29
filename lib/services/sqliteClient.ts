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
  version?: number | null;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

export type SqliteRows = Array<Record<string, unknown>>;

export type SqliteClient = {
  init: () => Promise<void>;
  getDoc: (id: string) => Promise<DocRow | null>;
  upsertDoc: (row: DocRow) => Promise<void>;
  getPrompt: (id: string) => Promise<PromptRow | null>;
  upsertPrompt: (row: PromptRow) => Promise<void>;
  run: (sql: string, params?: unknown[]) => Promise<SqliteRows>;
};

let clientPromise: Promise<SqliteClient> | null = null;

function makeReqId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function getSqliteClient(): Promise<SqliteClient> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    if (typeof window === "undefined") {
      throw new Error("sqlite_unavailable");
    }
    if (typeof Worker === "undefined") {
      throw new Error("sqlite_unavailable");
    }

    const worker = new Worker(new URL("../workers/sqlite.worker.ts", import.meta.url), { type: "module" });
    const pending = new Map<string, Pending>();
    let readyResolve: (() => void) | null = null;
    let readyReject: ((e: unknown) => void) | null = null;
    let readyPromise: Promise<void> | null = null;

    const ensureReady = () => {
      if (readyPromise) return readyPromise;
      readyPromise = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      worker.postMessage({ type: "init" });
      return readyPromise;
    };

    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { type: string; reqId?: string; data?: unknown; error?: string };
      if (msg.type === "sqlite-ready") {
        readyResolve?.();
        readyResolve = null;
        readyReject = null;
        return;
      }
      if (msg.type === "sqlite-error" && !msg.reqId) {
        readyReject?.(new Error(msg.error || "sqlite_error"));
        readyResolve = null;
        readyReject = null;
        return;
      }
      if (!msg.reqId) return;
      const entry = pending.get(msg.reqId);
      if (!entry) return;
      pending.delete(msg.reqId);
      if (msg.type === "sqlite-error") {
        entry.reject(new Error(msg.error || "sqlite_error"));
        return;
      }
      entry.resolve(msg.data);
    };

    const call = async (type: string, payload?: unknown) => {
      await ensureReady();
      const reqId = makeReqId();
      const p = new Promise<unknown>((resolve, reject) => {
        pending.set(reqId, { resolve, reject });
      });
      worker.postMessage({ type, reqId, payload });
      return p;
    };

    return {
      init: async () => {
        await ensureReady();
      },
      getDoc: async (id: string) => {
        return (await call("get-doc", { id })) as DocRow | null;
      },
      upsertDoc: async (row: DocRow) => {
        await call("upsert-doc", row);
      },
      getPrompt: async (id: string) => {
        return (await call("get-prompt", { id })) as PromptRow | null;
      },
      upsertPrompt: async (row: PromptRow) => {
        await call("upsert-prompt", row);
      },
      run: async (sql: string, params: unknown[] = []) => {
        return (await call("run", { sql, params })) as SqliteRows;
      },
    };
  })();
  return clientPromise;
}
