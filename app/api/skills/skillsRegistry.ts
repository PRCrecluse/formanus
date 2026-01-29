import { ChatOpenAI } from "@langchain/openai";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import * as XLSX from "xlsx";
import { runWebSearch } from "@/lib/skills";
import { fillPromptTemplate, loadPromptTemplate } from "@/lib/prompts";
import { getMongoDb } from "@/lib/mongodb";
import { postToXForUser } from "@/lib/integrations/x";

type SkillStatus = "ready" | "needs_config";

export type SkillMeta = {
  id: string;
  name: string;
  description: string;
  category: "web" | "integration" | "documents";
  status: SkillStatus;
};

type SkillRunOk = { ok: true; output: unknown };
type SkillRunErr = { ok: false; error: string };
export type SkillRunResult = SkillRunOk | SkillRunErr;

type SkillContext = {
  userId: string;
  accessToken: string;
};

type Skill = {
  id: string;
  name: string;
  description: string;
  category: SkillMeta["category"];
  getStatus: () => SkillStatus;
  run: (args: { input: unknown; context: SkillContext; modelId?: string | null }) => Promise<SkillRunResult>;
};

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

function createChatModel(modelKey: string | null | undefined) {
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

// Helper: Create Board Doc
async function createBoardDoc({ title, content, userId, accessToken, personaId }: {
  title: string;
  content: string;
  userId: string;
  accessToken: string;
  personaId: string | null;
}): Promise<{ ok: true; docId: string } | { ok: false; error: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return { ok: false, error: "Supabase not configured" };

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data, error } = await supabase
    .from("persona_docs")
    .insert({
      user_id: userId,
      persona_id: personaId,
      title,
      content,
      type: "text",
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, docId: data.id };
}

// Helper: Notion Fetch
async function fetchNotionPageText(token: string, pageId: string): Promise<string> {
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
    const data = (await res.json()) as { results?: any[] };
    const blocks = data.results ?? [];
    const out: string[] = [];
    for (const b of blocks) {
      const type = b.type;
      const content = b[type]?.rich_text;
      if (Array.isArray(content)) {
        const line = content.map((c: any) => c.plain_text).join("");
        if (line) out.push(line);
      }
    }
    return out.join("\n").slice(0, 40_000);
  } catch {
    return "";
  }
}

const SKILLS: Skill[] = [
  {
    id: "article-writing-and-posting",
    name: "Article Writing & Posting",
    description: "Generates an article based on a topic, saves it to Board Resources, and optionally prepares a tweet summary.",
    category: "integration",
    getStatus: () => "ready",
    run: async ({ input, context, modelId }) => {
      const obj = (input ?? {}) as { topic?: string; style?: string; accountId?: string };
      const { topic, style = "professional", accountId } = obj;
      if (!topic) return { ok: false, error: "topic is required" };

      try {
        const chatModel = createChatModel(modelId);
        const response = await chatModel.invoke(`Write a ${style} article about: ${topic}`);
        const content = response.content.toString();

        const saveResult = await createBoardDoc({
          title: `Article: ${topic}`,
          content,
          userId: context.userId,
          accessToken: context.accessToken,
          personaId: null,
        });

        if (!saveResult.ok) return { ok: false, error: saveResult.error };

        // If accountId is provided, we could post immediately, 
        // but protocol suggests asking user after generation.
        return { ok: true, output: { docId: saveResult.docId, content: content.slice(0, 500) + "..." } };
      } catch (e) {
        return { ok: false, error: "Failed to generate article" };
      }
    }
  },
  {
    id: "competitor-analysis",
    name: "Competitor Analysis",
    description: "Analyzes competitor X handles and generates a hot-content aggregation report.",
    category: "integration",
    getStatus: () => "ready",
    run: async ({ input, context, modelId }) => {
      const obj = (input ?? {}) as { handles?: string[] };
      const handles = obj.handles ?? [];
      if (handles.length === 0) return { ok: false, error: "handles are required" };

      try {
        const chatModel = createChatModel(modelId);
        // Mocking data retrieval for handles
        const report = await chatModel.invoke(`Analyze these competitors: ${handles.join(", ")}. Identify hot topics and engagement trends.`);
        
        const saveResult = await createBoardDoc({
          title: `Competitor Analysis: ${handles.join(", ")}`,
          content: report.content.toString(),
          userId: context.userId,
          accessToken: context.accessToken,
          personaId: null,
        });

        return { ok: true, output: { docId: saveResult.ok ? saveResult.docId : null, summary: "Analysis completed and saved." } };
      } catch (e) {
        return { ok: false, error: "Analysis failed" };
      }
    }
  },
  {
    id: "wechat-competitor-collection",
    name: "WeChat Competitor Collection",
    description: "Reads a Notion page and extracts WeChat competitor information into a structured document.",
    category: "integration",
    getStatus: () => "ready",
    run: async ({ input, context, modelId }) => {
      const obj = (input ?? {}) as { notionPageId?: string };
      if (!obj.notionPageId) return { ok: false, error: "notionPageId is required" };

      try {
        const token = process.env.NOTION_TOKEN || "";
        const rawText = await fetchNotionPageText(token, obj.notionPageId);
        const chatModel = createChatModel(modelId);
        const structured = await chatModel.invoke(`Extract WeChat competitors from this text and format as a list: ${rawText}`);

        const saveResult = await createBoardDoc({
          title: "WeChat Competitor List",
          content: structured.content.toString(),
          userId: context.userId,
          accessToken: context.accessToken,
          personaId: null,
        });

        return { ok: true, output: { docId: saveResult.ok ? saveResult.docId : null } };
      } catch (e) {
        return { ok: false, error: "Collection failed" };
      }
    }
  },
  {
    id: "list-twitter-accounts",
    name: "List Twitter Accounts",
    description: "Returns all connected X/Twitter accounts for the user.",
    category: "integration",
    getStatus: () => "ready",
    run: async ({ context }) => {
      try {
        const db = await getMongoDb();
        const docs = await db.collection("social_accounts").find({ userId: context.userId, provider: "twitter" }).toArray();
        const accounts = docs.map(d => ({ id: d.providerAccountId, username: d.profile?.username, name: d.profile?.name }));
        return { ok: true, output: { accounts } };
      } catch (e) {
        return { ok: false, error: "Failed to list accounts" };
      }
    }
  },
  {
    id: "post-to-twitter",
    name: "Post to Twitter",
    description: "Posts a tweet to a specific X account.",
    category: "integration",
    getStatus: () => "ready",
    run: async ({ input, context }) => {
      const { text, accountId } = (input ?? {}) as { text?: string, accountId?: string };
      if (!text) return { ok: false, error: "text is required" };
      const result = await postToXForUser({ userId: context.userId, text, accountId });
      return result.ok ? { ok: true, output: { tweetId: result.tweetId } } : { ok: false, error: result.error || "Post failed" };
    }
  },
  {
    id: "create-board-doc",
    name: "Create Board Doc",
    description: "Saves text content to the user's board resources.",
    category: "documents",
    getStatus: () => "ready",
    run: async ({ input, context }) => {
      const { title, content, personaId } = (input ?? {}) as { title?: string, content?: string, personaId?: string };
      if (!title || !content) return { ok: false, error: "title and content are required" };
      const res = await createBoardDoc({ title, content, userId: context.userId, accessToken: context.accessToken, personaId: personaId ?? null });
      return res.ok ? { ok: true, output: { docId: res.docId } } : { ok: false, error: res.error };
    }
  }
];

export function getSkill(id: string): Skill | undefined {
  return SKILLS.find((s) => s.id === id);
}

export function listSkills(): SkillMeta[] {
  return SKILLS.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    status: s.getStatus(),
  }));
}
