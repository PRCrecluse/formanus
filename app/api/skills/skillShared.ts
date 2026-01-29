import { ChatOpenAI } from "@langchain/openai";
import { createClient } from "@supabase/supabase-js";
import { ensureDocHtmlContent } from "@/lib/utils";

const MODEL_CONFIGS = [
  { id: "persona-ai", modelId: "google/gemini-3-pro-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
  { id: "gpt-5.2", modelId: "openai/gpt-5.2", keyName: "NEXT_PUBLIC_GPT52_API_KEY" },
  { id: "nanobanana", modelId: "google/gemini-3-pro-image-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
  { id: "gemini-3.0-pro", modelId: "google/gemini-3-pro-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
  { id: "minimax-m2", modelId: "minimax/minimax-m2", keyName: "NEXT_PUBLIC_MINIMAX_API_KEY" },
  { id: "kimi-0905", modelId: "moonshotai/kimi-k2-0905", keyName: "NEXT_PUBLIC_KIMI_API_KEY" },
  { id: "claude-3.5-sonnet", modelId: "anthropic/claude-3.5-sonnet", keyName: "NEXT_PUBLIC_CLAUDE_API_KEY" },
] as const;

function pickModelConfig(modelId: string | null | undefined) {
  if (!modelId) return MODEL_CONFIGS[0];
  const found = MODEL_CONFIGS.find((m) => m.id === modelId);
  return found ?? MODEL_CONFIGS[0];
}

export function createChatModel(modelKey: string | null | undefined) {
  const cfg = pickModelConfig(modelKey);
  const apiKey = (process.env[cfg.keyName] ?? "").toString();
  if (!apiKey) {
    throw new Error(`Missing API key for model ${cfg.id}`);
  }
  const base = (process.env.NEXT_PUBLIC_OPENROUTER_BASE_URL ?? "").toString().trim();
  const baseURL = base || "https://openrouter.ai/api/v1";
  return new ChatOpenAI({
    model: cfg.modelId,
    temperature: 0.2,
    configuration: {
      apiKey,
      baseURL,
    },
  });
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return Math.min(Math.max(i, min), max);
}

export function decodeBase64ToBuffer(value: string): Buffer {
  const clean = value.trim();
  if (!clean) return Buffer.from("");
  const idx = clean.indexOf("base64,");
  const b64 = idx >= 0 ? clean.slice(idx + "base64,".length) : clean;
  return Buffer.from(b64, "base64");
}

export async function createBoardDoc({
  title,
  content,
  userId,
  accessToken,
  personaId,
}: {
  title: string;
  content: string;
  userId: string;
  accessToken: string;
  personaId: string | null;
}): Promise<{ ok: true; docId: string } | { ok: false; error: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return { ok: false, error: "Supabase not configured" };

  const normalizedContent = ensureDocHtmlContent(content);

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data, error } = await supabase
    .from("persona_docs")
    .insert({
      user_id: userId,
      persona_id: personaId,
      title,
      content: normalizedContent,
      type: "text",
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, docId: data.id };
}

export async function fetchNotionPageText(token: string, pageId: string): Promise<string> {
  const url = `https://api.notion.com/v1/blocks/${encodeURIComponent(pageId)}/children?page_size=100`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return "";
    const data = (await res.json()) as unknown;
    const resultsRaw =
      typeof data === "object" && data !== null && "results" in data ? (data as { results?: unknown }).results : null;
    const blocks = Array.isArray(resultsRaw) ? resultsRaw : [];
    const out: string[] = [];
    for (const b of blocks) {
      const block = typeof b === "object" && b !== null ? (b as Record<string, unknown>) : null;
      const type = typeof block?.type === "string" ? block.type : "";
      const typeBlock = type ? (block?.[type] as Record<string, unknown> | null | undefined) : null;
      const content = typeBlock?.rich_text;
      if (Array.isArray(content)) {
        const line = content
          .map((c) => {
            const v = typeof c === "object" && c !== null ? (c as Record<string, unknown>) : null;
            const t = v?.plain_text;
            return typeof t === "string" ? t : "";
          })
          .join("");
        if (line) out.push(line);
      }
    }
    return out.join("\n").slice(0, 40_000);
  } catch {
    return "";
  }
}
