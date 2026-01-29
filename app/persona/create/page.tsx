"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, RefreshCw, Wand2, ArrowLeftCircle, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { invokeEdgeFunction, isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

// Types
type Step = 1 | 2 | 3;
type IpField = "name" | "description" | "purpose";
type IpFormData = { name: string; description: string; purpose: string };
type IpSetupMode = "existing" | "new";
type IpSourcePlatform = "twitter" | "wechat";

type OssPromptConfig = {
  system: string;
  model: string;
  baseUrl: string;
};

let cachedOssPromptConfigPromise: Promise<OssPromptConfig | null> | null = null;
async function loadOssPromptConfig(): Promise<OssPromptConfig | null> {
  if (cachedOssPromptConfigPromise) return cachedOssPromptConfigPromise;
  cachedOssPromptConfigPromise = (async () => {
    try {
      const res = await fetch("/api/models", { method: "GET" });
      if (!res.ok) return null;
      const json = (await res.json()) as { oss_prompt?: Partial<OssPromptConfig> } | null;
      const raw = json?.oss_prompt ?? null;
      if (!raw) return null;
      const system = (raw.system ?? "").toString();
      const model = (raw.model ?? "").toString().trim();
      const baseUrl = (raw.baseUrl ?? "").toString().trim();
      if (!system && !model && !baseUrl) return null;
      return { system, model, baseUrl };
    } catch {
      return null;
    }
  })();
  return cachedOssPromptConfigPromise;
}

async function fetchGptOssSuggestion(args: { field: IpField; text: string; context: IpFormData }) {
  const cfg = await loadOssPromptConfig();
  const baseUrl =
    cfg?.baseUrl ||
    process.env.NEXT_PUBLIC_GPT_OSS_CHAT_COMPLETIONS_URL ||
    process.env.NEXT_PUBLIC_OPENROUTER_BASE_URL ||
    "https://openrouter.ai/api/v1/chat/completions";

  const model = cfg?.model || process.env.NEXT_PUBLIC_GPT_OSS_MODEL || "openai/gpt-oss-20b";
  const apiKey = process.env.NEXT_PUBLIC_GPT_OSS_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY || "";

  const needsKey = baseUrl.includes("openrouter.ai");
  if (needsKey && !apiKey) {
    return { suggestion: "", status: "disabled" as const, reason: "missing NEXT_PUBLIC_OPENROUTER_API_KEY" };
  }

  const system =
    cfg?.system ||
    [
      "You are an inline autocomplete engine for a form.",
      "Return ONLY a short continuation that can be appended to the user's current text.",
      "Do NOT repeat the existing text. Do NOT add quotes. Do NOT add markdown.",
      "Keep it concise (max 60 characters). If no good continuation, return an empty string.",
    ].join("\n");

  const user = JSON.stringify({
    field: args.field,
    current_text: args.text,
    context: args.context,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (needsKey) {
    headers["HTTP-Referer"] = "https://aipersona.web";
    headers["X-Title"] = "AIPersona";
  }

  const response = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 80,
      stream: false,
    }),
  });

  if (!response.ok) {
    return { suggestion: "", status: "error" as const, reason: `http ${response.status}` };
  }

  const result = await response.json();
  const content = (result?.choices?.[0]?.message?.content ?? "").toString();
  const suggestion = content.replace(/\s+$/g, "").slice(0, 120);
  return { suggestion, status: suggestion ? ("ok" as const) : ("idle" as const) };
}

function extractJsonObjectFromText(text: string): Record<string, unknown> | null {
  const raw = (text ?? "").toString();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  const slice = raw.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchGptOssIpAutofill(args: {
  platform: IpSourcePlatform;
  account: string;
  searchResults: Array<{ title?: string; url?: string; snippet?: string }>;
}) {
  const cfg = await loadOssPromptConfig();
  const baseUrl =
    cfg?.baseUrl ||
    process.env.NEXT_PUBLIC_GPT_OSS_CHAT_COMPLETIONS_URL ||
    process.env.NEXT_PUBLIC_OPENROUTER_BASE_URL ||
    "https://openrouter.ai/api/v1/chat/completions";

  const model = cfg?.model || process.env.NEXT_PUBLIC_GPT_OSS_MODEL || "openai/gpt-oss-20b";
  const apiKey = process.env.NEXT_PUBLIC_GPT_OSS_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY || "";

  const needsKey = baseUrl.includes("openrouter.ai");
  if (needsKey && !apiKey) {
    return { data: null as IpFormData | null, status: "disabled" as const, reason: "missing NEXT_PUBLIC_OPENROUTER_API_KEY" };
  }

  const system =
    cfg?.system ||
    [
      "You help fill out a 'personal brand / IP' form from public info.",
      "Use the provided platform/account hint and web search results.",
      "Return ONLY valid JSON with keys: name, description, purpose.",
      "Keep description and purpose concise (1-2 sentences each).",
      "If uncertain, make a best-effort guess rather than leaving empty.",
    ].join("\n");

  const user = JSON.stringify({
    platform: args.platform,
    account: args.account,
    search_results: (args.searchResults ?? []).slice(0, 6).map((r) => ({
      title: (r.title ?? "").toString().trim(),
      url: (r.url ?? "").toString().trim(),
      snippet: (r.snippet ?? "").toString().trim(),
    })),
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (needsKey) {
    headers["HTTP-Referer"] = "https://aipersona.web";
    headers["X-Title"] = "AIPersona";
  }

  const response = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 300,
      stream: false,
    }),
  });

  if (!response.ok) {
    return { data: null as IpFormData | null, status: "error" as const, reason: `http ${response.status}` };
  }

  const result = await response.json();
  const content = (result?.choices?.[0]?.message?.content ?? "").toString();
  const obj = extractJsonObjectFromText(content);
  if (!obj) return { data: null as IpFormData | null, status: "error" as const, reason: "invalid json" };

  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  const description = typeof obj.description === "string" ? obj.description.trim() : "";
  const purpose = typeof obj.purpose === "string" ? obj.purpose.trim() : "";

  return { data: { name, description, purpose }, status: "ok" as const };
}

export default function CreatePersonaPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAvatars, setGeneratedAvatars] = useState<string[]>([]);
  const [creationStatus, setCreationStatus] = useState<'idle' | 'creating' | 'success'>('idle');
  const [createdPersonaId, setCreatedPersonaId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Form State
  const [formData, setFormData] = useState({
    name: "",
    gender: "",
    age: "25",
    language: "",
    skinColor: "",
    hairColor: "",
    eyeColor: "",
    hairStyle: "",
    hairAccessories: "",
    glasses: "",
    description: "",
    purpose: "",
    targetAudience: "",
  });

  const [creationType, setCreationType] = useState<"ai" | "ip" | null>(null);
  const [ipFormData, setIpFormData] = useState<IpFormData>({
    name: "",
    description: "",
    purpose: "",
  });
  const [ipSetupMode, setIpSetupMode] = useState<IpSetupMode | null>(null);
  const [ipSourcePlatform, setIpSourcePlatform] = useState<IpSourcePlatform>("twitter");
  const [ipSourceAccount, setIpSourceAccount] = useState("");
  const [ipRetrieveUi, setIpRetrieveUi] = useState<{ status: "idle" | "loading" | "ok" | "disabled" | "error"; message?: string }>({
    status: "idle",
  });

  const [ipFocusedField, setIpFocusedField] = useState<IpField | null>(null);
  const [ipSuggestion, setIpSuggestion] = useState({
    name: "",
    description: "",
    purpose: "",
  });
  const ipSuggestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ipSuggestReqIdRef = useRef(0);
  const [ipSuggestUi, setIpSuggestUi] = useState<{ status: "idle" | "loading" | "ok" | "disabled" | "error"; reason?: string }>({
    status: "idle",
  });

  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);

  const getReadableErrorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const maybeMessage = (error as { message?: unknown }).message;
      const maybeDetails = (error as { details?: unknown }).details;
      const maybeHint = (error as { hint?: unknown }).hint;
      const maybeCode = (error as { code?: unknown }).code;
      const message = typeof maybeMessage === "string" ? maybeMessage : "";
      const details = typeof maybeDetails === "string" ? maybeDetails : "";
      const hint = typeof maybeHint === "string" ? maybeHint : "";
      const code = typeof maybeCode === "string" ? maybeCode : "";
      const suffix = [code ? `code: ${code}` : "", details || hint ? [details, hint].filter(Boolean).join(" - ") : ""]
        .filter(Boolean)
        .join(" | ");
      if (message && suffix) return `${message} (${suffix})`;
      if (message) return message;
      if (suffix) return suffix;
    }
    return "Failed. Please try again.";
  };

  const handleGenerateAvatars = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      alert("Please log in to generate avatars.");
      return;
    }

    setIsGenerating(true);
    setGeneratedAvatars([]); // Clear previous
    setSelectedAvatar(null);

    try {
      // Construct prompt from form data
      const prompt = `A realistic portrait of a ${formData.age} year old ${formData.gender}, ${formData.skinColor} skin, ${formData.hairColor} hair, ${formData.eyeColor ? formData.eyeColor + " eyes, " : ""}${formData.hairStyle ? formData.hairStyle + " hair style, " : ""}${formData.hairAccessories ? "wearing " + formData.hairAccessories + ", " : ""}${formData.glasses ? "wearing " + formData.glasses + " glasses, " : ""}looking at camera, high quality, photorealistic.`;
      
      const { data, error } = await invokeEdgeFunction<{ images?: string[] }>('generate-avatar', {
        body: { prompt, n: 3 },
      });

      if (error) throw error;
      
      if (data?.images && data.images.length > 0) {
        setGeneratedAvatars(data.images);
      } else {
        console.warn("No images returned from API");
        // Fallback for demo if API fails or returns nothing (remove in prod)
        // setGeneratedAvatars(["/avatars/avatar-1.jpg", "/avatars/avatar-2.jpg", "/avatars/avatar-3.jpg"]);
      }
    } catch (error) {
      console.error("Failed to generate avatars:", error);
      alert("Failed to generate avatars. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleBack = () => {
    if (step > 1) setStep((prev) => (prev - 1) as Step);
    else router.back();
  };

  const handleNext = async () => {
    if (step === 1) {
        // Trigger generation when moving to step 2
        await handleGenerateAvatars();
        setStep(2);
    } else if (step < 3) {
        setStep((prev) => (prev + 1) as Step);
    }
  };

  useEffect(() => {
    if (creationStatus === 'creating') {
      setProgress(0);
      const interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 95) return prev; // Hold at 95 until success
          return prev + Math.floor(Math.random() * 5) + 1;
        });
      }, 500);
      return () => clearInterval(interval);
    } else if (creationStatus === 'success') {
      setProgress(100);
    }
  }, [creationStatus]);

  useEffect(() => {
    if (creationType === "ip") return;
    setIpSetupMode(null);
    setIpSourcePlatform("twitter");
    setIpSourceAccount("");
    setIpRetrieveUi({ status: "idle" });
  }, [creationType]);

  useEffect(() => {
    if (creationType !== "ip") return;
    if (!ipFocusedField) return;

    const value = ipFormData[ipFocusedField];
    setIpSuggestion((prev) => ({ ...prev, [ipFocusedField]: "" }));
    setIpSuggestUi({ status: "idle" });

    if (!value || value.trim().length < 3) return;

    if (ipSuggestTimeoutRef.current) clearTimeout(ipSuggestTimeoutRef.current);
    ipSuggestTimeoutRef.current = setTimeout(async () => {
      const currentField = ipFocusedField;
      const currentValue = ipFormData[currentField];
      const reqId = ++ipSuggestReqIdRef.current;
      setIpSuggestUi({ status: "loading" });
      let data: { suggestion?: string; status?: string; reason?: string } | null = null;
      let error: unknown = null;
      try {
        data = await fetchGptOssSuggestion({ field: currentField, text: currentValue, context: ipFormData });
      } catch (e) {
        error = e;
      }
      if (reqId !== ipSuggestReqIdRef.current) return;

      if (error) {
        setIpSuggestUi({ status: "error", reason: getReadableErrorMessage(error) });
        return;
      }

      const statusRaw = (data?.status ?? "idle").toString();
      const reasonRaw = (data?.reason ?? "").toString() || undefined;
      const status: "idle" | "ok" | "disabled" | "error" =
        statusRaw === "ok" || statusRaw === "disabled" || statusRaw === "error" ? statusRaw : "idle";

      const suggestion = (data?.suggestion ?? "").toString();
      setIpSuggestUi({ status: status === "ok" && !suggestion ? "idle" : status, reason: reasonRaw });
      if (!suggestion) return;
      setIpSuggestion((prev) => ({ ...prev, [currentField]: suggestion }));
    }, 450);

    return () => {
      if (ipSuggestTimeoutRef.current) clearTimeout(ipSuggestTimeoutRef.current);
    };
  }, [creationType, ipFocusedField, ipFormData]);

  const acceptIpSuggestion = (field: IpField) => {
    const suggestion = ipSuggestion[field];
    if (!suggestion) return;
    const current = ipFormData[field];
    const next =
      current && !current.endsWith(" ") && suggestion && !suggestion.startsWith(" ")
        ? `${current} ${suggestion}`
        : `${current}${suggestion}`;
    setIpFormData((prev) => ({ ...prev, [field]: next }));
    setIpSuggestion((prev) => ({ ...prev, [field]: "" }));
  };

  const handleRetrieveIpFromAccount = async () => {
    const account = ipSourceAccount.trim();
    if (!account) {
      setIpRetrieveUi({ status: "error", message: "Please enter your account." });
      return;
    }

    if (!isSupabaseConfigured) {
      setIpRetrieveUi({ status: "error", message: "Supabase not configured." });
      return;
    }

    setIpRetrieveUi({ status: "loading" });
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token ?? null;
      if (!token) {
        setIpRetrieveUi({ status: "error", message: "Please log in first." });
        return;
      }

      const normalized = account.replace(/^@+/, "").trim();
      const query =
        ipSourcePlatform === "twitter"
          ? normalized.includes("twitter.com")
            ? `X (Twitter) profile ${normalized}`
            : `site:twitter.com ${normalized}`
          : `微信公众号 ${normalized}`;

      const res = await fetch("/api/skills/run", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: "search-query",
          input: { query, limit: 5 },
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Search failed (${res.status})`);
      }

      const json = (await res.json()) as { output?: unknown };
      const output = json?.output as { results?: unknown } | null;
      const results = Array.isArray(output?.results) ? (output!.results as Array<{ title?: string; url?: string; snippet?: string }>) : [];

      const ai = await fetchGptOssIpAutofill({ platform: ipSourcePlatform, account, searchResults: results });
      if (ai.status === "disabled") {
        setIpRetrieveUi({ status: "disabled", message: "AI disabled (missing NEXT_PUBLIC_OPENROUTER_API_KEY)" });
        return;
      }
      if (ai.status !== "ok" || !ai.data) {
        setIpRetrieveUi({ status: "error", message: `AI error (${ai.reason ?? "invoke failed"})` });
        return;
      }

      setIpFormData({
        name: ai.data.name || normalized || "My IP",
        description: ai.data.description,
        purpose: ai.data.purpose,
      });
      setIpSuggestion({ name: "", description: "", purpose: "" });
      setIpFocusedField(null);
      setIpRetrieveUi({ status: "ok", message: "Filled from your account." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Retrieve failed";
      setIpRetrieveUi({ status: "error", message: msg });
    }
  };

  const handleCreate = async () => {
    try {
        if (!isSupabaseConfigured) {
          alert("Supabase not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            alert("Please log in to create a persona.");
            return;
        }

        setIsGenerating(true);
        setCreationStatus('creating');
        const id = crypto.randomUUID();

        // 1. Generate Posts (Only for AI)
        if (creationType === 'ai') {
            const { error: postsError } = await supabase.functions.invoke('generate-posts', {
                body: { 
                    persona_description: `Name: ${formData.name}. ${formData.description}. Purpose: ${formData.purpose}. Target Audience: ${formData.targetAudience}.`,
                    platform: "twitter", // Default for now
                    count: 3
                },
            });
            if (postsError) console.error("Posts generation error:", postsError);
        }
        
        // 2. Save to Supabase
        const name =
          creationType === "ai"
            ? (formData.name || "").trim()
            : (ipFormData.name || "").trim() || "My IP";

        if (!name) {
          alert("Name is required.");
          return;
        }

        const payload =
          creationType === "ai"
            ? {
                id,
                name,
                avatar_url: selectedAvatar,
                attributes: {
                  kind: "ai",
                  form: formData,
                  generated_avatars: generatedAvatars,
                  selected_avatar: selectedAvatar,
                },
              }
            : {
                id,
                name,
                attributes: {
                  kind: "ip",
                  brief_description: ipFormData.description,
                  purpose: ipFormData.purpose,
                },
              };

        const resp = await fetch("/api/personas", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(text || "Failed to create persona");
        }

        const saved = (await resp.json()) as { id?: string };
        const personaId = saved.id ?? id;
        setCreatedPersonaId(personaId);
        setCreationStatus('success');
    } catch (error) {
        console.error("Creation failed:", error);
        alert(getReadableErrorMessage(error));
        setCreationStatus('idle');
    } finally {
        setIsGenerating(false);
    }
  };

  if (!creationType) {
    return (
      <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-950">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center gap-4">
            <button onClick={() => router.back()} className="rounded-full p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <ArrowLeft className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
            </button>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Create New Persona</h1>
          </div>
        </header>
        <main className="mx-auto w-full max-w-4xl px-6 py-12">
            <h2 className="mb-8 text-center text-2xl font-bold">Choose Persona Type</h2>
            <div className="grid gap-6 md:grid-cols-2">
                <button
                    onClick={() => setCreationType('ai')}
                    className="flex flex-col items-center rounded-xl border-2 border-zinc-200 p-8 text-center transition-all hover:border-black hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-white dark:hover:bg-zinc-900"
                >
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                        <Wand2 className="h-8 w-8" />
                    </div>
                    <h3 className="mb-2 text-xl font-bold">New Persona</h3>
                    <p className="text-zinc-500">Create a virtual AI persona with custom appearance, personality, and content generation capabilities.</p>
                </button>
                <button
                    onClick={() => setCreationType('ip')}
                    className="flex flex-col items-center rounded-xl border-2 border-zinc-200 p-8 text-center transition-all hover:border-black hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-white dark:hover:bg-zinc-900"
                >
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
                        <RefreshCw className="h-8 w-8" />
                    </div>
                    <h3 className="mb-2 text-xl font-bold">Set up my IP</h3>
                    <p className="text-zinc-500">Set up your personal brand identity. No credits required.</p>
                </button>
            </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-4">
          <button onClick={() => {
              if (creationType === 'ip' || step === 1) setCreationType(null);
              else handleBack();
          }} className="rounded-full p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <ArrowLeft className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
          </button>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {creationType === 'ai' ? "Create a virtual AI persona" : "Set up my IP"}
          </h1>
        </div>
      </header>

      {/* Progress Bar - Only for AI flow */}
      {creationType === 'ai' && (
        <div className="flex w-full gap-2 px-6 pt-6">
            <div className={`h-1 flex-1 rounded-full ${step >= 1 ? "bg-black dark:bg-white" : "bg-zinc-200 dark:bg-zinc-800"}`} />
            <div className={`h-1 flex-1 rounded-full ${step >= 2 ? "bg-black dark:bg-white" : "bg-zinc-200 dark:bg-zinc-800"}`} />
            <div className={`h-1 flex-1 rounded-full ${step >= 3 ? "bg-black dark:bg-white" : "bg-zinc-200 dark:bg-zinc-800"}`} />
        </div>
      )}

      <main className="mx-auto w-full max-w-2xl px-6 py-8">
        {creationStatus !== 'idle' ? (
          <div className="flex flex-col items-center justify-center py-12 text-center animate-in fade-in duration-500">
            <h2 className="mb-8 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
              {creationStatus === 'success' ? "All set!" : "Just a sec! Your new persona is on the way."}
            </h2>

            <div className="w-64 mb-12">
               <div className="flex justify-between text-sm font-medium text-zinc-500 mb-2">
                 <span>{creationStatus === 'success' ? 'Completed' : 'Creating...'}</span>
                 <span>{progress}%</span>
               </div>
               <div className="h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                 <div 
                   className="h-full bg-black dark:bg-white transition-all duration-300 ease-out" 
                   style={{ width: `${progress}%` }}
                 /> 
               </div>
            </div>

            <div className="flex gap-6 mb-12">
               {['Photos', 'Posts', 'Videos'].map(section => (
                 <div key={section} className="flex flex-col items-center gap-3">
                   <span className="text-lg font-medium text-zinc-900 dark:text-zinc-50">{section}</span>
                   <div className="w-32 h-32 bg-zinc-200 dark:bg-zinc-800 rounded-lg shadow-sm"></div>
                 </div>
               ))}
            </div>

            <button 
              onClick={() => createdPersonaId && router.push(`/persona/${createdPersonaId}/docs/default`)}
              disabled={creationStatus !== 'success'}
              className="px-8 py-3 bg-zinc-900 text-white text-lg font-medium rounded-lg hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors"
            >
              {creationType === 'ai' ? "View my persona" : "View my ip"}
            </button>
          </div>
        ) : creationType === 'ip' ? (
            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="mb-6 flex items-center justify-between gap-4">
                  <h2 className="text-xl font-bold">IP Information</h2>
                  {ipSetupMode && (
                    <button
                      type="button"
                      onClick={() => {
                        setIpSetupMode(null);
                        setIpRetrieveUi({ status: "idle" });
                      }}
                      className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
                    >
                      Change setup
                    </button>
                  )}
                </div>

                {!ipSetupMode ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setIpSetupMode("existing")}
                      className="flex flex-col items-start rounded-xl border-2 border-zinc-200 p-6 text-left transition-all hover:border-black hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-white dark:hover:bg-zinc-900"
                    >
                      <div className="text-base font-semibold text-zinc-900 dark:text-zinc-50">I already have an account</div>
                      <div className="mt-1 text-sm text-zinc-500">Retrieve your profile info and auto-fill the form.</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIpSetupMode("new")}
                      className="flex flex-col items-start rounded-xl border-2 border-zinc-200 p-6 text-left transition-all hover:border-black hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-white dark:hover:bg-zinc-900"
                    >
                      <div className="text-base font-semibold text-zinc-900 dark:text-zinc-50">I don&apos;t have an account yet</div>
                      <div className="mt-1 text-sm text-zinc-500">Fill in your IP info manually.</div>
                    </button>
                  </div>
                ) : (
                  <>
                    {ipSetupMode === "existing" && (
                      <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                        <div className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Set up from my account</div>
                        <div className="grid gap-3 md:grid-cols-[180px_1fr_120px] md:items-end">
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Platform</label>
                            <Select value={ipSourcePlatform} onValueChange={(val) => setIpSourcePlatform(val as IpSourcePlatform)}>
                              <SelectTrigger className="w-full bg-zinc-50 dark:bg-zinc-900">
                                <SelectValue placeholder="Select" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="twitter">X (Twitter)</SelectItem>
                                <SelectItem value="wechat">WeChat</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Account</label>
                            <input
                              type="text"
                              placeholder={ipSourcePlatform === "twitter" ? "@username or profile link" : "公众号名称 / ID"}
                              value={ipSourceAccount}
                              onChange={(e) => {
                                setIpSourceAccount(e.target.value);
                                setIpRetrieveUi({ status: "idle" });
                              }}
                              className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-2.5 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500 dark:focus:ring-zinc-600"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              void handleRetrieveIpFromAccount();
                            }}
                            disabled={ipRetrieveUi.status === "loading"}
                            className="h-[42px] rounded-lg bg-zinc-900 px-4 font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                          >
                            {ipRetrieveUi.status === "loading" ? (
                              <span className="flex items-center justify-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                获取中...
                              </span>
                            ) : (
                              "获取"
                            )}
                          </button>
                        </div>
                        {(ipRetrieveUi.status === "error" || ipRetrieveUi.status === "disabled" || ipRetrieveUi.status === "ok") && (
                          <div
                            className={`mt-3 text-sm ${
                              ipRetrieveUi.status === "ok"
                                ? "text-green-600 dark:text-green-400"
                                : ipRetrieveUi.status === "disabled"
                                  ? "text-zinc-500 dark:text-zinc-400"
                                  : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            {ipRetrieveUi.message || ""}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
                        <div className="relative">
                          <input
                              type="text"
                              placeholder="e.g. My Personal Brand"
                              value={ipFormData.name}
                              onChange={(e) => {
                                setIpFormData({ ...ipFormData, name: e.target.value });
                                setIpSuggestion((prev) => ({ ...prev, name: "" }));
                              }}
                              onFocus={() => setIpFocusedField("name")}
                              onBlur={() => setIpFocusedField((v) => (v === "name" ? null : v))}
                              onKeyDown={(e) => {
                                if (e.key === "Tab" && ipSuggestion.name) {
                                  e.preventDefault();
                                  acceptIpSuggestion("name");
                                }
                              }}
                              className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-2.5 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500 dark:focus:ring-zinc-600"
                          />
                          {ipFocusedField === "name" && ipSuggestion.name && (
                            <div className="pointer-events-none absolute inset-0 flex items-center px-4 py-2.5 text-base">
                              <span className="invisible whitespace-pre">{ipFormData.name}</span>
                              <span className="text-zinc-400">{ipSuggestion.name}</span>
                            </div>
                          )}
                        </div>
                        {ipFocusedField === "name" && (
                          <div className="text-xs text-zinc-400">
                            {ipSuggestUi.status === "loading"
                              ? "AI: thinking..."
                              : ipSuggestUi.status === "disabled"
                                ? "AI: disabled (missing NEXT_PUBLIC_OPENROUTER_API_KEY)"
                                : ipSuggestUi.status === "error"
                                  ? `AI: error (${ipSuggestUi.reason ?? "invoke failed"})`
                                  : ipSuggestion.name
                                    ? `Tab to accept: ${ipSuggestion.name}`
                                    : "AI: idle"}
                          </div>
                        )}
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">A brief description</label>
                        <div className="relative">
                          <Textarea
                              placeholder="Describe yourself or your brand..."
                              value={ipFormData.description}
                              onChange={(e) => {
                                setIpFormData({ ...ipFormData, description: e.target.value });
                                setIpSuggestion((prev) => ({ ...prev, description: "" }));
                              }}
                              onFocus={() => setIpFocusedField("description")}
                              onBlur={() => setIpFocusedField((v) => (v === "description" ? null : v))}
                              onKeyDown={(e) => {
                                if (e.key === "Tab" && ipSuggestion.description) {
                                  e.preventDefault();
                                  acceptIpSuggestion("description");
                                }
                              }}
                              className="min-h-[100px] border border-zinc-300 bg-zinc-50 text-base focus-visible:ring-1 focus-visible:ring-zinc-400 focus-visible:ring-offset-0 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-visible:ring-zinc-600"
                          />
                          {ipFocusedField === "description" && ipSuggestion.description && (
                            <div className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words px-3 py-2 text-base">
                              <span className="invisible">{ipFormData.description}</span>
                              <span className="text-zinc-400">{ipSuggestion.description}</span>
                            </div>
                          )}
                        </div>
                        {ipFocusedField === "description" && (
                          <div className="text-xs text-zinc-400">
                            {ipSuggestUi.status === "loading"
                              ? "AI: thinking..."
                              : ipSuggestUi.status === "disabled"
                                ? "AI: disabled (missing NEXT_PUBLIC_OPENROUTER_API_KEY)"
                                : ipSuggestUi.status === "error"
                                  ? `AI: error (${ipSuggestUi.reason ?? "invoke failed"})`
                                  : ipSuggestion.description
                                    ? `Tab to accept: ${ipSuggestion.description}`
                                    : "AI: idle"}
                          </div>
                        )}
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">What&apos;s the purpose of this account?</label>
                        <div className="relative">
                          <Textarea
                              placeholder="e.g. To share my daily life and thoughts..."
                              value={ipFormData.purpose}
                              onChange={(e) => {
                                setIpFormData({ ...ipFormData, purpose: e.target.value });
                                setIpSuggestion((prev) => ({ ...prev, purpose: "" }));
                              }}
                              onFocus={() => setIpFocusedField("purpose")}
                              onBlur={() => setIpFocusedField((v) => (v === "purpose" ? null : v))}
                              onKeyDown={(e) => {
                                if (e.key === "Tab" && ipSuggestion.purpose) {
                                  e.preventDefault();
                                  acceptIpSuggestion("purpose");
                                }
                              }}
                              className="min-h-[100px] border border-zinc-300 bg-zinc-50 text-base focus-visible:ring-1 focus-visible:ring-zinc-400 focus-visible:ring-offset-0 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-visible:ring-zinc-600"
                          />
                          {ipFocusedField === "purpose" && ipSuggestion.purpose && (
                            <div className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words px-3 py-2 text-base">
                              <span className="invisible">{ipFormData.purpose}</span>
                              <span className="text-zinc-400">{ipSuggestion.purpose}</span>
                            </div>
                          )}
                        </div>
                        {ipFocusedField === "purpose" && (
                          <div className="text-xs text-zinc-400">
                            {ipSuggestUi.status === "loading"
                              ? "AI: thinking..."
                              : ipSuggestUi.status === "disabled"
                                ? "AI: disabled (missing NEXT_PUBLIC_OPENROUTER_API_KEY)"
                                : ipSuggestUi.status === "error"
                                  ? `AI: error (${ipSuggestUi.reason ?? "invoke failed"})`
                                  : ipSuggestion.purpose
                                    ? `Tab to accept: ${ipSuggestion.purpose}`
                                    : "AI: idle"}
                          </div>
                        )}
                    </div>
                    </div>
                    <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          void handleCreate();
                        }}
                        disabled={isGenerating}
                        className="mt-8 w-full rounded-lg bg-zinc-900 py-3.5 font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                        {isGenerating ? (
                            <span className="flex items-center justify-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Saving...
                            </span>
                        ) : (
                            "Continue"
                        )}
                    </button>
                  </>
                )}
            </div>
        ) : (
            // Existing AI Flow
            <>
                {step === 1 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            {/* Step 1: Basic Info */}
            <h2 className="mb-6 text-xl font-bold">Basic Information</h2>
            
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
                <input
                  type="text"
                  placeholder="Persona Name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 outline-none focus:ring-2 focus:ring-black dark:border-zinc-800 dark:bg-zinc-900 dark:focus:ring-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Gender</label>
                  <Select onValueChange={(val) => setFormData({ ...formData, gender: val })}>
                    <SelectTrigger className="w-full bg-zinc-50 dark:bg-zinc-900">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="non-binary">Non-binary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Age</label>
                  <Select onValueChange={(val) => setFormData({ ...formData, age: val })} defaultValue="25">
                    <SelectTrigger className="w-full bg-zinc-50 dark:bg-zinc-900">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 50 }, (_, i) => i + 18).map((age) => (
                        <SelectItem key={age} value={age.toString()}>{age}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Language</label>
                <Select onValueChange={(val) => setFormData({ ...formData, language: val })}>
                  <SelectTrigger className="w-full bg-zinc-50 dark:bg-zinc-900">
                    <SelectValue placeholder="Select Language" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="zh">Chinese</SelectItem>
                    <SelectItem value="jp">Japanese</SelectItem>
                    <SelectItem value="kr">Korean</SelectItem>
                    <SelectItem value="es">Spanish</SelectItem>
                    <SelectItem value="fr">French</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="pt-4">
                <h3 className="mb-4 text-lg font-bold">Appearance</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Skin Color</label>
                    <Select onValueChange={(val) => setFormData({ ...formData, skinColor: val })}>
                      <SelectTrigger className="w-full bg-zinc-50 dark:bg-zinc-900">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="light">Light</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="dark">Dark</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Hair Color</label>
                    <Select onValueChange={(val) => setFormData({ ...formData, hairColor: val })}>
                      <SelectTrigger className="w-full bg-zinc-50 dark:bg-zinc-900">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="black">Black</SelectItem>
                        <SelectItem value="brown">Brown</SelectItem>
                        <SelectItem value="blonde">Blonde</SelectItem>
                        <SelectItem value="red">Red</SelectItem>
                        <SelectItem value="white">White</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Eye Color (Optional)</label>
                    <Select onValueChange={(val) => setFormData({ ...formData, eyeColor: val })}>
                      <SelectTrigger className="w-full bg-zinc-50 dark:bg-zinc-900">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="brown">Brown</SelectItem>
                        <SelectItem value="blue">Blue</SelectItem>
                        <SelectItem value="green">Green</SelectItem>
                        <SelectItem value="hazel">Hazel</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Hair Style (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Curly"
                      value={formData.hairStyle}
                      onChange={(e) => setFormData({ ...formData, hairStyle: e.target.value })}
                      className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 outline-none focus:ring-2 focus:ring-black dark:border-zinc-800 dark:bg-zinc-900 dark:focus:ring-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Hair Accessories (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Bow"
                      value={formData.hairAccessories}
                      onChange={(e) => setFormData({ ...formData, hairAccessories: e.target.value })}
                      className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 outline-none focus:ring-2 focus:ring-black dark:border-zinc-800 dark:bg-zinc-900 dark:focus:ring-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Glasses (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Round"
                      value={formData.glasses}
                      onChange={(e) => setFormData({ ...formData, glasses: e.target.value })}
                      className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 outline-none focus:ring-2 focus:ring-black dark:border-zinc-800 dark:bg-zinc-900 dark:focus:ring-white"
                    />
                  </div>
                </div>
              </div>
            </div>
            
            <div className="mt-8 text-xs text-zinc-500">
              10 credits (Step 1) / 100 credits (Full)
            </div>
            <button
              onClick={handleNext}
              className="mt-4 w-full rounded-lg bg-zinc-900 py-3.5 font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Continue <span className="ml-1 text-sm font-normal opacity-80">(10 Credits)</span>
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                 <button 
                   onClick={() => setStep(1)} 
                   className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                 >
                   <ArrowLeftCircle className="h-6 w-6" />
                 </button>
                 <h2 className="text-xl font-bold">{formData.name || "Persona"}</h2>
              </div>
              <p className="mt-1 text-sm text-zinc-500 pl-9">
                {formData.age} years old, {formData.gender}, {formData.skinColor} skin, {formData.hairColor} hair, {formData.eyeColor ? `${formData.eyeColor} eyes,` : ""} {formData.hairStyle}, {formData.language === "en" ? "speaks English" : "speaks Chinese"}
              </p>
            </div>

            <h3 className="mb-4 font-semibold">Choose Avatar</h3>
            <div className="grid grid-cols-3 gap-4">
               {(generatedAvatars.length > 0 ? generatedAvatars : [null, null, null]).map((src, i) => (
                 <div 
                    key={src ?? i} 
                    className={`relative aspect-square cursor-pointer overflow-hidden rounded-xl border-2 transition-all ${selectedAvatar === (src ?? `avatar-${i}`) ? "border-blue-500 ring-2 ring-blue-500/20" : "border-transparent hover:border-zinc-200 dark:hover:border-zinc-700"}`}
                    onClick={() => setSelectedAvatar(src ?? `avatar-${i}`)}
                 >
                    {src ? (
                     <Image
                       src={src}
                       alt={`Avatar ${i + 1}`}
                       fill
                       unoptimized
                       className="object-cover"
                     />
                   ) : (
                      <>
                        <div className="absolute inset-0 bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                        <div className="absolute inset-0 flex items-center justify-center text-zinc-400">
                          Avatar {i + 1}
                        </div>
                      </>
                    )}
                 </div>
               ))}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={handleGenerateAvatars}
                className="flex flex-1 flex-col items-center justify-center gap-1 rounded-lg bg-zinc-100 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
              >
                 <RefreshCw className="h-4 w-4" />
                 <span>Regenerate (10 credits)</span>
              </button>
              <button className="flex flex-1 flex-col items-center justify-center gap-1 rounded-lg bg-zinc-100 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700">
                 <Wand2 className="h-4 w-4" />
                 <span>Customize</span>
              </button>
            </div>

            <button
              onClick={handleNext}
              disabled={!selectedAvatar}
              className="mt-8 w-full rounded-lg bg-zinc-900 py-3.5 font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Continue
            </button>
            <button onClick={() => setStep(1)} className="mt-4 w-full text-sm text-red-500 hover:underline">
               Discard
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Description (Required)</label>
                <Textarea
                  placeholder="Describe your persona's background, personality, and expertise..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="min-h-[120px] bg-zinc-50 text-base dark:bg-zinc-900"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Purpose (Required)</label>
                <Textarea
                  placeholder="What is the main goal of this persona?"
                  value={formData.purpose}
                  onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                  className="min-h-[100px] bg-zinc-50 text-base dark:bg-zinc-900"
                />
                <div className="flex justify-end text-xs text-red-500">0/20 characters minimum</div>
                <div className="text-xs text-zinc-500">
                  <p className="mb-1 font-medium">Examples:</p>
                  <p>(1) To promote my app, which is about food calories track using AI</p>
                  <p>(2) To promote and sell my courses, which are about how to build a brand</p>
                  <p>(3) To generate revenue through advertising. The ads are about technology</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                   <label className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Target Audience</label>
                   <button className="flex items-center gap-1 rounded-full bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600">
                      <Wand2 className="h-3 w-3" />
                      AI Suggest
                   </button>
                </div>
                <input
                  type="text"
                  placeholder="e.g. Tech enthusiasts, Students"
                  value={formData.targetAudience}
                  onChange={(e) => setFormData({ ...formData, targetAudience: e.target.value })}
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 outline-none focus:ring-2 focus:ring-black dark:border-zinc-800 dark:bg-zinc-900 dark:focus:ring-white"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleCreate}
              disabled={isGenerating}
              className="mt-8 w-full rounded-lg bg-zinc-900 py-3.5 font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {isGenerating ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </span>
              ) : (
                <>Create <span className="ml-1 text-sm font-normal opacity-80">(90 Credits)</span></>
              )}
            </button>
          </div>
        )}
            </>
        )}
      </main>
    </div>
  );
}
