"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [errorText, setErrorText] = useState<string | null>(null);
  const didRunRef = useRef(false);

  useEffect(() => {
    if (didRunRef.current) return;
    didRunRef.current = true;

    const run = async () => {
      setErrorText(null);

      const debugEnabled =
        process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEBUG_AUTH === "1";
      const debug = (event: string, data?: unknown) => {
        if (!debugEnabled) return;
        console.log(`[auth/callback] ${event}`, data ?? "");
      };

      debug("start", { href: window.location.href, search: window.location.search, hash: window.location.hash });

      const params = new URLSearchParams(window.location.search);
      if (window.location.hash?.length) {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        hashParams.forEach((value, key) => {
          if (!params.has(key)) params.set(key, value);
        });
      }

      const code = params.get("code");
      const error = params.get("error");
      const errorCode = params.get("error_code");
      const errorDescription = params.get("error_description");

      if (error) {
        debug("provider_error", { error, errorCode, errorDescription });
        setErrorText(`${errorDescription || error}${errorCode ? ` (${errorCode})` : ""}`);
        return;
      }

      const sessionRes = await supabase.auth.getSession();
      debug("pre_exchange_session", { hasSession: Boolean(sessionRes.data.session) });
      if (sessionRes.data.session) {
        router.replace("/");
        return;
      }

      if (code) {
        const storageKey = "auth:callback:last_code";
        const lastCode = typeof window !== "undefined" ? window.sessionStorage.getItem(storageKey) : null;
        debug("code_detected", { hasCode: true, sameAsLast: lastCode === code });

        try {
          window.history.replaceState({}, document.title, window.location.pathname);
        } catch {
          // ignore
        }

        if (lastCode === code) {
          const afterRes = await supabase.auth.getSession();
          debug("skip_exchange_same_code", { hasSession: Boolean(afterRes.data.session) });
          if (afterRes.data.session) {
            router.replace("/");
            return;
          }
          setErrorText("Authentication failed: OAuth code already consumed. Please try again.");
          return;
        }

        window.sessionStorage.setItem(storageKey, code);
        const res = await supabase.auth.exchangeCodeForSession(code);
        debug("exchange_result", {
          error: res.error ? { message: res.error.message, name: res.error.name, status: res.error.status } : null,
          hasSession: Boolean(res.data.session),
          hasUser: Boolean(res.data.user),
        });
        if (res.error) {
          const afterRes = await supabase.auth.getSession();
          debug("post_error_session", { hasSession: Boolean(afterRes.data.session) });
          if (afterRes.data.session) {
            router.replace("/");
            return;
          }
          setErrorText(res.error.message);
          return;
        }
      } else if (window.location.hash && window.location.hash.includes("access_token")) {
         // Implicit flow / Magic Link tokens in hash
         debug("hash_token_detected", {});
         // Allow some time for the supabase client to process the hash
         setTimeout(async () => {
             const { data } = await supabase.auth.getSession();
             debug("post_hash_wait_session", { hasSession: Boolean(data.session) });
             if (data.session) {
                 router.replace("/");
             } else {
                 // Fallback: try to manually setup session if needed, but client should handle it
                 setErrorText("Failed to process login tokens.");
             }
         }, 500);
         return;
      }

      router.replace("/");
    };

    void run();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-sm font-medium">
          {errorText ? "Authentication failed" : "Signing you in..."}
        </div>
        {errorText && (
          <div className="mt-2 text-xs text-red-600 dark:text-red-400">
            {errorText}
          </div>
        )}
      </div>
    </div>
  );
}
