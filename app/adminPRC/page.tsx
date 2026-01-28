"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Activity, AlertCircle, Bot, Calculator, CheckCircle2, ChevronDown, FileText, Loader2, Search, Route as RouteIcon, Wand2, Wrench } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSqliteClient } from "@/lib/sqliteClient";

type ModelOption = {
  id: string;
  name: string;
};

type AdminModelRow = {
  id: string;
  name: string;
  modelId: string;
  priority: number;
  enabled: boolean;
  apiKeyLast4: string;
  hasApiKey: boolean;
};

type SkillRow = {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  configured: boolean;
};

type AdminTab = "test" | "pricing" | "models" | "routes" | "mode" | "oss" | "prompts";

type AdminPromptRow = {
  id: string;
  hasFile: boolean;
  hasCloud: boolean;
  cloudUpdatedAt: string | null;
};

const PROMPT_TAGS: Record<string, string[]> = {
  "board_chat2edit_system_ask.txt": ["Board", "chat2edit", "System(Ask)"],
  "board_chat2edit_system_create.txt": ["Board", "chat2edit", "System(Create)"],
  "board_chat2edit_user.txt": ["Board", "chat2edit", "User Template"],
  "xhs_batch_system.txt": ["Skill:xhs-batch", "System", "JSON Plan"],
  "image_prompt_short.txt": ["Image", "XHS Template(Short)", "Fallback"],
  "image_prompt.txt": ["Image", "XHS Template(Long)", "Used:xhs-batch,board"],
  "oss_autocomplete_system.txt": ["Persona", "OSS Autocomplete", "System"],
  "outline_prompt.txt": ["XHS Outline", "Unused"],
  "content_prompt.txt": ["XHS Content", "Unused"],
};

const CONFIG_ROW_IDS = new Set<string>([
  "ask-default",
  "ask-default-cn",
  "ask-fallback-1",
  "ask-fallback-2",
  "ask-fallback-cn-1",
  "ask-fallback-cn-2",
  "oss-prompt-system",
  "oss-prompt-model",
  "oss-prompt-baseurl",
]);

const MODEL_OPTIONS: ModelOption[] = [
  { id: "persona-ai", name: "PersonaAI (Gemini 3.0 Pro)" },
  { id: "gpt-5.2", name: "GPT5.2 (GPT-5.2)" },
  { id: "gpt-oss", name: "GPT oss (GPT-OSS 120B Free)" },
  { id: "nanobanana", name: "Nanobanana (Gemini 3 Pro Image)" },
  { id: "gemini-3.0-pro", name: "Gemini 3.0 Pro" },
  { id: "minimax-m2", name: "Minimax M2" },
  { id: "kimi-0905", name: "Kimi 0905" },
];

const SKILL_SAMPLE_INPUTS: Record<string, unknown> = {
  "web-verify": {
    urls: ["https://www.example.com"],
    question: "请基于网页内容判断该站点是否可访问，并简单总结。",
  },
  "search-query": {
    query: "AI Agent 工具推荐",
    limit: 5,
  },
};

const PRICE_CALCULATOR_MODELS = [
  { id: "persona-ai", name: "PersonaAI（高质量）", creditsPerK: 0.9 },
  {
    id: "advanced-bundle",
    name: "高级组合（Nanobanana / GPT5.2 / Gemini3.0 Pro / Minimax M2 / Kimi0905）",
    creditsPerK: 0.45,
  },
] as const;

type PriceCalculatorModelId = (typeof PRICE_CALCULATOR_MODELS)[number]["id"];
type PriceCalculatorModelMeta = (typeof PRICE_CALCULATOR_MODELS)[number];

const ADMIN_EMAIL = "1765591779@qq.com";
const ADMIN_PROVIDER = "apple";
const ADMIN_QUERY_PARAM_KEY = "panel";
const ADMIN_QUERY_PARAM_SECRET = (process.env.NEXT_PUBLIC_ADMIN_PANEL_KEY ?? "").toString().trim();
const ADMIN_QUERY_PARAM_REQUIRED = ADMIN_QUERY_PARAM_SECRET.length > 0;

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [accessToken, setAccessToken] = useState<string>("");
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [selectedModelId, setSelectedModelId] = useState<string>("persona-ai");
  const [modelPrompt, setModelPrompt] = useState<string>("测试一下当前模型是否可用，请用一句话自我介绍。");
  const [modelTesting, setModelTesting] = useState(false);
  const [modelResult, setModelResult] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);

  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillRow[]>([]);

  const [adminModels, setAdminModels] = useState<AdminModelRow[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsSaving, setModelsSaving] = useState(false);
  const [modelsSaveMessage, setModelsSaveMessage] = useState<string | null>(null);
  const [askDefaultId, setAskDefaultId] = useState<string>("claude-3.5-sonnet");
  const [askDefaultCnId, setAskDefaultCnId] = useState<string>("kimi-0905");
  const [askDefaultsSaving, setAskDefaultsSaving] = useState(false);
  const [askDefaultsMessage, setAskDefaultsMessage] = useState<string | null>(null);
  const [askFallback1Id, setAskFallback1Id] = useState<string>("");
  const [askFallback2Id, setAskFallback2Id] = useState<string>("");
  const [askFallbackCn1Id, setAskFallbackCn1Id] = useState<string>("");
  const [askFallbackCn2Id, setAskFallbackCn2Id] = useState<string>("");
  const [ossPromptSystem, setOssPromptSystem] = useState<string>("");
  const [ossPromptModel, setOssPromptModel] = useState<string>("");
  const [ossPromptBaseUrl, setOssPromptBaseUrl] = useState<string>("");
  const [ossPromptSaving, setOssPromptSaving] = useState(false);
  const [ossPromptMessage, setOssPromptMessage] = useState<string | null>(null);

  const [prompts, setPrompts] = useState<AdminPromptRow[]>([]);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [promptsError, setPromptsError] = useState<string | null>(null);
  const [promptQuery, setPromptQuery] = useState("");
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [promptContent, setPromptContent] = useState("");
  const [promptHasFile, setPromptHasFile] = useState(false);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptSaveMessage, setPromptSaveMessage] = useState<string | null>(null);
  const [promptSyncToCloud, setPromptSyncToCloud] = useState(true);
  const [promptWriteToFile, setPromptWriteToFile] = useState(true);

  const [newModelId, setNewModelId] = useState("");
  const [newModelName, setNewModelName] = useState("");
  const [newModelModelId, setNewModelModelId] = useState("");
  const [newModelApiKey, setNewModelApiKey] = useState("");
  const [newModelPriority, setNewModelPriority] = useState("");
  const [newModelEnabled, setNewModelEnabled] = useState(true);
  const [newModelSaving, setNewModelSaving] = useState(false);
  const [newModelMessage, setNewModelMessage] = useState<string | null>(null);

  const [selectedSkillId, setSelectedSkillId] = useState<string>("");
  const [skillInputText, setSkillInputText] = useState<string>("{}");
  const [skillModelId, setSkillModelId] = useState<string>("persona-ai");
  const [skillRunning, setSkillRunning] = useState(false);
  const [skillResult, setSkillResult] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);

  const selectedPromptTags = useMemo(() => {
    const id = (selectedPromptId ?? "").toString().trim();
    return id ? PROMPT_TAGS[id] ?? [] : [];
  }, [selectedPromptId]);

  const [calcModelId, setCalcModelId] = useState<PriceCalculatorModelId>("persona-ai");
  const [calcTokens, setCalcTokens] = useState<string>("1000");
  const [calcUpstreamCostPerK, setCalcUpstreamCostPerK] = useState<string>("");
  const [calcPricePerCredit, setCalcPricePerCredit] = useState<string>("");

  const selectedSkill = useMemo(() => skills.find((s) => s.id === selectedSkillId) ?? null, [skills, selectedSkillId]);
  const selectedSkillSample = useMemo(() => {
    const sample = selectedSkillId ? SKILL_SAMPLE_INPUTS[selectedSkillId] : null;
    return sample ? JSON.stringify(sample, null, 2) : "";
  }, [selectedSkillId]);

  const filteredPrompts = useMemo(() => {
    const q = promptQuery.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter((p) => p.id.toLowerCase().includes(q));
  }, [promptQuery, prompts]);

  const priceCalculatorModelMeta = useMemo<PriceCalculatorModelMeta>(() => {
    const map = new Map<PriceCalculatorModelId, PriceCalculatorModelMeta>(
      PRICE_CALCULATOR_MODELS.map((m) => [m.id, m])
    );
    return map.get(calcModelId) ?? PRICE_CALCULATOR_MODELS[0];
  }, [calcModelId]);

  const priceCalculatorValues = useMemo(() => {
    const tokens = Number(String(calcTokens).replace(/[^0-9.]/g, "")) || 0;
    const upstreamPerK = Number(String(calcUpstreamCostPerK).replace(/[^0-9.]/g, "")) || 0;
    const pricePerCredit = Number(String(calcPricePerCredit).replace(/[^0-9.]/g, "")) || 0;
    const creditsPerK = priceCalculatorModelMeta.creditsPerK;
    const credits = (tokens / 1000) * creditsPerK;
    const upstreamCost = (tokens / 1000) * upstreamPerK;
    const revenue = credits * pricePerCredit;
    const profit = revenue - upstreamCost;
    const revenuePerK = creditsPerK * pricePerCredit;
    const profitPerK = revenuePerK - upstreamPerK;
    return {
      tokens,
      creditsPerK,
      credits,
      upstreamPerK,
      upstreamCost,
      pricePerCredit,
      revenue,
      profit,
      revenuePerK,
      profitPerK,
    };
  }, [calcTokens, calcUpstreamCostPerK, calcPricePerCredit, priceCalculatorModelMeta]);

  const adminModelsUrl = useMemo(() => {
    const queryValueRaw = searchParams.get(ADMIN_QUERY_PARAM_KEY) ?? "";
    const queryValue = queryValueRaw.toString().trim();
    const suffix = queryValue ? `?${ADMIN_QUERY_PARAM_KEY}=${encodeURIComponent(queryValue)}` : "";
    return `/api/admin/models${suffix}`;
  }, [searchParams]);

  const adminSkillModelsUrl = useMemo(() => {
    const queryValueRaw = searchParams.get(ADMIN_QUERY_PARAM_KEY) ?? "";
    const queryValue = queryValueRaw.toString().trim();
    const suffix = queryValue ? `?${ADMIN_QUERY_PARAM_KEY}=${encodeURIComponent(queryValue)}` : "";
    return `/api/admin/skill-models${suffix}`;
  }, [searchParams]);

  const adminPromptsUrl = useMemo(() => {
    const queryValueRaw = searchParams.get(ADMIN_QUERY_PARAM_KEY) ?? "";
    const queryValue = queryValueRaw.toString().trim();
    const suffix = queryValue ? `?${ADMIN_QUERY_PARAM_KEY}=${encodeURIComponent(queryValue)}` : "";
    return `/api/admin/prompts${suffix}`;
  }, [searchParams]);

  const adminPromptUrlForId = useCallback(
    (id: string) => {
      const queryValueRaw = searchParams.get(ADMIN_QUERY_PARAM_KEY) ?? "";
      const queryValue = queryValueRaw.toString().trim();
      const suffix = queryValue ? `?${ADMIN_QUERY_PARAM_KEY}=${encodeURIComponent(queryValue)}` : "";
      return `/api/admin/prompts/${encodeURIComponent(id)}${suffix}`;
    },
    [searchParams]
  );

  const activeTab = useMemo<AdminTab>(() => {
    const raw = (searchParams.get("tab") ?? "").toString().trim();
    if (raw === "pricing" || raw === "models" || raw === "routes" || raw === "test" || raw === "mode" || raw === "oss" || raw === "prompts")
      return raw;
    return "test";
  }, [searchParams]);

  const setActiveTab = useCallback(
    (tab: AdminTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", tab);
      const next = params.toString();
      router.replace(next ? `/adminPRC?${next}` : "/adminPRC");
    },
    [router, searchParams]
  );

  const modelOptions = useMemo<ModelOption[]>(() => {
    if (adminModels.length === 0) return MODEL_OPTIONS;
    return adminModels.filter((m) => !CONFIG_ROW_IDS.has(m.id)).map((m) => ({ id: m.id, name: m.name || m.id }));
  }, [adminModels]);

  useEffect(() => {
    const allowed = new Set(modelOptions.map((m) => m.id));
    const row = adminModels.find((m) => m.id === "ask-default") ?? null;
    const cnRow = adminModels.find((m) => m.id === "ask-default-cn") ?? null;
    const fb1Row = adminModels.find((m) => m.id === "ask-fallback-1") ?? null;
    const fb2Row = adminModels.find((m) => m.id === "ask-fallback-2") ?? null;
    const fbCn1Row = adminModels.find((m) => m.id === "ask-fallback-cn-1") ?? null;
    const fbCn2Row = adminModels.find((m) => m.id === "ask-fallback-cn-2") ?? null;
    const systemRow = adminModels.find((m) => m.id === "oss-prompt-system") ?? null;
    const modelRow = adminModels.find((m) => m.id === "oss-prompt-model") ?? null;
    const baseUrlRow = adminModels.find((m) => m.id === "oss-prompt-baseurl") ?? null;

    const id = (row?.modelId ?? "").toString().trim();
    if (id && allowed.has(id)) setAskDefaultId(id);

    const cnId = (cnRow?.modelId ?? "").toString().trim();
    if (cnId && allowed.has(cnId)) setAskDefaultCnId(cnId);

    const fb1Id = (fb1Row?.modelId ?? "").toString().trim();
    if (fb1Id && allowed.has(fb1Id)) setAskFallback1Id(fb1Id);
    const fb2Id = (fb2Row?.modelId ?? "").toString().trim();
    if (fb2Id && allowed.has(fb2Id)) setAskFallback2Id(fb2Id);
    const fbCn1Id = (fbCn1Row?.modelId ?? "").toString().trim();
    if (fbCn1Id && allowed.has(fbCn1Id)) setAskFallbackCn1Id(fbCn1Id);
    const fbCn2Id = (fbCn2Row?.modelId ?? "").toString().trim();
    if (fbCn2Id && allowed.has(fbCn2Id)) setAskFallbackCn2Id(fbCn2Id);

    const system = (systemRow?.modelId ?? "").toString();
    if (system) setOssPromptSystem(system);

    const m = (modelRow?.modelId ?? "").toString();
    if (m) setOssPromptModel(m);

    const b = (baseUrlRow?.modelId ?? "").toString();
    if (b) setOssPromptBaseUrl(b);
  }, [adminModels, modelOptions]);

  const saveAskDefaults = useCallback(async () => {
    if (!accessToken) return;
    try {
      setAskDefaultsSaving(true);
      setAskDefaultsMessage(null);
      const queryValueRaw = searchParams.get(ADMIN_QUERY_PARAM_KEY) ?? "";
      const queryValue = queryValueRaw.toString().trim();
      const suffix = queryValue ? `?${ADMIN_QUERY_PARAM_KEY}=${encodeURIComponent(queryValue)}` : "";
      const res = await fetch(`/api/admin/models${suffix}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          models: [
            { id: "ask-default", name: "Ask Default", modelId: askDefaultId, enabled: false, priority: 9990 },
            { id: "ask-default-cn", name: "Ask Default (CN)", modelId: askDefaultCnId, enabled: false, priority: 9991 },
            { id: "ask-fallback-1", name: "Ask Fallback #1", modelId: askFallback1Id, enabled: false, priority: 9992 },
            { id: "ask-fallback-2", name: "Ask Fallback #2", modelId: askFallback2Id, enabled: false, priority: 9993 },
            { id: "ask-fallback-cn-1", name: "Ask Fallback CN #1", modelId: askFallbackCn1Id, enabled: false, priority: 9994 },
            { id: "ask-fallback-cn-2", name: "Ask Fallback CN #2", modelId: askFallbackCn2Id, enabled: false, priority: 9995 },
          ],
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setAskDefaultsMessage(text || `HTTP ${res.status}`);
        return;
      }
      setAskDefaultsMessage("Ask 模式默认模型已保存");
      const refreshed = await fetch(`/api/admin/models${suffix}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (refreshed.ok) {
        const dataJson = (await refreshed.json()) as { models?: AdminModelRow[] };
        setAdminModels(Array.isArray(dataJson.models) ? dataJson.models : []);
      }
    } finally {
      setAskDefaultsSaving(false);
    }
  }, [accessToken, askDefaultCnId, askDefaultId, askFallback1Id, askFallback2Id, askFallbackCn1Id, askFallbackCn2Id, searchParams]);

  const saveOssPrompt = useCallback(async () => {
    if (!accessToken) return;
    try {
      setOssPromptSaving(true);
      setOssPromptMessage(null);
      const queryValueRaw = searchParams.get(ADMIN_QUERY_PARAM_KEY) ?? "";
      const queryValue = queryValueRaw.toString().trim();
      const suffix = queryValue ? `?${ADMIN_QUERY_PARAM_KEY}=${encodeURIComponent(queryValue)}` : "";
      const res = await fetch(`/api/admin/models${suffix}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          models: [
            { id: "oss-prompt-system", name: "OSS Prompt (system)", modelId: ossPromptSystem, enabled: false, priority: 9992 },
            { id: "oss-prompt-model", name: "OSS Prompt (model)", modelId: ossPromptModel, enabled: false, priority: 9993 },
            { id: "oss-prompt-baseurl", name: "OSS Prompt (baseUrl)", modelId: ossPromptBaseUrl, enabled: false, priority: 9994 },
          ],
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setOssPromptMessage(text || `HTTP ${res.status}`);
        return;
      }
      setOssPromptMessage("OSS-prompt 已保存");
      const refreshed = await fetch(`/api/admin/models${suffix}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (refreshed.ok) {
        const dataJson = (await refreshed.json()) as { models?: AdminModelRow[] };
        setAdminModels(Array.isArray(dataJson.models) ? dataJson.models : []);
      }
    } finally {
      setOssPromptSaving(false);
    }
  }, [accessToken, ossPromptBaseUrl, ossPromptModel, ossPromptSystem, searchParams]);

  const [skillModelBindings, setSkillModelBindings] = useState<Record<string, string>>({});
  const [routeDraftBySkillId, setRouteDraftBySkillId] = useState<Record<string, string>>({});
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routesSaving, setRoutesSaving] = useState(false);
  const [routesError, setRoutesError] = useState<string | null>(null);
  const [routesMessage, setRoutesMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;
        if (error) {
          setAuthError(error.message || "获取会话失败");
          setAuthReady(true);
          return;
        }
        const session = data.session;
        if (!session?.access_token || !session.user) {
          setAuthError("未登录或会话已失效");
          setAuthReady(true);
          return;
        }
        const email = (session.user.email ?? "").toLowerCase().trim();
        const provider = (session.user.app_metadata?.provider ?? "").toString().toLowerCase().trim();
        const queryValueRaw = searchParams.get(ADMIN_QUERY_PARAM_KEY) ?? "";
        const queryValue = queryValueRaw.toString().trim();
        if (
          email !== ADMIN_EMAIL.toLowerCase().trim() ||
          provider !== ADMIN_PROVIDER ||
          (ADMIN_QUERY_PARAM_REQUIRED && queryValue !== ADMIN_QUERY_PARAM_SECRET)
        ) {
          router.replace("/");
          return;
        }
        setAccessToken(session.access_token);
        setAuthReady(true);
      } catch (err) {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : "获取会话失败";
        setAuthError(message);
        setAuthReady(true);
      }
    };
    void loadSession();
    return () => {
      mounted = false;
    };
  }, [router, searchParams]);

  useEffect(() => {
    if (!authReady || !accessToken) return;
    let mounted = true;
    const loadSkills = async () => {
      setSkillsLoading(true);
      setSkillsError(null);
      try {
        const res = await fetch("/api/skills", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (!mounted) return;
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `HTTP ${res.status}`);
        }
        const dataJson = (await res.json()) as { skills?: SkillRow[] };
        const list = Array.isArray(dataJson.skills) ? dataJson.skills : [];
        setSkills(list);
        if (!selectedSkillId && list.length > 0) {
          const preferred = list.find((s) => s.id === "search-query") || list.find((s) => s.id === "web-verify") || list[0];
          setSelectedSkillId(preferred.id);
        }
      } catch (err) {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : "加载失败";
        setSkillsError(message);
        setSkills([]);
      } finally {
        if (mounted) setSkillsLoading(false);
      }
    };
    void loadSkills();
    return () => {
      mounted = false;
    };
  }, [authReady, accessToken, selectedSkillId]);

  const loadAdminModels = useCallback(async () => {
    if (!authReady || !accessToken) return;
    setModelsLoading(true);
    setModelsError(null);
    setModelsSaveMessage(null);
    try {
      const res = await fetch(adminModelsUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { models?: AdminModelRow[] };
      const list = Array.isArray(data.models) ? data.models : [];
      const normalized = list.map((row, index) => ({
        id: row.id,
        name: (row.name ?? row.id).toString(),
        modelId: (row.modelId ?? "").toString(),
        priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : index + 1,
        enabled: row.enabled ?? true,
        apiKeyLast4: (row.apiKeyLast4 ?? "").toString(),
        hasApiKey: Boolean(row.hasApiKey),
      }));
      setAdminModels(normalized);
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载失败";
      setModelsError(message);
      setAdminModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, [authReady, accessToken, adminModelsUrl]);

  useEffect(() => {
    void loadAdminModels();
  }, [loadAdminModels]);

  const loadSkillModelRoutes = useCallback(async () => {
    if (!authReady || !accessToken) return;
    setRoutesLoading(true);
    setRoutesError(null);
    setRoutesMessage(null);
    try {
      const res = await fetch(adminSkillModelsUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { bindings?: Array<{ skillId?: string; modelId?: string }> };
      const list = Array.isArray(data.bindings) ? data.bindings : [];
      const map: Record<string, string> = {};
      for (const row of list) {
        const skillId = typeof row?.skillId === "string" ? row.skillId.trim() : "";
        const modelId = typeof row?.modelId === "string" ? row.modelId.trim() : "";
        if (skillId && modelId) map[skillId] = modelId;
      }
      setSkillModelBindings(map);
      setRouteDraftBySkillId((prev) => {
        const next: Record<string, string> = { ...prev };
        for (const [k, v] of Object.entries(map)) next[k] = v;
        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载失败";
      setRoutesError(message);
      setSkillModelBindings({});
    } finally {
      setRoutesLoading(false);
    }
  }, [accessToken, adminSkillModelsUrl, authReady]);

  useEffect(() => {
    void loadSkillModelRoutes();
  }, [loadSkillModelRoutes]);

  const loadPrompts = useCallback(async () => {
    if (!authReady || !accessToken) return;
    setPromptsLoading(true);
    setPromptsError(null);
    try {
      const res = await fetch(adminPromptsUrl, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = safeJsonParse(text) as { prompts?: AdminPromptRow[] } | null;
      const list = Array.isArray(data?.prompts) ? data!.prompts! : [];
      const normalized = list
        .map((p) => ({
          id: (p.id ?? "").toString(),
          hasFile: Boolean(p.hasFile),
          hasCloud: Boolean(p.hasCloud),
          cloudUpdatedAt: typeof p.cloudUpdatedAt === "string" ? p.cloudUpdatedAt : null,
        }))
        .filter((p) => Boolean(p.id));
      setPrompts(normalized);
      if (!selectedPromptId && normalized.length > 0) {
        setSelectedPromptId(normalized[0]!.id);
      }
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载失败";
      setPromptsError(message);
      setPrompts([]);
    } finally {
      setPromptsLoading(false);
    }
  }, [accessToken, adminPromptsUrl, authReady, selectedPromptId]);

  const loadPromptDetail = useCallback(
    async (id: string) => {
      if (!authReady || !accessToken) return;
      const key = (id ?? "").toString().trim();
      if (!key) return;
      setPromptLoading(true);
      setPromptSaveMessage(null);
      try {
        const res = await fetch(adminPromptUrlForId(key), { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
        const text = await res.text().catch(() => "");
        if (!res.ok) {
          throw new Error(text || `HTTP ${res.status}`);
        }
        const data = safeJsonParse(text) as { content?: unknown; hasFile?: unknown } | null;
        const content = data && typeof data.content === "string" ? data.content : "";
        setPromptContent(content);
        setPromptHasFile(Boolean(data && data.hasFile));
        try {
          const db = await getSqliteClient();
          await db.init();
          await db.upsertPrompt({ id: key, content, updated_at: new Date().toISOString() });
        } catch {
          void 0;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "加载失败";
        setPromptContent("");
        setPromptHasFile(false);
        setPromptSaveMessage(message);
        try {
          const db = await getSqliteClient();
          await db.init();
          const local = await db.getPrompt(key);
          if (local?.content) {
            setPromptContent(local.content);
            setPromptSaveMessage("已从本地缓存恢复");
          }
        } catch {
          void 0;
        }
      } finally {
        setPromptLoading(false);
      }
    },
    [accessToken, adminPromptUrlForId, authReady]
  );

  const savePromptDetail = useCallback(async () => {
    if (!authReady || !accessToken) return;
    const id = selectedPromptId.trim();
    if (!id) return;
    setPromptSaving(true);
    setPromptSaveMessage(null);
    try {
      const res = await fetch(adminPromptUrlForId(id), {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ content: promptContent, syncToCloud: promptSyncToCloud, writeToFile: promptWriteToFile }),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }
      setPromptSaveMessage("已保存提示词");
      try {
        const db = await getSqliteClient();
        await db.init();
        await db.upsertPrompt({ id, content: promptContent, updated_at: new Date().toISOString() });
      } catch {
        void 0;
      }
      void loadPrompts();
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败";
      setPromptSaveMessage(message);
    } finally {
      setPromptSaving(false);
    }
  }, [
    accessToken,
    adminPromptUrlForId,
    authReady,
    loadPrompts,
    promptContent,
    promptSyncToCloud,
    promptWriteToFile,
    selectedPromptId,
  ]);

  useEffect(() => {
    if (activeTab !== "prompts") return;
    void loadPrompts();
  }, [activeTab, loadPrompts]);

  useEffect(() => {
    if (activeTab !== "prompts") return;
    if (!selectedPromptId) return;
    void loadPromptDetail(selectedPromptId);
  }, [activeTab, loadPromptDetail, selectedPromptId]);

  const saveSkillRoute = useCallback(
    async (skillId: string, modelId: string) => {
      if (!authReady || !accessToken) return;
      setRoutesSaving(true);
      setRoutesError(null);
      setRoutesMessage(null);
      try {
        const res = await fetch(adminSkillModelsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ skillId, modelId: modelId || null }),
        });
        const text = await res.text().catch(() => "");
        if (!res.ok) {
          const json = safeJsonParse(text) as { error?: unknown } | null;
          const rawError = json && typeof json.error === "string" ? json.error : text || `HTTP ${res.status}`;
          throw new Error(rawError);
        }
        setRoutesMessage("已保存路线配置");
        await loadSkillModelRoutes();
      } catch (err) {
        const message = err instanceof Error ? err.message : "保存失败";
        setRoutesError(message);
      } finally {
        setRoutesSaving(false);
      }
    },
    [accessToken, adminSkillModelsUrl, authReady, loadSkillModelRoutes]
  );

  const saveAllSkillRoutes = useCallback(async () => {
    if (!authReady || !accessToken) return;
    setRoutesSaving(true);
    setRoutesError(null);
    setRoutesMessage(null);
    try {
      const skillIds = skills.map((s) => s.id).filter(Boolean);
      for (const skillId of skillIds) {
        const desired = (routeDraftBySkillId[skillId] ?? "").toString().trim();
        const current = (skillModelBindings[skillId] ?? "").toString().trim();
        if (desired === current) continue;
        const res = await fetch(adminSkillModelsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ skillId, modelId: desired || null }),
        });
        const text = await res.text().catch(() => "");
        if (!res.ok) {
          const json = safeJsonParse(text) as { error?: unknown } | null;
          const rawError = json && typeof json.error === "string" ? json.error : text || `HTTP ${res.status}`;
          throw new Error(rawError);
        }
      }
      setRoutesMessage("已保存全部路线配置");
      await loadSkillModelRoutes();
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败";
      setRoutesError(message);
    } finally {
      setRoutesSaving(false);
    }
  }, [accessToken, adminSkillModelsUrl, authReady, loadSkillModelRoutes, routeDraftBySkillId, skillModelBindings, skills]);

  useEffect(() => {
    if (modelOptions.length === 0) return;
    if (!modelOptions.some((m) => m.id === selectedModelId)) {
      setSelectedModelId(modelOptions[0]!.id);
    }
    if (skillModelId && !modelOptions.some((m) => m.id === skillModelId)) {
      setSkillModelId("");
    }
  }, [modelOptions, selectedModelId, skillModelId]);

  useEffect(() => {
    if (!selectedSkillId || !selectedSkillSample) return;
    const trimmed = skillInputText.trim();
    if (!trimmed || trimmed === "{}") {
      setSkillInputText(selectedSkillSample);
    }
  }, [selectedSkillId, selectedSkillSample, skillInputText]);

  const saveModelPriority = async () => {
    if (!accessToken) {
      setModelsError("未登录，无法保存模型配置");
      return;
    }
    setModelsSaving(true);
    setModelsError(null);
    setModelsSaveMessage(null);
    try {
      const res = await fetch(adminModelsUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          models: adminModels.map((m) => ({
            id: m.id,
            name: m.name,
            modelId: m.modelId,
            priority: Number.isFinite(Number(m.priority)) ? Number(m.priority) : 0,
            enabled: Boolean(m.enabled),
          })),
        }),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        const json = safeJsonParse(text) as { error?: unknown } | null;
        const rawError = json && typeof json.error === "string" ? json.error : text || `HTTP ${res.status}`;
        throw new Error(rawError);
      }
      setModelsSaveMessage("已保存模型优先级");
      void loadAdminModels();
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败";
      setModelsError(message);
    } finally {
      setModelsSaving(false);
    }
  };

  const addNewModel = async () => {
    if (!accessToken) {
      setNewModelMessage("未登录，无法新增模型");
      return;
    }
    const id = newModelId.trim();
    const name = newModelName.trim();
    const modelId = newModelModelId.trim();
    const apiKey = newModelApiKey.trim();
    const priorityValue = newModelPriority.trim();
    if (!id || !modelId || !apiKey) {
      setNewModelMessage("模型 ID、模型标识、API Key 不能为空");
      return;
    }
    setNewModelSaving(true);
    setNewModelMessage(null);
    try {
      const payload: Record<string, unknown> = {
        id,
        name,
        modelId,
        apiKey,
        enabled: newModelEnabled,
      };
      if (priorityValue) {
        const priorityNum = Number(priorityValue);
        if (Number.isFinite(priorityNum)) payload.priority = priorityNum;
      }
      const res = await fetch(adminModelsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        const json = safeJsonParse(text) as { error?: unknown } | null;
        const rawError = json && typeof json.error === "string" ? json.error : text || `HTTP ${res.status}`;
        throw new Error(rawError);
      }
      setNewModelId("");
      setNewModelName("");
      setNewModelModelId("");
      setNewModelApiKey("");
      setNewModelPriority("");
      setNewModelEnabled(true);
      setNewModelMessage("新增模型成功");
      void loadAdminModels();
    } catch (err) {
      const message = err instanceof Error ? err.message : "新增失败";
      setNewModelMessage(message);
    } finally {
      setNewModelSaving(false);
    }
  };

  const runModelTest = async () => {
    if (!accessToken) {
      setModelError("未登录，无法调用后端接口");
      setModelResult(null);
      return;
    }
    const prompt = modelPrompt.trim();
    if (!prompt) {
      setModelError("请输入测试提示词");
      setModelResult(null);
      return;
    }
    setModelTesting(true);
    setModelError(null);
    setModelResult(null);
    try {
      const res = await fetch("/api/chat/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          modelId: selectedModelId,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        const json = safeJsonParse(text) as { error?: unknown } | null;
        const rawError = json && typeof json.error === "string" ? json.error : text || `HTTP ${res.status}`;
        setModelError(rawError);
        setModelResult(null);
        return;
      }
      const data = safeJsonParse(text) as { choices?: Array<{ message?: { content?: string } }> } | null;
      const content =
        data?.choices && data.choices.length > 0
          ? typeof data.choices[0]?.message?.content === "string"
            ? data.choices[0]?.message?.content
            : text
          : text;
      setModelResult(content || "调用成功，但未返回内容");
      setModelError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "调用失败";
      setModelError(message);
      setModelResult(null);
    } finally {
      setModelTesting(false);
    }
  };

  const buildSkillInputFromPlainText = (skillId: string, text: string): unknown | null => {
    const value = text.trim();
    if (!value) return {};
    if (skillId === "search-query") {
      return { query: value, limit: 5 };
    }
    if (skillId === "web-verify") {
      return { urls: [value], question: "请基于网页内容判断该站点是否可访问，并简单总结。" };
    }
    if (skillId === "xhs-batch") {
      return { topic: value, pages: 9, style: "" };
    }
    return null;
  };

  const runSkillTest = async () => {
    if (!accessToken) {
      setSkillError("未登录，无法调用后端接口");
      setSkillResult(null);
      return;
    }
    if (!selectedSkillId) {
      setSkillError("请选择要测试的 Skill");
      setSkillResult(null);
      return;
    }
    let parsedInput: unknown = null;
    const trimmed = skillInputText.trim();
    if (trimmed) {
      const parsed = safeJsonParse(trimmed);
      if (!parsed) {
        const auto = buildSkillInputFromPlainText(selectedSkillId, trimmed);
        if (!auto) {
          setSkillError("输入的 JSON 无法解析，且当前 Skill 不支持纯文本自动转换，请检查格式");
          setSkillResult(null);
          return;
        }
        parsedInput = auto;
      } else {
        parsedInput = parsed;
      }
    } else {
      parsedInput = {};
    }
    setSkillRunning(true);
    setSkillError(null);
    setSkillResult(null);
    try {
      const fixedModelId = (skillModelBindings[selectedSkillId] ?? "").toString().trim();
      const effectiveModelId = fixedModelId || skillModelId || null;
      const res = await fetch("/api/skills/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          id: selectedSkillId,
          modelId: effectiveModelId,
          input: parsedInput,
        }),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        const json = safeJsonParse(text) as { error?: unknown } | null;
        const rawError = json && typeof json.error === "string" ? json.error : text || `HTTP ${res.status}`;
        setSkillError(rawError);
        setSkillResult(null);
        return;
      }
      const data = safeJsonParse(text) as { output?: unknown; modelId?: unknown } | null;
      const usedModelId = data && typeof data.modelId === "string" ? data.modelId : effectiveModelId;
      const outputPretty = data && "output" in data ? JSON.stringify(data.output, null, 2) : text;
      const fullPretty = JSON.stringify({ modelId: usedModelId, output: data?.output ?? null }, null, 2);
      setSkillResult((data && "output" in data ? fullPretty : outputPretty) || "调用成功，但未返回内容");
      setSkillError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "调用失败";
      setSkillError(message);
      setSkillResult(null);
    } finally {
      setSkillRunning(false);
    }
  };

  const fixedSkillModelId = useMemo(() => {
    if (!selectedSkillId) return "";
    return (skillModelBindings[selectedSkillId] ?? "").toString().trim();
  }, [selectedSkillId, skillModelBindings]);

  const skillModelSelectValue = fixedSkillModelId || skillModelId;
  const skillModelSelectDisabled = Boolean(fixedSkillModelId);

  return (
    <div className="h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto flex h-dvh w-full max-w-7xl overflow-hidden">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:flex">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
              <Activity className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">AdminPRC</div>
              <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">运营与模型控制台</div>
            </div>
          </div>

          <nav className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setActiveTab("test")}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                activeTab === "test"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              }`}
            >
              <Activity className="h-4 w-4" />
              <span>测试</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("pricing")}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                activeTab === "pricing"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              }`}
            >
              <Calculator className="h-4 w-4" />
              <span>价格计算器</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("models")}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                activeTab === "models"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              }`}
            >
              <Bot className="h-4 w-4" />
              <span>模型配置</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("routes")}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                activeTab === "routes"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              }`}
            >
              <RouteIcon className="h-4 w-4" />
              <span>路线</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("mode")}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                activeTab === "mode"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              }`}
            >
              <Wrench className="h-4 w-4" />
              <span>Mode Settings</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("oss")}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                activeTab === "oss"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              }`}
            >
              <Wand2 className="h-4 w-4" />
              <span>OSS-prompt</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("prompts")}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                activeTab === "prompts"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              }`}
            >
              <FileText className="h-4 w-4" />
              <span>提示词</span>
            </button>
          </nav>

          <div className="mt-auto pt-4 text-[11px] text-zinc-500 dark:text-zinc-400">
            <div>panel 参数用于保护入口</div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold">
                  {activeTab === "test"
                    ? "测试"
                    : activeTab === "pricing"
                      ? "价格计算器"
                      : activeTab === "models"
                        ? "模型配置"
                        : activeTab === "routes"
                          ? "路线"
                          : activeTab === "mode"
                            ? "Mode Settings"
                            : activeTab === "oss"
                              ? "OSS-prompt"
                              : "提示词"}
                </h1>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {activeTab === "test"
                    ? "快速验证模型与 Skills 是否可用"
                    : activeTab === "pricing"
                      ? "按 tokens 与 Credits 估算成本、收入与利润"
                      : activeTab === "models"
                        ? "管理模型列表、优先级与启用状态"
                      : activeTab === "routes"
                        ? "为固定 Skill 绑定执行模型"
                        : activeTab === "mode"
                          ? "管理 Ask 等模式的默认模型策略"
                          : activeTab === "oss"
                            ? "管理 persona 自动补全使用的 OSS Prompt 配置"
                            : "管理系统提示词文件与云端同步"}
                </p>
              </div>

              <div className="flex items-center gap-2 sm:hidden">
                <button
                  type="button"
                  onClick={() => setActiveTab("test")}
                  className={`rounded-md px-2 py-1 text-xs ${
                    activeTab === "test"
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  测试
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("pricing")}
                  className={`rounded-md px-2 py-1 text-xs ${
                    activeTab === "pricing"
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  价格
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("models")}
                  className={`rounded-md px-2 py-1 text-xs ${
                    activeTab === "models"
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  模型
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("routes")}
                  className={`rounded-md px-2 py-1 text-xs ${
                    activeTab === "routes"
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  路线
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("mode")}
                  className={`rounded-md px-2 py-1 text-xs ${
                    activeTab === "mode"
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  Mode
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("oss")}
                  className={`rounded-md px-2 py-1 text-xs ${
                    activeTab === "oss"
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  OSS
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("prompts")}
                  className={`rounded-md px-2 py-1 text-xs ${
                    activeTab === "prompts"
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  提示词
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
            {!authReady && (
              <div className="flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>正在初始化会话...</span>
              </div>
            )}

            {authReady && authError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                <AlertCircle className="h-4 w-4" />
                <span>{authError}</span>
              </div>
            )}

            {authReady && !authError && activeTab === "test" && (
              <div className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-zinc-500" />
                      <h2 className="text-sm font-semibold">模型可用性检测</h2>
                    </div>
                    <div className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
                      <ChevronDown className="h-3 w-3" />
                      <span>Chat /complete</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">选择模型</label>
                      <div className="relative">
                        <select
                          value={selectedModelId}
                          onChange={(e) => setSelectedModelId(e.target.value)}
                          className="w-full appearance-none rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-xs text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-200"
                        >
                          {modelOptions.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-zinc-400">
                          <ChevronDown className="h-3 w-3" />
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">测试提示词</label>
                      <textarea
                        value={modelPrompt}
                        onChange={(e) => setModelPrompt(e.target.value)}
                        rows={4}
                        className="w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-200"
                        placeholder="输入一段话，用来测试模型是否可以在当前地区正常返回内容。"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setModelPrompt("测试一下当前模型是否可用，请说明你是什么模型，并用一句话介绍自己。")
                        }
                        className="text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
                      >
                        使用推荐测试语句
                      </button>
                      <button
                        type="button"
                        onClick={() => void runModelTest()}
                        disabled={modelTesting || !authReady || !accessToken}
                        className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                      >
                        {modelTesting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        <span>开始测试</span>
                      </button>
                    </div>

                    {modelError && (
                      <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
                        <div className="mb-1 flex items-center gap-1.5 font-medium">
                          <AlertCircle className="h-3.5 w-3.5" />
                          <span>模型调用失败</span>
                        </div>
                        <div className="whitespace-pre-wrap break-words">{modelError}</div>
                      </div>
                    )}

                    {modelResult && !modelError && (
                      <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100">
                        <div className="mb-1 flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>模型调用成功</span>
                        </div>
                        <div className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed">
                          {modelResult}
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Search className="h-4 w-4 text-zinc-500" />
                      <h2 className="text-sm font-semibold">Skill 搜索与调用测试</h2>
                    </div>
                    <div className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
                      <ChevronDown className="h-3 w-3" />
                      <span>Skills /run</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">选择 Skill</label>
                      <div className="relative">
                        <select
                          value={selectedSkillId}
                          onChange={(e) => setSelectedSkillId(e.target.value)}
                          disabled={skillsLoading || skills.length === 0}
                          className="w-full appearance-none rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-xs text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-200 dark:disabled:bg-zinc-900 dark:disabled:text-zinc-600"
                        >
                          <option value="" disabled>
                            {skillsLoading ? "加载中..." : "请选择要测试的 Skill"}
                          </option>
                          {skills.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.id})
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-zinc-400">
                          <ChevronDown className="h-3 w-3" />
                        </span>
                      </div>
                      {selectedSkill && (
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          {selectedSkill.description} · {selectedSkill.visibility} ·
                          {selectedSkill.configured ? " 已配置" : " 未配置"}
                        </p>
                      )}
                      {fixedSkillModelId && (
                        <div className="text-[11px] text-zinc-600 dark:text-zinc-300">
                          该 Skill 已固定路线：{fixedSkillModelId}
                        </div>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Skill 输入 JSON</label>
                        <textarea
                          value={skillInputText}
                          onChange={(e) => setSkillInputText(e.target.value)}
                          rows={8}
                          className="w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-mono text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-200"
                          placeholder='例如："web-verify" 用 {"urls":["https://example.com"],"question":"..."}；"search-query" 用 {"query":"AI 工具","limit":5}'
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Skill 使用的模型</label>
                          <div className="relative">
                            <select
                              value={skillModelSelectValue}
                              onChange={(e) => setSkillModelId(e.target.value)}
                              disabled={skillModelSelectDisabled}
                              className="w-full appearance-none rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-xs text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-200 dark:disabled:bg-zinc-900 dark:disabled:text-zinc-600"
                            >
                              {!fixedSkillModelId && <option value="">使用默认模型</option>}
                              {modelOptions.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-zinc-400">
                              <ChevronDown className="h-3 w-3" />
                            </span>
                          </div>
                          {skillModelSelectDisabled && (
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              已固定路线，修改请到「路线」页
                            </div>
                          )}
                        </div>
                        {selectedSkillSample && (
                          <button
                            type="button"
                            onClick={() => setSkillInputText(selectedSkillSample)}
                            className="text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
                          >
                            为当前 Skill 填充示例输入
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void runSkillTest()}
                          disabled={skillRunning || !authReady || !accessToken || !selectedSkillId}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                        >
                          {skillRunning ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Search className="h-3.5 w-3.5" />
                          )}
                          <span>运行 Skill 测试</span>
                        </button>
                      </div>
                    </div>

                    {skillsError && (
                      <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                        <div className="mb-1 flex items-center gap-1.5 font-medium">
                          <AlertCircle className="h-3.5 w-3.5" />
                          <span>Skill 列表加载失败</span>
                        </div>
                        <div className="whitespace-pre-wrap break-words">{skillsError}</div>
                      </div>
                    )}

                    {skillError && (
                      <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
                        <div className="mb-1 flex items-center gap-1.5 font-medium">
                          <AlertCircle className="h-3.5 w-3.5" />
                          <span>Skill 调用失败</span>
                        </div>
                        <div className="whitespace-pre-wrap break-words">{skillError}</div>
                      </div>
                    )}

                    {skillResult && !skillError && (
                      <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100">
                        <div className="mb-1 flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Skill 调用成功</span>
                        </div>
                        <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed">
                          {skillResult}
                        </pre>
                      </div>
                    )}
                  </div>
                </section>

              </div>
            )}

            {authReady && !authError && activeTab === "mode" && (
              <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-zinc-500" />
                    <h2 className="text-sm font-semibold">Ask 模式默认模型</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadAdminModels()}
                    disabled={modelsLoading || askDefaultsSaving}
                    className="text-xs text-zinc-500 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-400"
                  >
                    刷新
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Global 默认模型</label>
                      <div className="relative">
                        <select
                          value={askDefaultId}
                          onChange={(e) => setAskDefaultId(e.target.value)}
                          className="w-full appearance-none rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-xs text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-200"
                        >
                          {MODEL_OPTIONS.filter((m) => m.id !== "nanobanana").map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-zinc-400">
                          <ChevronDown className="h-3 w-3" />
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">中国 IP 默认模型</label>
                      <div className="relative">
                        <select
                          value={askDefaultCnId}
                          onChange={(e) => setAskDefaultCnId(e.target.value)}
                          className="w-full appearance-none rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-xs text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-200"
                        >
                          {MODEL_OPTIONS.filter((m) => m.id !== "nanobanana").map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-zinc-400">
                          <ChevronDown className="h-3 w-3" />
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Global Fallback #1</label>
                      <div className="relative">
                        <select
                          value={askFallback1Id}
                          onChange={(e) => setAskFallback1Id(e.target.value)}
                          className="w-full appearance-none rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-xs text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-200"
                        >
                          <option value="">未设置</option>
                          {MODEL_OPTIONS.filter((m) => m.id !== "nanobanana").map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-zinc-400">
                          <ChevronDown className="h-3 w-3" />
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Global Fallback #2</label>
                      <div className="relative">
                        <select
                          value={askFallback2Id}
                          onChange={(e) => setAskFallback2Id(e.target.value)}
                          className="w-full appearance-none rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-xs text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-200"
                        >
                          <option value="">未设置</option>
                          {MODEL_OPTIONS.filter((m) => m.id !== "nanobanana").map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-zinc-400">
                          <ChevronDown className="h-3 w-3" />
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">中国 IP Fallback #1</label>
                      <div className="relative">
                        <select
                          value={askFallbackCn1Id}
                          onChange={(e) => setAskFallbackCn1Id(e.target.value)}
                          className="w-full appearance-none rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-xs text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-200"
                        >
                          <option value="">未设置</option>
                          {MODEL_OPTIONS.filter((m) => m.id !== "nanobanana").map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-zinc-400">
                          <ChevronDown className="h-3 w-3" />
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">中国 IP Fallback #2</label>
                      <div className="relative">
                        <select
                          value={askFallbackCn2Id}
                          onChange={(e) => setAskFallbackCn2Id(e.target.value)}
                          className="w-full appearance-none rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-xs text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-200"
                        >
                          <option value="">未设置</option>
                          {MODEL_OPTIONS.filter((m) => m.id !== "nanobanana").map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-zinc-400">
                          <ChevronDown className="h-3 w-3" />
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Ask 模式会根据访问来源自动选择 Global / 中国 IP 默认模型，用户无法手动更改。
                  </p>
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => void saveAskDefaults()}
                      disabled={askDefaultsSaving || !authReady || !accessToken}
                      className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      {askDefaultsSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      <span>保存</span>
                    </button>
                  </div>
                  {askDefaultsMessage && (
                    <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100">
                      {askDefaultsMessage}
                    </div>
                  )}
                </div>
              </section>
            )}

            {authReady && !authError && activeTab === "oss" && (
              <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Wand2 className="h-4 w-4 text-zinc-500" />
                    <h2 className="text-sm font-semibold">OSS-prompt</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadAdminModels()}
                    disabled={modelsLoading || ossPromptSaving}
                    className="text-xs text-zinc-500 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-400"
                  >
                    刷新
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Model</label>
                      <input
                        value={ossPromptModel}
                        onChange={(e) => setOssPromptModel(e.target.value)}
                        placeholder="例如 openai/gpt-oss-20b"
                        className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Base URL</label>
                      <input
                        value={ossPromptBaseUrl}
                        onChange={(e) => setOssPromptBaseUrl(e.target.value)}
                        placeholder="例如 https://openrouter.ai/api/v1/chat/completions"
                        className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">System Prompt</label>
                    <textarea
                      value={ossPromptSystem}
                      onChange={(e) => setOssPromptSystem(e.target.value)}
                      rows={6}
                      placeholder="用于 persona 创建页的 inline autocomplete（system 消息）"
                      className="w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-200"
                    />
                  </div>
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => void saveOssPrompt()}
                      disabled={ossPromptSaving || !authReady || !accessToken}
                      className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      {ossPromptSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      <span>保存</span>
                    </button>
                  </div>
                  {ossPromptMessage && (
                    <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100">
                      {ossPromptMessage}
                    </div>
                  )}
                </div>
              </section>
            )}

            {authReady && !authError && activeTab === "prompts" && (
              <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-zinc-500" />
                    <h2 className="text-sm font-semibold">提示词管理</h2>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void loadPrompts()}
                      disabled={promptsLoading || promptSaving}
                      className="text-xs text-zinc-500 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-400"
                    >
                      刷新
                    </button>
                  </div>
                </div>

                {promptsError && (
                  <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-200">
                    {promptsError}
                  </div>
                )}

                <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                      <input
                        value={promptQuery}
                        onChange={(e) => setPromptQuery(e.target.value)}
                        placeholder="搜索提示词文件名…"
                        className="w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-3 text-xs text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200"
                      />
                    </div>

                    <div className="max-h-[60vh] overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                      {promptsLoading ? (
                        <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>正在加载…</span>
                        </div>
                      ) : filteredPrompts.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">没有匹配的提示词</div>
                      ) : (
                        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                          {filteredPrompts.map((p) => {
                            const active = p.id === selectedPromptId;
                            const tags = PROMPT_TAGS[p.id] ?? [];
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => setSelectedPromptId(p.id)}
                                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs ${
                                  active
                                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                                    : "bg-white text-zinc-900 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
                                }`}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate">{p.id}</span>
                                  {tags.length > 0 ? (
                                    <span className="mt-1 flex flex-wrap gap-1">
                                      {tags.map((t) => (
                                        <span
                                          key={`${p.id}:${t}`}
                                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                                            active
                                              ? "bg-white/15 text-white/90 dark:bg-zinc-900/10 dark:text-zinc-800"
                                              : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                                          }`}
                                        >
                                          {t}
                                        </span>
                                      ))}
                                    </span>
                                  ) : null}
                                </span>
                                <span className={`shrink-0 text-[10px] ${active ? "text-white/80 dark:text-zinc-700" : "text-zinc-500 dark:text-zinc-400"}`}>
                                  {(p.hasFile ? "F" : "-") + (p.hasCloud ? "C" : "-")}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      F=本地文件，C=云端（Supabase prompt_templates）
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        当前：{selectedPromptId || "未选择"}
                        {promptHasFile ? "（有本地文件）" : ""}
                        {selectedPromptTags.length > 0 ? (
                          <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                            {selectedPromptTags.map((t) => (
                              <span key={`current:${t}`} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                                {t}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                          <input
                            type="checkbox"
                            checked={promptWriteToFile}
                            onChange={(e) => setPromptWriteToFile(e.target.checked)}
                            className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-200"
                          />
                          <span>写入本地文件</span>
                        </label>
                        <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                          <input
                            type="checkbox"
                            checked={promptSyncToCloud}
                            onChange={(e) => setPromptSyncToCloud(e.target.checked)}
                            className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-200"
                          />
                          <span>同步到云端</span>
                        </label>
                      </div>
                    </div>

                    <textarea
                      value={promptContent}
                      onChange={(e) => setPromptContent(e.target.value)}
                      rows={18}
                      disabled={promptLoading || !selectedPromptId}
                      className="w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-200"
                    />

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => selectedPromptId && void loadPromptDetail(selectedPromptId)}
                        disabled={promptLoading || promptSaving || !selectedPromptId}
                        className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
                      >
                        {promptLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        <span>重新加载</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void savePromptDetail()}
                        disabled={promptSaving || promptLoading || !selectedPromptId}
                        className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                      >
                        {promptSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        <span>保存</span>
                      </button>
                    </div>

                    {promptSaveMessage && (
                      <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100">
                        {promptSaveMessage}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {authReady && !authError && activeTab === "pricing" && (
              <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-zinc-500" />
                    <h2 className="text-sm font-semibold">价格计算器</h2>
                  </div>
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400">按 1000 tokens 计价</div>
                </div>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">模型类别</label>
                      <div className="relative">
                        <select
                          value={calcModelId}
                          onChange={(e) => setCalcModelId(e.target.value as PriceCalculatorModelId)}
                          className="w-full appearance-none rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-xs text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-200"
                        >
                          {PRICE_CALCULATOR_MODELS.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-zinc-400">
                          <ChevronDown className="h-3 w-3" />
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        消耗 {priceCalculatorModelMeta.creditsPerK} Credits / 1000 tokens
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">本次 tokens</label>
                        <input
                          value={calcTokens}
                          onChange={(e) => setCalcTokens(e.target.value)}
                          placeholder="如 1000"
                          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          上游成本（$ / 1000 tokens）
                        </label>
                        <input
                          value={calcUpstreamCostPerK}
                          onChange={(e) => setCalcUpstreamCostPerK(e.target.value)}
                          placeholder="如 3.00"
                          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200"
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">售卖价格（$ / Credit）</label>
                        <input
                          value={calcPricePerCredit}
                          onChange={(e) => setCalcPricePerCredit(e.target.value)}
                          placeholder="如 0.10"
                          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="flex items-center justify-between">
                          <span>本次消耗 Credits</span>
                          <span className="font-mono">{priceCalculatorValues.credits.toFixed(4)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>上游成本（$）</span>
                          <span className="font-mono">{priceCalculatorValues.upstreamCost.toFixed(4)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>收入（$）</span>
                          <span className="font-mono">{priceCalculatorValues.revenue.toFixed(4)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>利润（$）</span>
                          <span className="font-mono">{priceCalculatorValues.profit.toFixed(4)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="flex items-center justify-between">
                          <span>收入（$ / 1000 tokens）</span>
                          <span className="font-mono">{priceCalculatorValues.revenuePerK.toFixed(4)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>利润（$ / 1000 tokens）</span>
                          <span className="font-mono">{priceCalculatorValues.profitPerK.toFixed(4)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {authReady && !authError && activeTab === "models" && (
              <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-zinc-500" />
                    <h2 className="text-sm font-semibold">模型配置管理</h2>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                    <span>优先级越小越靠前</span>
                  </div>
                </div>

                {modelsError && (
                  <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
                    {modelsError}
                  </div>
                )}

                {modelsSaveMessage && !modelsError && (
                  <div className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                    {modelsSaveMessage}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="hidden text-[11px] text-zinc-500 sm:grid sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,0.6fr)_minmax(0,0.5fr)_minmax(0,0.6fr)] sm:gap-2">
                    <div>模型 ID</div>
                    <div>名称</div>
                    <div>模型标识</div>
                    <div>优先级</div>
                    <div>启用</div>
                    <div>API Key</div>
                  </div>

                  {modelsLoading && (
                    <div className="flex items-center gap-2 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-300">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>加载模型配置...</span>
                    </div>
                  )}

                  {!modelsLoading && adminModels.length === 0 && (
                    <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-300">
                      暂无模型配置
                    </div>
                  )}

                  {adminModels.map((model) => (
                    <div
                      key={model.id}
                      className="grid items-center gap-2 rounded-md border border-zinc-100 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:text-zinc-200 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,0.6fr)_minmax(0,0.5fr)_minmax(0,0.6fr)]"
                    >
                      <div className="truncate">{model.id}</div>
                      <input
                        value={model.name}
                        onChange={(e) =>
                          setAdminModels((prev) =>
                            prev.map((m) => (m.id === model.id ? { ...m, name: e.target.value } : m))
                          )
                        }
                        className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-200"
                      />
                      <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{model.modelId}</div>
                      <input
                        type="number"
                        value={Number.isFinite(Number(model.priority)) ? Number(model.priority) : ""}
                        onChange={(e) =>
                          setAdminModels((prev) =>
                            prev.map((m) => (m.id === model.id ? { ...m, priority: Number(e.target.value) } : m))
                          )
                        }
                        className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-200"
                      />
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(model.enabled)}
                          onChange={(e) =>
                            setAdminModels((prev) =>
                              prev.map((m) => (m.id === model.id ? { ...m, enabled: e.target.checked } : m))
                            )
                          }
                          className="h-3.5 w-3.5 rounded border border-zinc-300"
                        />
                        <span className="text-[11px] text-zinc-500">{model.enabled ? "启用" : "关闭"}</span>
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {model.hasApiKey ? `****${model.apiKeyLast4}` : "未设置"}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => void loadAdminModels()}
                    disabled={modelsLoading}
                    className="text-xs text-zinc-500 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-400"
                  >
                    刷新模型列表
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveModelPriority()}
                    disabled={modelsSaving || modelsLoading || adminModels.length === 0}
                    className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    {modelsSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    <span>保存优先级</span>
                  </button>
                </div>

                <div className="mt-6 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                  <h3 className="mb-3 text-xs font-semibold text-zinc-700 dark:text-zinc-200">新增模型</h3>
                  {newModelMessage && (
                    <div className="mb-3 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900/60 dark:text-zinc-200">
                      {newModelMessage}
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">模型 ID</label>
                      <input
                        value={newModelId}
                        onChange={(e) => setNewModelId(e.target.value)}
                        placeholder="如 kimi-0905"
                        className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">名称</label>
                      <input
                        value={newModelName}
                        onChange={(e) => setNewModelName(e.target.value)}
                        placeholder="可选"
                        className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">模型标识</label>
                      <input
                        value={newModelModelId}
                        onChange={(e) => setNewModelModelId(e.target.value)}
                        placeholder="如 google/gemini-3-pro-preview"
                        className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">API Key</label>
                      <input
                        value={newModelApiKey}
                        onChange={(e) => setNewModelApiKey(e.target.value)}
                        placeholder="以 sk- 或 api- 开头"
                        className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">优先级</label>
                      <input
                        value={newModelPriority}
                        onChange={(e) => setNewModelPriority(e.target.value)}
                        placeholder="可选，数字越小越靠前"
                        className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200"
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-5 text-xs text-zinc-600 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={newModelEnabled}
                        onChange={(e) => setNewModelEnabled(e.target.checked)}
                        className="h-4 w-4 rounded border border-zinc-300"
                      />
                      <span>启用该模型</span>
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void addNewModel()}
                      disabled={newModelSaving}
                      className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      {newModelSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      <span>新增模型</span>
                    </button>
                  </div>
                </div>
              </section>
            )}

            {authReady && !authError && activeTab === "routes" && (
              <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <RouteIcon className="h-4 w-4 text-zinc-500" />
                    <h2 className="text-sm font-semibold">Skill 路线（固定模型）</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void loadSkillModelRoutes()}
                      disabled={routesLoading || routesSaving}
                      className="text-xs text-zinc-500 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-400"
                    >
                      刷新
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveAllSkillRoutes()}
                      disabled={routesLoading || routesSaving || skills.length === 0}
                      className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      {routesSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      <span>保存全部</span>
                    </button>
                  </div>
                </div>

                {routesError && (
                  <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
                    {routesError}
                  </div>
                )}

                {routesMessage && !routesError && (
                  <div className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                    {routesMessage}
                  </div>
                )}

                {skillsLoading && (
                  <div className="flex items-center gap-2 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>加载 Skill 列表...</span>
                  </div>
                )}

                {!skillsLoading && skills.length === 0 && (
                  <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-300">
                    暂无 Skill
                  </div>
                )}

                {skills.length > 0 && (
                  <div className="space-y-2">
                    <div className="hidden text-[11px] text-zinc-500 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.6fr)] sm:gap-2">
                      <div>Skill</div>
                      <div>说明</div>
                      <div>固定模型</div>
                      <div></div>
                    </div>
                    {skills.map((s) => {
                      const current = (skillModelBindings[s.id] ?? "").toString().trim();
                      const draft = (routeDraftBySkillId[s.id] ?? current).toString();
                      return (
                        <div
                          key={s.id}
                          className="grid items-center gap-2 rounded-md border border-zinc-100 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:text-zinc-200 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.6fr)]"
                        >
                          <div className="truncate">
                            {s.name} ({s.id})
                          </div>
                          <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{s.description}</div>
                          <div className="relative">
                            <select
                              value={draft}
                              onChange={(e) =>
                                setRouteDraftBySkillId((prev) => ({ ...prev, [s.id]: e.target.value }))
                              }
                              disabled={routesSaving}
                              className="w-full appearance-none rounded border border-zinc-200 bg-white px-2 py-1 pr-7 text-[11px] text-zinc-700 outline-none focus:border-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-200 dark:disabled:bg-zinc-900 dark:disabled:text-zinc-600"
                            >
                              <option value="">不固定（按请求选择/默认）</option>
                              {modelOptions.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-zinc-400">
                              <ChevronDown className="h-3 w-3" />
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => void saveSkillRoute(s.id, draft)}
                            disabled={routesSaving || routesLoading || draft.trim() === current}
                            className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                          >
                            保存
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
