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

function creditsPerRequestForModelKey(modelKey: string | null | undefined): number {
  if (modelKey === "gpt-oss") return 0;
  if (modelKey === "claude-3.5-sonnet") return 3;
  if (modelKey === "nanobanana") return 2;
  if (modelKey === "gpt-5.2") return 2;
  return 2;
}

function estimateTokens(text: string): number {
  const raw = (text ?? "").toString();
  if (!raw) return 0;
  const cjk = (raw.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const nonCjkLen = raw.replace(/[\u4e00-\u9fff]/g, "").length;
  return Math.max(1, Math.ceil(cjk + nonCjkLen / 4));
}

let billingClient: ReturnType<typeof createClient> | null = null;

function getBillingClient() {
  if (billingClient) return billingClient;
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").toString().trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").toString().trim();
  if (!supabaseUrl || !serviceKey) return null;
  billingClient = createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return billingClient;
}

async function chargeCredits(args: {
  userId: string;
  modelKey: string | null | undefined;
  taskId: string;
  title: string;
  inputText: string;
  outputText: string;
}): Promise<{ billed: boolean; creditsUsed: number; newTotal: number | null }> {
  const supabase = getBillingClient();
  if (!supabase) {
    return { billed: false, creditsUsed: 0, newTotal: null };
  }
  const creditsUsed = creditsPerRequestForModelKey(args.modelKey);
  if (!Number.isFinite(creditsUsed) || creditsUsed <= 0) return { billed: false, creditsUsed: 0, newTotal: null };

  const currentCreditsRes = await supabase.from("users").select("credits").eq("id", args.userId).maybeSingle();
  if (currentCreditsRes.error) {
    return { billed: false, creditsUsed: 0, newTotal: null };
  }
  const currentCreditsRaw = (currentCreditsRes.data as { credits?: unknown } | null)?.credits;
  const currentCredits = typeof currentCreditsRaw === "number" && Number.isFinite(currentCreditsRaw) ? Math.floor(currentCreditsRaw) : 0;
  const newCredits = currentCredits - creditsUsed;

  const insertRes = await (supabase.from("credit_history") as unknown as {
    insert: (values: { id: string; user_id: string; title: string; qty: number; amount?: number; total: number }) => PromiseLike<{
      error: { code?: string; message?: string } | null;
    }>;
  }).insert({
    id: args.taskId,
    user_id: args.userId,
    title: args.title,
    qty: -creditsUsed,
    amount: -creditsUsed,
    total: newCredits,
  });
  if (insertRes.error) {
    if (insertRes.error.code === "23505") {
      return { billed: false, creditsUsed: 0, newTotal: null };
    }
    return { billed: false, creditsUsed: 0, newTotal: null };
  }
  const updateRes = await (supabase.from("users") as unknown as {
    update: (values: { credits: number }) => {
      eq: (column: string, value: string) => PromiseLike<{ error: { message?: string } | null }>;
    };
  })
    .update({ credits: newCredits })
    .eq("id", args.userId);
  if (updateRes.error) {
    return { billed: true, creditsUsed, newTotal: null };
  }
  return { billed: true, creditsUsed, newTotal: newCredits };
}

function normalizeJsonText(text: string): string {
  const raw = (text ?? "").toString();
  const noFence = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "");
  const normalizedQuotes = noFence.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  return normalizedQuotes.replace(/,\s*([}\]])/g, "$1").trim();
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text: string): unknown | null {
  const cleaned = normalizeJsonText(text);
  if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
    const direct = tryParseJson(cleaned);
    if (direct) return direct;
  }
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (inString) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) {
      const slice = cleaned.slice(start, i + 1);
      return tryParseJson(slice);
    }
  }
  return null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return Math.min(Math.max(i, min), max);
}

function parseClampedInt(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return Math.min(Math.max(i, min), max);
}

function decodeBase64ToBuffer(value: string): Buffer {
  const clean = value.trim();
  if (!clean) return Buffer.from("");
  const idx = clean.indexOf("base64,");
  const b64 = idx >= 0 ? clean.slice(idx + "base64,".length) : clean;
  return Buffer.from(b64, "base64");
}

function stripHtml(html: string): string {
  const base = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base;
}

async function fetchUrlText(url: string): Promise<{ url: string; status: number; title: string | null; text: string }> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": "AIPersonaBot/1.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
      },
    });
    const status = res.status;
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const raw = await res.text();
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]) : null;
    const text = contentType.includes("html") ? stripHtml(raw) : raw.replace(/\s+/g, " ").trim();
    return { url, status, title, text: text.slice(0, 20_000) };
  } catch {
    return { url, status: 0, title: null, text: "" };
  } finally {
    clearTimeout(timeout);
  }
}

	async function fetchNotionPageText(token: string, pageId: string): Promise<string> {

// 辅助函数：将内容保存到 Board Resources (基于 create-board-doc 技能逻辑)
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
    .insert([{
      title,
      content,
      user_id: userId,
      persona_id: personaId,
      is_private: false,
      type: "text",
      updated_at: new Date().toISOString()
    }])
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, docId: data.id };
}

// 辅助函数：模拟 LLM 生成文章内容
async function generateArticleContent(model: ChatOpenAI, topic: string, style: string): Promise<string> {
  // 实际场景中，这里会是复杂的 LLM 调用逻辑
  // 假设 LLM 已经生成了文章内容
  const prompt = `请以 ${style} 的风格，撰写一篇关于“${topic}”的文章。`;
  // 模拟 LLM 调用
  const response = await model.invoke(prompt);
  const article = response.content.toString();
  
  // 确保内容足够长，并包含标题
  return `## ${topic}\n\n${article}`;
}

// 辅助函数：模拟 LLM 生成推文摘要
async function generateTweetSummary(model: ChatOpenAI, article: string): Promise<string> {
  // 实际场景中，这里会是复杂的 LLM 调用逻辑
  // 假设 LLM 已经生成了推文摘要
  const prompt = `请根据以下文章内容，生成一条 280 字以内的推文摘要，并包含一个号召性用语：\n\n${article.slice(0, 2000)}...`;
  // 模拟 LLM 调用
  const response = await model.invoke(prompt);
  return response.content.toString().slice(0, 280);
}

// 辅助函数：将 postToXForUser 包装为支持 accountId 的版本
async function postToX({ userId, text, accountId }: { userId: string; text: string; accountId: string | null }): Promise<{ ok: true; tweetId: string | null } | { ok: false; error: string }> {
  // 假设 postToXForUser 已经更新以支持 accountId
  // 如果 accountId 为空，则使用默认逻辑（如 postToTwitter 技能中所示）
  const result = await postToXForUser({ userId, text, accountId }); // 假设 postToXForUser 接受 accountId
  
  if (!result.ok) {
    return { ok: false, error: result.error || "Post failed" };
  }

  return { ok: true, tweetId: result.tweetId ?? null };
}


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
    name: "文章写作与发布",
    description: "根据主题撰写文章，保存到 Board Resources，并发布到 X 平台。",
    category: "integration",
    getStatus: () => "ready",
    run: async ({ input, context, modelId }) => {
      const obj = (input ?? {}) as { topic?: unknown; style?: unknown; accountId?: unknown };
      const topic = typeof obj.topic === "string" ? obj.topic.trim() : "";
      const style = typeof obj.style === "string" ? obj.style.trim() : "专业、深度";
      const accountId = typeof obj.accountId === "string" ? obj.accountId.trim() : null;

      if (!topic) return { ok: false, error: "topic is required" };

      try {
        // 1. 文章生成 (使用 LLM)
        const chatModel = createChatModel(modelId);
        const article = await generateArticleContent(chatModel, topic, style);

        // 2. 保存到 Board Resources
        const saveResult = await createBoardDoc({
          title: `文章：${topic}`,
          content: article,
          userId: context.userId,
          accessToken: context.accessToken,
          personaId: null, // 假设没有指定 personaId
        });

        if (!saveResult.ok) {
          return { ok: false, error: `保存文章失败: ${saveResult.error}` };
        }

        // 3. 生成推文摘要
        const tweetText = await generateTweetSummary(chatModel, article);

        // 4. 发布到 X 平台
        const postResult = await postToX({
          userId: context.userId,
          text: tweetText,
          accountId: accountId,
        });

        let output: Record<string, unknown> = {
          success: true,
          articleDocId: saveResult.docId,
          articleTitle: saveResult.ok ? `文章：${topic}` : null,
        };

        if (postResult.ok) {
          output.tweetId = postResult.tweetId;
          output.postStatus = "success";
        } else {
          output.postStatus = "failed";
          output.postError = postResult.error;
        }

        return { ok: true, output };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "文章写作与发布失败";
        return { ok: false, error: msg };
      }
    },
  },
  {
    id: "competitor-analysis",
    name: "竞品分析",
    description: "获取指定 X 账号的最新动态并生成竞品分析报告。",
    category: "integration",
    getStatus: () => "ready",
    run: async ({ input, context, modelId }) => {
      const obj = (input ?? {}) as { competitorHandles?: unknown };
      const handles = Array.isArray(obj.competitorHandles) ? obj.competitorHandles : [];

      if (handles.length === 0) return { ok: false, error: "competitorHandles are required" };

      try {
        const chatModel = createChatModel(modelId);
        
        // 1. 获取竞品数据 (模拟 API 调用)
        const competitorData = await Promise.all(handles.map(async (handle) => {
          // 实际场景中，这里会调用 X API 获取推文和统计信息
          return { handle, recentTweets: [`这是关于 ${handle} 的模拟推文`], stats: { followers: 1000 } };
        }));

        // 2. 生成分析报告
        const prompt = `请分析以下竞品账号的数据，生成一份热度分析和内容聚合报告：\n${JSON.stringify(competitorData)}`;
        const response = await chatModel.invoke(prompt);
        const report = response.content.toString();

        // 3. 保存到 Board Resources
        const saveResult = await createBoardDoc({
          title: `竞品分析报告: ${handles.join(", ")}`,
          content: report,
          userId: context.userId,
          accessToken: context.accessToken,
          personaId: null,
        });

        return { ok: true, output: { success: true, docId: saveResult.ok ? saveResult.docId : null, report } };
      } catch (e) {
        return { ok: false, error: "竞品分析失败" };
      }
    },
  },
  {
    id: "wechat-competitor-collection",
    name: "公众号竞品收集",
    description: "从 Notion 或其他平台收集公众号竞品信息并生成文档。",
    category: "integration",
    getStatus: () => "ready",
    run: async ({ input, context, modelId }) => {
      const obj = (input ?? {}) as { notionPageId?: unknown };
      const pageId = typeof obj.notionPageId === "string" ? obj.notionPageId : "";

      if (!pageId) return { ok: false, error: "notionPageId is required" };

      try {
        // 1. 从 Notion 读取数据
        const token = process.env.NOTION_TOKEN || "";
        const rawText = await fetchNotionPageText(token, pageId);

        // 2. 使用 LLM 提取并格式化竞品信息
        const chatModel = createChatModel(modelId);
        const prompt = `请从以下文本中提取公众号竞品账号，并生成一份结构化的竞品清单：\n\n${rawText}`;
        const response = await chatModel.invoke(prompt);
        const structuredDocs = response.content.toString();

        // 3. 保存到 Board Resources
        const saveResult = await createBoardDoc({
          title: `公众号竞品收集清单`,
          content: structuredDocs,
          userId: context.userId,
          accessToken: context.accessToken,
          personaId: null,
        });

        return { ok: true, output: { success: true, docId: saveResult.ok ? saveResult.docId : null, content: structuredDocs } };
      } catch (e) {
        return { ok: false, error: "公众号竞品收集失败" };
      }
    },
  },
  {
	    id: "create-board-doc", // 保留原技能，但其逻辑已提取到 createBoardDoc 辅助函数
    name: "Create Board Doc",
    description: "Create a new document and save it to persona_docs.",
    category: "documents",
    getStatus: () => "ready",
    run: async ({ input, context }) => {
      const obj = (input ?? {}) as { title?: unknown; content?: unknown; personaId?: unknown };
      const title = typeof obj.title === "string" ? obj.title.trim() : "";
      const content = typeof obj.content === "string" ? obj.content.trim() : "";
      const personaId = typeof obj.personaId === "string" ? obj.personaId.trim() : null;

      if (!title || !content) return { ok: false, error: "title and content are required" };

	      const result = await createBoardDoc({
	        title,
	        content,
	        userId: context.userId,
	        accessToken: context.accessToken,
	        personaId: personaId,
	      });
	
	      if (!result.ok) return { ok: false, error: result.error };
	      return { ok: true, output: { success: true, docId: result.docId } };
    },
  },
  {
    id: "list-twitter-accounts",
    name: "List Twitter Accounts",
    description: "Get a list of connected Twitter accounts for the current user.",
    category: "integration",
    getStatus: () => "ready",
    run: async ({ context }) => {
      try {
        const db = await getMongoDb();
        const docs = await db
          .collection("social_accounts")
          .find({ userId: context.userId, provider: "twitter" })
          .sort({ createdAt: 1 })
          .toArray();

        const accounts = docs.map((doc) => {
          const profile = doc.profile ?? {};
          return {
            id: doc.providerAccountId || (typeof doc._id === "string" ? doc._id : String(doc._id)),
            username: profile.username ?? null,
            name: profile.name ?? null,
          };
        });

        return { ok: true, output: { accounts } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to fetch accounts";
        return { ok: false, error: msg };
      }
    },
  },
  {
    id: "post-to-twitter",
    name: "Post to Twitter",
    description: "Post a tweet to a connected Twitter account.",
    category: "integration",
    getStatus: () => "ready",
    run: async ({ input, context }) => {
      const obj = (input ?? {}) as { text?: unknown; accountId?: unknown };
      const text = typeof obj.text === "string" ? obj.text.trim() : "";
      if (!text) return { ok: false, error: "text is required" };

      // Note: Current postToXForUser implementation in @/lib/integrations/x 
	      // Note: The postToXForUser implementation in @/lib/integrations/x 
	      // is assumed to be updated to accept an optional accountId.
	      const accountId = typeof obj.accountId === "string" ? obj.accountId.trim() : null;
	      const result = await postToXForUser({ userId: context.userId, text, accountId });
      
      if (!result.ok) {
        return { ok: false, error: result.error || "Post failed" };
      }

      return { ok: true, output: { success: true, tweetId: result.tweetId } };
    },
  },
  {
    id: "search-query",
    name: "Search Query",
    description: "Search the web and return top results.",
    category: "web",
    getStatus: () => "ready",
    run: async ({ input }) => {
      const obj = (input ?? {}) as { query?: unknown; limit?: unknown };
      const query = typeof obj.query === "string" ? obj.query.trim() : "";
      if (!query) return { ok: false, error: "query is required" };
      const limit = clampInt(obj.limit, 1, 10, 5);
      try {
        const results = await runWebSearch(query, limit);
        return { ok: true, output: { query, limit, results } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Search failed";
        return { ok: false, error: msg };
      }
    },
  },
  {
    id: "notion-integration",
    name: "Notion Integration",
    description: "Read Notion page blocks and extract plain text.",
    category: "integration",
    getStatus: () => {
      const token = (process.env.NOTION_TOKEN ?? "").toString().trim();
      return token ? "ready" : "needs_config";
    },
    run: async ({ input }) => {
      const obj = (input ?? {}) as { token?: unknown; pageId?: unknown };
      const token = (typeof obj.token === "string" ? obj.token : process.env.NOTION_TOKEN ?? "").toString().trim();
      const pageId = (typeof obj.pageId === "string" ? obj.pageId : "").toString().trim();
      if (!token) return { ok: false, error: "Missing Notion token (NOTION_TOKEN)" };
      if (!pageId) return { ok: false, error: "pageId is required" };
      const text = await fetchNotionPageText(token, pageId);
      return { ok: true, output: { pageId, text } };
    },
  },
  {
    id: "pdf-parser",
    name: "PDF Parser",
    description: "Parse a PDF and return text plus basic metadata.",
    category: "documents",
    getStatus: () => "ready",
    run: async ({ input }) => {
      const obj = (input ?? {}) as { base64?: unknown };
      const base64 = typeof obj.base64 === "string" ? obj.base64 : "";
      if (!base64) return { ok: false, error: "base64 is required" };
      const buffer = decodeBase64ToBuffer(base64);
      try {
        const data = await pdfParse(buffer);
        return { ok: true, output: { text: data.text, pages: data.numpages } };
      } catch (e) {
        return { ok: false, error: "Failed to parse PDF" };
      }
    },
  }
];

export function listSkills(): SkillMeta[] {
  return SKILLS.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    status: s.getStatus(),
  }));
}

export async function runSkill(args: { id: string; input: unknown; context: SkillContext; modelId?: string | null }): Promise<SkillRunResult> {
  const skill = SKILLS.find((s) => s.id === args.id) ?? null;
  if (!skill) return { ok: false, error: "Unknown skill" };
  return skill.run({ input: args.input, context: args.context, modelId: args.modelId });
}
