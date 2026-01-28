"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { supabase, getSessionWithTimeout } from "@/lib/supabaseClient";
import type { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { Loader2, User, CreditCard, Save, Upload, Wrench, Bot, Check } from "lucide-react";

type Tab = "usage" | "account" | "skills" | "models";

type UsageRow = {
  id: string;
  created_at: string;
  description?: string;
  qty?: number;
  total?: number;
  title?: string;
  amount?: number;
};

type ProfileMessage = { type: "success" | "error"; text: string };

type SkillRow = {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  configured: boolean;
};

const MODEL_SETTINGS_KEY = "aipersona.chat.models.enabled";

const MODEL_OPTIONS = [
  { id: "persona-ai", name: "PersonaAI", badge: "Recommended" },
  { id: "gpt-5.2", name: "GPT5.2", badge: null },
  { id: "gpt-oss", name: "GPT oss", badge: null },
  { id: "nanobanana", name: "Nanobanana", badge: null },
  { id: "kimi-0905", name: "Kimi0905", badge: null },
  { id: "gemini-3.0-pro", name: "Gemini3.0pro", badge: null },
  { id: "minimax-m2", name: "Minimax M2", badge: null },
] as const;

function withTimeout<T>(promiseLike: PromiseLike<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    Promise.resolve(promiseLike),
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error("Request timeout")), timeoutMs);
    }),
  ]);
}

function formatSignedNumber(value: number) {
  if (Number.isNaN(value)) return "-";
  if (value > 0) return `+${value}`;
  return `${value}`;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("usage");
  const [loading, setLoading] = useState(true);
  const [authResolved, setAuthResolved] = useState(false);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [accessToken, setAccessToken] = useState<string>("");

  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<ProfileMessage | null>(null);

  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [creditBalance, setCreditBalance] = useState<number>(0);

  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [setupSkill, setSetupSkill] = useState<SkillRow | null>(null);
  const [notionTokenDraft, setNotionTokenDraft] = useState("");
  const [notionTokenSaved, setNotionTokenSaved] = useState(false);
  const [setupMessage, setSetupMessage] = useState<ProfileMessage | null>(null);
  const [enabledModelIds, setEnabledModelIds] = useState<string[]>(() => MODEL_OPTIONS.map((m) => m.id));

  const loadUserReqIdRef = useRef(0);
  const loadProfileReqIdRef = useRef(0);
  const fetchUsageReqIdRef = useRef(0);
  const saveProfileReqIdRef = useRef(0);
  const fetchSkillsReqIdRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    const reqId = ++loadUserReqIdRef.current;
    let settled = false;
    let attempts = 0;
    const startedAt = Date.now();
    const MAX_WAIT_MS = 8000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const stopSpinnerTimer = setTimeout(() => {
      if (!mounted || reqId !== loadUserReqIdRef.current) return;
      if (settled) return;
      setLoading(false);
    }, 1200);

    const applySignedInSession = (session: Session) => {
      if (!mounted || reqId !== loadUserReqIdRef.current) return;
      settled = true;
      setAuthResolved(true);
      setUser(session.user);
      setAccessToken(session.access_token ?? "");
      setName(session.user.user_metadata?.full_name || session.user.user_metadata?.name || "");
      setAvatarUrl(session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || "");
      setLoading(false);
    };

    const markSignedOut = () => {
      if (!mounted || reqId !== loadUserReqIdRef.current) return;
      settled = true;
      setAuthResolved(true);
      setUser(null);
      setAccessToken("");
      setLoading(false);
    };

    const scheduleRetry = (delayMs: number) => {
      if (!mounted || reqId !== loadUserReqIdRef.current) return;
      if (settled) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        void loadUser();
      }, delayMs);
    };

    const loadUser = async () => {
      try {
        attempts += 1;
        const { session } = await getSessionWithTimeout({
          timeoutMs: 4000,
          retries: 2,
          retryDelayMs: 150,
        });

        if (session?.user) {
          applySignedInSession(session);
          return;
        }

        if (Date.now() - startedAt >= MAX_WAIT_MS) {
          markSignedOut();
          return;
        }

        scheduleRetry(600);
      } catch {
        if (!mounted || reqId !== loadUserReqIdRef.current) return;
        if (Date.now() - startedAt >= MAX_WAIT_MS) {
          markSignedOut();
          return;
        }
        const delay = Math.min(8000, 800 * Math.max(1, attempts));
        scheduleRetry(delay);
      } finally {
        clearTimeout(stopSpinnerTimer);
      }
    };
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted || reqId !== loadUserReqIdRef.current) return;
      if (event === "INITIAL_SESSION" && !session) {
        if (Date.now() - startedAt >= MAX_WAIT_MS) {
          markSignedOut();
        } else {
          scheduleRetry(600);
        }
        return;
      }
      if (session?.user) {
        applySignedInSession(session);
        return;
      }
      if (event === "SIGNED_OUT") {
        markSignedOut();
        return;
      }
      if (Date.now() - startedAt >= MAX_WAIT_MS) {
        markSignedOut();
        return;
      }
      scheduleRetry(600);
    });
    void loadUser();
    return () => {
      mounted = false;
      clearTimeout(stopSpinnerTimer);
      if (retryTimer) clearTimeout(retryTimer);
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const reqId = ++loadProfileReqIdRef.current;

    const loadProfile = async () => {
      try {
        const { data: profileRow, error: profileError } = await withTimeout(
          supabase
            .from("users")
            .select("username, avatar")
            .eq("id", user.id)
            .single(),
          4000
        );

        if (!mounted || reqId !== loadProfileReqIdRef.current) return;

        if (!profileError && profileRow) {
          setName(profileRow.username || "");
          setAvatarUrl(profileRow.avatar || "");
        }
      } catch {
        void 0;
      }
    };

    void loadProfile();

    return () => {
      mounted = false;
    };
  }, [user]);

  const fetchUsage = useCallback(async () => {
    const reqId = ++fetchUsageReqIdRef.current;
    setUsageLoading(true);
    setUsageError(null);
    try {
      const userId = user?.id;
      if (!userId) {
        setUsageRows([]);
        setUsageError("未登录");
        return;
      }

      const token = accessToken;
      if (!token) {
        setUsageRows([]);
        setUsageError("未登录");
        return;
      }

      const res = await withTimeout(
        fetch(`/api/settings/usage?${new URLSearchParams({ limit: "50", noCache: "1" }).toString()}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        }),
        8000
      );

      if (reqId !== fetchUsageReqIdRef.current) return;

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }

      const body = (await res.json()) as { credits?: number; history?: UsageRow[] };
      setCreditBalance(typeof body.credits === "number" ? body.credits : 0);
      setUsageRows(Array.isArray(body.history) ? body.history : []);
    } catch (err) {
      if (reqId !== fetchUsageReqIdRef.current) return;
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Unexpected error:", err);
      setUsageError(message === "Request timeout" ? "加载超时，请稍后重试" : message);
    } finally {
      if (reqId === fetchUsageReqIdRef.current) {
        setUsageLoading(false);
      }
    }
  }, [user, accessToken]);

  useEffect(() => {
    if (activeTab === "usage" && user) {
      void fetchUsage();
    }
  }, [activeTab, user, fetchUsage]);

  const fetchSkills = useCallback(async () => {
    const reqId = ++fetchSkillsReqIdRef.current;
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const token = accessToken;
      if (!token) {
        setSkills([]);
        setSkillsError("未登录");
        return;
      }

      const res = await fetch("/api/skills", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (reqId !== fetchSkillsReqIdRef.current) return;

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }

      const dataJson = (await res.json()) as { skills?: SkillRow[] };
      setSkills(Array.isArray(dataJson.skills) ? dataJson.skills : []);
    } catch (err) {
      if (reqId !== fetchSkillsReqIdRef.current) return;
      const message = err instanceof Error ? err.message : "Unknown error";
      setSkillsError(message);
      setSkills([]);
    } finally {
      if (reqId === fetchSkillsReqIdRef.current) setSkillsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (activeTab === "skills") {
      void fetchSkills();
    }
  }, [activeTab, fetchSkills]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("aipersona.notion.token") ?? "";
    setNotionTokenSaved(Boolean(saved.trim()));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(MODEL_SETTINGS_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as unknown;
      const allowed = new Set<string>(MODEL_OPTIONS.map((m) => m.id));
      const list = Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === "string" && allowed.has(v))
        : [];
      if (list.length > 0) {
        setEnabledModelIds(list);
      }
    } catch {
      void 0;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const allowed = new Set<string>(MODEL_OPTIONS.map((m) => m.id));
    const cleaned = enabledModelIds.filter((id) => allowed.has(id));
    const next = cleaned.length > 0 ? cleaned : MODEL_OPTIONS.map((m) => m.id);
    window.localStorage.setItem(MODEL_SETTINGS_KEY, JSON.stringify(next));
  }, [enabledModelIds]);

  const toggleModel = useCallback((id: string) => {
    setEnabledModelIds((prev) => {
      const next = prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id];
      return next.length === 0 ? prev : next;
    });
  }, []);

  const openSetup = useCallback((skill: SkillRow) => {
    setSetupMessage(null);
    setSetupSkill(skill);
    if (typeof window !== "undefined" && skill.id === "notion-integration") {
      const saved = window.localStorage.getItem("aipersona.notion.token") ?? "";
      setNotionTokenDraft(saved);
    } else {
      setNotionTokenDraft("");
    }
  }, []);

  const closeSetup = useCallback(() => {
    setSetupSkill(null);
    setSetupMessage(null);
  }, []);

  const saveNotionSetup = useCallback(() => {
    if (typeof window === "undefined") return;
    const token = notionTokenDraft.trim();
    if (!token) {
      setSetupMessage({ type: "error", text: "Notion token is required." });
      return;
    }
    window.localStorage.setItem("aipersona.notion.token", token);
    setNotionTokenSaved(true);
    setSetupMessage({ type: "success", text: "Notion token saved on this device." });
    setSetupSkill(null);
  }, [notionTokenDraft]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setProfileMessage({ type: "error", text: "请选择图片文件" });
      return;
    }

    const maxBytes = 2 * 1024 * 1024;
    if (file.size > maxBytes) {
      setProfileMessage({ type: "error", text: "图片不能超过 2MB" });
      return;
    }

    setAvatarFile(file);
    const url = URL.createObjectURL(file);
    setAvatarPreview(url);
  };

  const handleEmojiSelect = (emoji: string) => {
    setAvatarFile(null);
    setAvatarPreview(emoji);
  };

  useEffect(() => {
    return () => {
      if (avatarPreview && avatarPreview.startsWith("blob:")) {
        URL.revokeObjectURL(avatarPreview);
      }
    };
  }, [avatarPreview]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    setProfileMessage(null);
    const reqId = ++saveProfileReqIdRef.current;
    const traceId = `save-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const t0 = performance.now();
    const time = () => `${Math.round(performance.now() - t0)}ms`;
    const log = (step: string, event: string, data?: unknown) =>
      console.log(`[SettingsSave][${traceId}][${step}] ${event} (${time()})`, data ?? "");
    
    try {
      let finalAvatarUrl = avatarUrl;

      // 1. Handle File Upload
      log("upload", "start", { hasFile: !!avatarFile });
      if (avatarFile) {
        const fileExt = avatarFile.name.split(".").pop() || "png";
        const fileName = `${user.id}/${Date.now()}.${fileExt}`;

        // Attempt upload with longer timeout (15s)
        const uploadRes = await withTimeout(
          supabase.storage.from("avatars").upload(fileName, avatarFile, { upsert: true }),
          15000
        );

        if (uploadRes.error) {
          log("upload", "error", uploadRes.error);
          throw new Error(`图片上传失败: ${uploadRes.error.message}`);
        }

        const publicUrlRes = supabase.storage.from("avatars").getPublicUrl(fileName);
        finalAvatarUrl = publicUrlRes.data.publicUrl;
        log("upload", "success", { publicUrl: finalAvatarUrl });
      } 
      // 2. Handle Emoji Selection (if avatarPreview is set and not a blob/http URL)
      else if (avatarPreview && !avatarPreview.startsWith("blob:") && !avatarPreview.startsWith("http") && !avatarPreview.startsWith("/")) {
        finalAvatarUrl = avatarPreview;
        log("emoji", "selected", { emoji: finalAvatarUrl });
      }

      log("prepare", "metadata", { name, finalAvatarUrl });

      // 3. Save to Users Table with fallback: update → insert
      const payload = {
        id: user.id,
        email: user.email ?? null,
        username: name || null,
        avatar: finalAvatarUrl || null,
        updated_at: new Date().toISOString(),
      };
      log("db.update", "start", payload);
      const updateRes = await supabase
        .from("users")
        .update(payload)
        .eq("id", user.id)
        .select("id");

      if (updateRes.error) {
        log("db.update", "error", {
          message: updateRes.error.message,
          code: (updateRes.error as { code?: string }).code,
          hint: (updateRes.error as { hint?: string }).hint,
          details: (updateRes.error as { details?: string }).details,
        });
      } else {
        log("db.update", "success", updateRes.data);
      }

      const updatedCount = Array.isArray(updateRes.data) ? updateRes.data.length : 0;
      if (updateRes.error || updatedCount === 0) {
        log("db.insert", "start", payload);
        const insertRes = await supabase
          .from("users")
          .insert(payload)
          .select("id");
        if (insertRes.error) {
          log("db.insert", "error", {
            message: insertRes.error.message,
            code: (insertRes.error as { code?: string }).code,
            hint: (insertRes.error as { hint?: string }).hint,
            details: (insertRes.error as { details?: string }).details,
          });
          const code = (insertRes.error as { code?: string })?.code;
          const hint = (insertRes.error as { hint?: string })?.hint;
          throw new Error(`保存失败[users.insert]: ${insertRes.error.message}${code ? ` (code: ${code})` : ""}${hint ? ` - ${hint}` : ""}`);
        } else {
          log("db.insert", "success", insertRes.data);
        }
      }

      // 4. Update Auth User Metadata asynchronously
      log("auth.updateUser", "queued");
      void withTimeout(
        supabase.auth.updateUser({
          data: {
            full_name: name,
            avatar_url: finalAvatarUrl,
          },
        }),
        5000
      )
        .then((authRes) => {
          if (authRes.error) {
            log("auth.updateUser", "error", {
              message: authRes.error.message,
              name: authRes.error.name,
              status: (authRes.error as unknown as { status?: number }).status,
            });
          } else {
            log("auth.updateUser", "success");
          }
        })
        .catch((err) => {
          log("auth.updateUser", "exception", err);
        });

      if (reqId !== saveProfileReqIdRef.current) return;

      setAvatarUrl(finalAvatarUrl);
      setAvatarFile(null);
      setAvatarPreview(null);
      // Update local user state metadata to reflect changes immediately
      if (user) {
        setUser({
          ...user,
          user_metadata: {
            ...user.user_metadata,
            full_name: name,
            avatar_url: finalAvatarUrl
          }
        });
      }

      try {
        window.dispatchEvent(
          new CustomEvent("aipersona:profile-updated", {
            detail: {
              userId: user.id,
              username: name || null,
              avatar_url: finalAvatarUrl || null,
            },
          })
        );
      } catch {
        void 0;
      }

      setProfileMessage({ type: "success", text: "保存成功" });
    } catch (err: unknown) {
      if (reqId !== saveProfileReqIdRef.current) return;
      log("exception", "caught", err);
      const maybeMessage = (err as { message?: unknown })?.message;
      const message = err instanceof Error ? err.message : typeof maybeMessage === "string" ? maybeMessage : "保存失败";
      setProfileMessage({ type: "error", text: message === "Request timeout" ? "保存超时，请检查网络" : message });
    } finally {
      if (reqId === saveProfileReqIdRef.current) {
        setSavingProfile(false);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white dark:bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!authResolved && !user) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center bg-white dark:bg-zinc-950">
        <div className="flex items-center gap-3 text-zinc-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading account information...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center bg-white dark:bg-zinc-950">
        <div className="text-center">
          <p className="text-zinc-500">Please sign in to view settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="mb-8 text-2xl font-bold">Settings</h1>

        <div className="flex flex-col gap-8 md:flex-row">
          {/* Sidebar / Tabs */}
          <aside className="w-full md:w-64 shrink-0">
            <nav className="flex flex-col gap-1">
              <button
                onClick={() => setActiveTab("usage")}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === "usage"
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                }`}
              >
                <CreditCard className="h-4 w-4" />
                Usage History
              </button>
              <button
                onClick={() => setActiveTab("account")}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === "account"
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                }`}
              >
                <User className="h-4 w-4" />
                Account
              </button>
              <button
                onClick={() => setActiveTab("models")}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === "models"
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                }`}
              >
                <Bot className="h-4 w-4" />
                Models
              </button>
              <button
                onClick={() => setActiveTab("skills")}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === "skills"
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                }`}
              >
                <Wrench className="h-4 w-4" />
                Skills
              </button>
            </nav>
          </aside>

          {/* Content */}
          <main className="flex-1">
            {activeTab === "usage" && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="mb-4">
                    <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Credits: {creditBalance}</h2>
                  </div>
                  <div className="mb-6 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">Usage History</h2>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">View your credit usage over time.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => void fetchUsage()}
                        className="rounded-md px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        disabled={usageLoading}
                      >
                        Refresh
                      </button>
                      {usageLoading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
                    </div>
                  </div>

                  {usageError && (
                    <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                      {usageError}
                    </div>
                  )}

                  <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <div className="grid grid-cols-12 gap-4 bg-zinc-50 px-4 py-3 text-xs font-medium text-zinc-500 dark:bg-zinc-900/50 dark:text-zinc-400">
                      <div className="col-span-2">Date</div>
                      <div className="col-span-4">Task ID</div>
                      <div className="col-span-4">Title</div>
                      <div className="col-span-2 text-right">Amount</div>
                    </div>
                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {usageRows.length === 0 && !usageLoading ? (
                         <div className="px-4 py-8 text-center text-sm text-zinc-500">No records found</div>
                      ) : (
                        usageRows.map((row) => (
                          <div key={row.id} className="grid grid-cols-12 gap-4 px-4 py-3 text-sm">
                            <div className="col-span-2 text-zinc-600 dark:text-zinc-400">
                              {new Date(row.created_at).toLocaleDateString()}
                            </div>
                            <div className="col-span-4 font-mono text-[12px] text-zinc-600 dark:text-zinc-400 truncate">
                              {row.id}
                            </div>
                            <div className="col-span-4 font-medium text-zinc-900 dark:text-zinc-200">
                              {row.title || row.description || "Unknown"}
                            </div>
                            <div className="col-span-2 text-right font-medium text-zinc-900 dark:text-zinc-200">
                              {row.amount !== undefined
                                ? formatSignedNumber(row.amount)
                                : row.total !== undefined
                                  ? formatSignedNumber(row.total)
                                  : "-"}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "account" && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="mb-6">
                    <h2 className="text-lg font-semibold">Profile Settings</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Manage your public profile information.</p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-900 dark:text-zinc-200">
                        Display Name
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
                        placeholder="Your name"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-900 dark:text-zinc-200">
                        Avatar
                      </label>
                      <div className="flex gap-6 items-start">
                        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
                          {(() => {
                            const displayRaw = avatarPreview || avatarUrl;
                            const display = displayRaw?.trim() ?? "";
                            const isImage = display && (display.startsWith("http") || display.startsWith("blob:") || display.startsWith("/"));

                            const fallbackSource =
                              name?.trim() ||
                              user?.email?.trim() ||
                              "";
                            const fallbackInitial = fallbackSource ? fallbackSource.charAt(0).toUpperCase() : "";

                            if (!display) {
                              if (!fallbackInitial) {
                                return (
                                  <div className="flex h-full w-full items-center justify-center text-zinc-400">
                                    <User className="h-8 w-8" />
                                  </div>
                                );
                              }
                              return (
                                <div className="flex h-full w-full items-center justify-center text-4xl font-semibold text-zinc-700 dark:text-zinc-200 select-none">
                                  {fallbackInitial}
                                </div>
                              );
                            }

                            if (isImage) {
                              return (
                                <img 
                                  src={display} 
                                  alt="Avatar" 
                                  className="h-full w-full object-cover" 
                                />
                              );
                            }

                            return (
                              <div className="flex h-full w-full items-center justify-center text-4xl select-none">
                                {display}
                              </div>
                            );
                          })()}
                        </div>
                        
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col gap-2">
                            <label 
                              htmlFor="avatar-upload"
                              className="cursor-pointer inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-medium text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-600 dark:hover:bg-zinc-700 w-fit"
                            >
                              <Upload className="h-4 w-4" />
                              Upload Image
                            </label>
                            <input
                              id="avatar-upload"
                              type="file"
                              accept="image/*"
                              onChange={handleFileChange}
                              className="hidden"
                            />
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                              JPG, GIF or PNG. Max 2MB.
                            </p>
                          </div>

                          <div className="space-y-1">
                            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Or choose an emoji:</p>
                            <div className="flex flex-wrap gap-2 max-w-[240px]">
                              {['😎', '🤠', '👽', '👻', '🤖', '👾', '🐱', '🐶', '🦄', '🐲', '🦊', '🦁'].map((emoji) => (
                                <button
                                  key={emoji}
                                  onClick={() => handleEmojiSelect(emoji)}
                                  className="flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                  type="button"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4">
                      <button
                        onClick={handleSaveProfile}
                        disabled={savingProfile}
                        className="flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                      >
                        {savingProfile ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        Save Changes
                      </button>
                    </div>

                    {profileMessage && (
                      <div
                        className={`mt-4 rounded-md px-3 py-2 text-sm ${
                          profileMessage.type === "success"
                            ? "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400"
                            : "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        }`}
                      >
                        {profileMessage.text}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "models" && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="mb-6">
                    <h2 className="text-lg font-semibold">Models</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Choose which models appear in your chat model picker.</p>
                  </div>
                  <div className="space-y-2">
                    {MODEL_OPTIONS.map((model) => {
                      const enabled = enabledModelIds.includes(model.id);
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => toggleModel(model.id)}
                          className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors shadow-sm ${
                            enabled
                              ? "border-zinc-200 bg-white text-zinc-900 shadow-md dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:shadow-lg"
                              : "border-zinc-100 bg-zinc-50 text-zinc-600 hover:bg-white hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:shadow-lg"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className={`flex h-5 w-5 items-center justify-center rounded border ${
                                enabled
                                  ? "border-zinc-500 bg-zinc-700 text-white dark:border-zinc-300 dark:bg-zinc-200 dark:text-zinc-900"
                                  : "border-zinc-300 bg-white text-transparent dark:border-zinc-700 dark:bg-zinc-950"
                              }`}
                            >
                              {enabled && <Check className="h-3.5 w-3.5" />}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="font-medium">{model.name}</span>
                              {model.badge && (
                                <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-medium text-black dark:bg-white/10 dark:text-white">
                                  {model.badge}
                                </span>
                              )}
                            </span>
                          </div>
                          <span className="text-xs text-zinc-400">{enabled ? "Enabled" : "Disabled"}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Keep at least one model enabled.</p>
                  <div className="mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-800" />
                </div>
              </div>
            )}

            {activeTab === "skills" && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold">Skills</h2>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">View the server-side skills available in your workspace (Skill Store coming soon).</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => void fetchSkills()}
                        className="rounded-md px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        disabled={skillsLoading}
                      >
                        Refresh
                      </button>
                      {skillsLoading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
                    </div>
                  </div>

                  {skillsError && (
                    <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                      {skillsError}
                    </div>
                  )}

                  <div className="space-y-3">
                    {skills.length === 0 && !skillsLoading ? (
                      <div className="text-sm text-zinc-500">No skills found</div>
                    ) : (
                      skills.map((s) => (
                        (() => {
                          const effectiveConfigured =
                            s.id === "notion-integration" ? Boolean(s.configured || notionTokenSaved) : Boolean(s.configured);
                          const canSetup = !effectiveConfigured && (s.id === "notion-integration" || s.id === "web-verify");
                          return (
                        <div
                          key={s.id}
                          className="flex flex-col gap-2 rounded-lg border border-zinc-100 bg-white p-4 shadow-sm shadow-zinc-200/70 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-md dark:shadow-black/30"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="font-medium text-zinc-900 dark:text-zinc-100">{s.name}</div>
                                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                                  {s.visibility}
                                </span>
                              </div>
                              <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{s.description}</div>
                            </div>
                            <span
                              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                                effectiveConfigured
                                  ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                                  : "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                              }`}
                            >
                              {effectiveConfigured ? "Configured" : "Needs setup"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400">{s.id}</div>
                            <div className="flex shrink-0 items-center gap-2">
                              {canSetup && (
                                <button
                                  type="button"
                                  onClick={() => openSetup(s)}
                                  className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                                >
                                  Setup
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  void navigator.clipboard?.writeText(s.id);
                                }}
                                className="rounded-md px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                              >
                                Copy id
                              </button>
                            </div>
                          </div>
                        </div>
                          );
                        })()
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      {setupSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
            <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Setup: {setupSkill.name}</div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{setupSkill.id}</div>
                </div>
                <button
                  type="button"
                  onClick={closeSetup}
                  className="rounded-md px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="p-4">
              {setupMessage && (
                <div
                  className={`mb-4 rounded-md px-3 py-2 text-sm ${
                    setupMessage.type === "success"
                      ? "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400"
                      : "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                  }`}
                >
                  {setupMessage.text}
                </div>
              )}

              {setupSkill.id === "notion-integration" ? (
                <div className="space-y-4">
                  <div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Notion token</div>
                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Saved locally on this device and sent only when you run the skill.
                    </div>
                    <input
                      value={notionTokenDraft}
                      onChange={(e) => setNotionTokenDraft(e.target.value)}
                      type="password"
                      placeholder="secret_..."
                      className="mt-3 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:ring-zinc-700"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeSetup}
                      className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveNotionSetup}
                      className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : setupSkill.id === "web-verify" ? (
                <div className="space-y-4">
                  <div className="text-sm text-zinc-700 dark:text-zinc-300">
                    This skill runs on the server and requires at least one configured model API key.
                  </div>
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                    NEXT_PUBLIC_CLAUDE_API_KEY / NEXT_PUBLIC_GPT52_API_KEY / NEXT_PUBLIC_OPENROUTER_API_KEY / NEXT_PUBLIC_MINIMAX_API_KEY / NEXT_PUBLIC_KIMI_API_KEY
                  </div>
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={closeSetup}
                      className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      Got it
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
