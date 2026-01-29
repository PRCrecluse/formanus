import { createClient } from "@supabase/supabase-js";
import { getMongoDb } from "@/lib/mongodb";
import type { AutomationDoc } from "@/lib/automationScheduler";
import { runWebSearch } from "@/lib/skills";

export const runtime = "nodejs";

type AutomationWebhookPayload = {
  automation_id?: unknown;
  user_id?: unknown;
  fired_at?: unknown;
};

function normalizeString(value: unknown) {
  return String(value ?? "").trim();
}

function pickModelConfig(modelKey: string | null | undefined) {
  const key = (modelKey ?? "").toString().trim();
  const defs = [
    { id: "persona-ai", modelId: "google/gemini-3-pro-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
    { id: "gpt-5.2", modelId: "openai/gpt-5.2", keyName: "NEXT_PUBLIC_GPT52_API_KEY" },
    { id: "gpt-oss", modelId: "openai/gpt-oss-120b:free", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
    { id: "nanobanana", modelId: "google/gemini-3-pro-image-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
    { id: "gemini-3.0-pro", modelId: "google/gemini-3-pro-preview", keyName: "NEXT_PUBLIC_OPENROUTER_API_KEY" },
    { id: "minimax-m2", modelId: "minimax/minimax-m2", keyName: "NEXT_PUBLIC_MINIMAX_API_KEY" },
    { id: "kimi-0905", modelId: "moonshotai/kimi-k2-0905", keyName: "NEXT_PUBLIC_KIMI_API_KEY" },
    { id: "claude-3.5-sonnet", modelId: "anthropic/claude-3.5-sonnet", keyName: "NEXT_PUBLIC_CLAUDE_API_KEY" },
  ] as const;
  const found = defs.find((d) => d.id === key) ?? defs[0];
  const directKey = (process.env[found.keyName] ?? "").toString().trim();
  const fallbackKey = (process.env.NEXT_PUBLIC_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY ?? "").toString().trim();
  return { modelId: found.modelId, apiKey: directKey || fallbackKey };
}

async function callOpenRouter(args: { modelKey: string | null; system: string; user: string }) {
  const baseURL = ((process.env.NEXT_PUBLIC_OPENROUTER_BASE_URL ?? process.env.OPENROUTER_BASE_URL ?? "").toString().trim() ||
    "https://openrouter.ai/api/v1");
  const cfg = pickModelConfig(args.modelKey);
  if (!cfg.apiKey) throw new Error("Missing model API key");
  const res = await fetch(`${baseURL.replace(/\/+$/g, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://aipersona.web",
      "X-Title": "AIPersona",
    },
    body: JSON.stringify({
      model: cfg.modelId,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    }),
  });
  const json = (await res.json().catch(() => null)) as unknown;
  const content =
    typeof json === "object" &&
    json !== null &&
    "choices" in json &&
    Array.isArray((json as { choices?: unknown }).choices) &&
    (json as { choices: { message?: { content?: unknown } }[] }).choices.length > 0
      ? (json as { choices: { message?: { content?: unknown } }[] }).choices[0]?.message?.content
      : undefined;
  if (!res.ok) {
    const msg =
      typeof json === "object" &&
      json !== null &&
      "error" in json &&
      typeof (json as { error?: { message?: unknown } }).error?.message === "string"
        ? ((json as { error: { message: string } }).error.message as string)
        : "";
    throw new Error(msg || `Upstream failed (${res.status})`);
  }
  return typeof content === "string" ? content : "";
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  let body: AutomationWebhookPayload | null = null;
  try {
    body = (await req.json()) as AutomationWebhookPayload;
  } catch {
    body = null;
  }
  const automationId = normalizeString(body?.automation_id);
  const userId = normalizeString(body?.user_id);
  if (!automationId || !userId) return Response.json({ error: "Bad Request", requestId }, { status: 400 });

  const db = await getMongoDb();
  const automation = await db.collection<AutomationDoc & { internal?: Record<string, unknown> }>("automations").findOne({
    _id: automationId,
    userId,
  });
  if (!automation) return Response.json({ error: "Not found", requestId }, { status: 404 });

  const internal = automation.internal && typeof automation.internal === "object" ? (automation.internal as Record<string, unknown>) : null;
  const kind = normalizeString(internal?.kind);
  const modelKey = normalizeString(internal?.model_key) || null;

  if (kind !== "competitor_monitor" && kind !== "ai_news_briefing") {
    return Response.json({ ok: true, skipped: true, requestId }, { status: 200 });
  }

  const firedAt = normalizeString(body?.fired_at) || new Date().toISOString();
  const date = new Date(firedAt).toISOString().slice(0, 10);

  const { title, content } = await (async () => {
    if (kind === "ai_news_briefing") {
      const topic = normalizeString(internal?.topic) || "AI新闻早报";
      const query = `${topic} 最新 24小时`;
      const results = await runWebSearch(query, 8).catch(() => []);
      const sources = results
        .map((r, idx) => `${idx + 1}. ${r.title}\n${r.url}\n${r.snippet}`.trim())
        .filter(Boolean)
        .join("\n\n");

      const system = "你是AIPersona自动化执行器。请用中文输出AI新闻早报，简洁但信息密度高。";
      const user = [
        `主题：${topic}`,
        `执行时间：${firedAt}`,
        "",
        "请基于以下检索结果，输出：",
        "1) 今日AI大事（3-6条）",
        "2) 产品/融资/政策（各2-4条，若无可省略）",
        "3) 值得跟进的3个信号（给出原因）",
        "4) 结尾附上Sources链接列表",
        "",
        sources || "（无检索结果）",
      ].join("\n");

      const report = await callOpenRouter({ modelKey, system, user });
      const title = `AI新闻早报 · ${date}`;
      const content = [report.trim(), "", "## Sources", sources].filter((s) => s && s.trim()).join("\n\n");
      return { title, content };
    }

    const target = normalizeString(internal?.target) || automation.name;
    const query = target.includes("竞品") ? target : `${target} 竞品`;
    const results = await runWebSearch(`${query} 最新 动态`, 6).catch(() => []);
    const sources = results
      .map((r, idx) => `${idx + 1}. ${r.title}\n${r.url}\n${r.snippet}`.trim())
      .filter(Boolean)
      .join("\n\n");

    const system = "你是AIPersona自动化执行器。请用中文输出结构化日报，简洁但信息密度高。";
    const user = [
      `目标：${target}`,
      `执行时间：${firedAt}`,
      "",
      "请基于以下检索结果，总结该目标的主要竞品动态与值得关注的信息点，并给出3条可执行建议。",
      "",
      sources || "（无检索结果）",
    ].join("\n");

    const report = await callOpenRouter({ modelKey, system, user });
    const title = `竞品监控日报：${target} · ${date}`;
    const content = [report.trim(), "", "## Sources", sources].filter((s) => s && s.trim()).join("\n\n");
    return { title, content };
  })();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").toString().trim();
  if (!supabaseUrl || !serviceKey) return Response.json({ error: "Supabase not configured", requestId }, { status: 500 });
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await supabase
    .from("persona_docs")
    .insert({
      user_id: userId,
      persona_id: null,
      title,
      content,
      type: "text",
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) return Response.json({ error: error.message, requestId }, { status: 500 });

  const docId =
    typeof data === "object" && data !== null && "id" in data && typeof (data as { id?: unknown }).id === "string"
      ? ((data as { id: string }).id as string)
      : null;
  return Response.json({ ok: true, doc_id: docId, requestId }, { status: 200 });
}
