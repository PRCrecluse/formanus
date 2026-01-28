"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Apple } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "apple" | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const router = useRouter();
  const debugEnabled = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEBUG_AUTH === "1";
  const debug = (event: string, data?: unknown) => {
    if (!debugEnabled) return;
    console.log(`[auth/login] ${event}`, data ?? "");
  };

  useEffect(() => {
    router.prefetch("/");
  }, [router]);

  const handleOAuthLogin = async (provider: "google" | "apple") => {
    try {
      setMessage(null);
      setOauthLoading(provider);
      const origin =
        (process.env.NEXT_PUBLIC_SITE_URL ?? "").toString().trim() ||
        (typeof window !== "undefined" ? window.location.origin : "");
      const redirectTo = `${origin}/auth/callback`;
      debug("oauth_start", { provider, redirectTo });
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });
      debug("oauth_result", {
        provider,
        hasUrl: Boolean(data?.url),
        url: data?.url ?? null,
        hasError: Boolean(error),
        error: error ? { message: error.message, name: error.name, status: error.status } : null,
      });
      if (error) throw error;
      if (data?.url) {
        window.location.assign(data.url);
      } else {
        throw new Error("Missing OAuth redirect URL");
      }
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Login failed";
      debug("oauth_throw", { provider, text, error });
      setMessage({ type: "error", text });
      setOauthLoading(null);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const origin =
        (process.env.NEXT_PUBLIC_SITE_URL ?? "").toString().trim() ||
        (typeof window !== "undefined" ? window.location.origin : "");
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${origin}/auth/callback`,
        },
      });

      if (error) throw error;

      setMessage({
        type: "success",
        text: "Check your email for the login link!",
      });
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Login failed";
      setMessage({ type: "error", text });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-white text-zinc-900 selection:bg-zinc-900 selection:text-white dark:bg-zinc-950 dark:text-zinc-50 dark:selection:bg-white dark:selection:text-black">
      {/* Navbar (Minimal) */}
      <nav className="fixed top-0 z-50 flex w-full items-center justify-between px-6 py-4 lg:px-12">
        <Link href="/landing" className="flex items-center gap-2">
           <div className="relative h-8 w-8 overflow-hidden rounded-md flex items-center justify-center">
                <Image src="/logo-dark-icon.png" alt="Persona AI" fill sizes="32px" className="object-contain dark:hidden" />
                <Image src="/logo-light-icon.png" alt="Persona AI" fill sizes="32px" className="object-contain hidden dark:block" />
           </div>
           <span className="font-serif text-lg font-bold tracking-tight">Persona AI</span>
        </Link>
      </nav>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-20">
        <div className="w-full max-w-[400px] animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 relative h-12 w-12 overflow-hidden rounded-lg flex items-center justify-center">
                 <Image src="/logo-dark-icon.png" alt="Persona AI" fill sizes="48px" className="object-contain dark:hidden" />
                 <Image src="/logo-light-icon.png" alt="Persona AI" fill sizes="48px" className="object-contain hidden dark:block" />
            </div>
            <h1 className="mb-2 font-serif text-2xl font-bold tracking-tight sm:text-3xl">
              Log in to Persona AI
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400">
              Welcome back! Please enter your details.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => handleOAuthLogin("google")}
              disabled={oauthLoading !== null}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-200 focus:ring-offset-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:focus:ring-zinc-700 dark:focus:ring-offset-zinc-950 transition-all"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              {oauthLoading === "google" ? "Redirecting..." : "Continue with Google"}
            </button>

            <button
              onClick={() => handleOAuthLogin("apple")}
              disabled={oauthLoading !== null}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-200 focus:ring-offset-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:focus:ring-zinc-700 dark:focus:ring-offset-zinc-950 transition-all"
            >
              <Apple className="h-5 w-5 text-black dark:text-white" />
              {oauthLoading === "apple" ? "Redirecting..." : "Continue with Apple"}
            </button>
          </div>

          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-zinc-200 dark:border-zinc-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                or continue with
              </span>
            </div>
          </div>

          <form onSubmit={handleEmailLogin} className="flex flex-col gap-4">
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Email
              </label>
              <input
                id="email"
                type="email"
                placeholder="Enter your email address..."
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-blue-500 dark:focus:ring-blue-500"
              />
            </div>

            {message && (
              <div
                className={`rounded-lg p-3 text-sm ${
                  message.type === "success"
                    ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                    : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                }`}
              >
                {message.text}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#2480DE] py-2.5 text-sm font-medium text-white hover:bg-[#1b6cb8] focus:outline-none focus:ring-2 focus:ring-[#2480DE] focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-zinc-950"
            >
              {loading ? "Sending link..." : "Continue with Email"}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
            By continuing, you agree to our{" "}
            <Link href="/terms" className="underline hover:text-zinc-900 dark:hover:text-zinc-50">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline hover:text-zinc-900 dark:hover:text-zinc-50">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
