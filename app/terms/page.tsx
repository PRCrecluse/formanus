"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Lang = "en" | "zh";

export default function TermsPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [langReady, setLangReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("aipersona.doc.lang");
    if (stored === "zh" || stored === "en") {
      Promise.resolve().then(() => {
        setLang(stored);
        setLangReady(true);
      });
      return;
    }

    fetch("https://api.country.is")
      .then((res) => res.json())
      .then((data) => {
        if (data && data.country === "CN") {
          setLang("zh");
        }
      })
      .catch(() => void 0);
    Promise.resolve().then(() => setLangReady(true));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!langReady) return;
    window.localStorage.setItem("aipersona.doc.lang", lang);
  }, [lang, langReady]);

  const t = useMemo(() => {
    if (lang === "zh") {
      return {
        backHome: "← 回到首页",
        header: "Persona AI · 用户协议",
        dashboard: "控制台",
        toc: "文档目录",
        legal: "法律条款",
        terms: "用户协议",
        privacy: "隐私政策",
        docNav: {
          overview: "概览",
          quickStart: "快速开始",
          bestPractices: "最佳实践",
          qa: "Q&A / 可能遇到的问题",
          credits: "Credits 是什么",
          plans: "会员与每月 Credits",
          models: "模型扣费标准",
          examples: "实际扣费示例",
          history: "查看用量与历史",
        },
        title: "用户协议（Terms of Service）",
        updatedAt: "最后更新：2026-01-28",
        sections: [
          {
            title: "1. 协议适用范围",
            body: [
              "本协议适用于你使用 Persona AI（包括网站、应用与相关服务）的全部行为。",
              "你使用服务即表示同意本协议及其不时更新的版本。",
            ],
          },
          {
            title: "2. 账户与登录",
            body: [
              "你需要提供有效的登录方式并对账户下的行为负责。",
              "如发现未授权使用，请及时联系我们。",
            ],
          },
          {
            title: "3. 服务与计费",
            body: [
              "服务可能包含付费功能（如会员与 Credits）。具体以产品页面展示为准。",
              "我们可能根据上游成本与产品形态调整价格或配额，并在相关页面更新。",
            ],
          },
          {
            title: "4. 内容与合规",
            body: [
              "你对你输入与生成的内容承担责任，并保证其合法合规。",
              "禁止使用服务从事违法、侵权、骚扰、欺诈或其他不当行为。",
            ],
          },
          {
            title: "5. 免责声明",
            body: [
              "模型输出可能存在错误或不完整，仅供参考，不构成专业建议。",
              "对因使用输出造成的损失，我们在法律允许范围内不承担责任。",
            ],
          },
          {
            title: "6. 联系方式",
            body: ["如对本协议有疑问，请通过站内反馈或邮件与我们联系。"],
          },
        ],
      };
    }

    return {
      backHome: "← Back to Home",
      header: "Persona AI · Terms of Service",
      dashboard: "Dashboard",
      toc: "Documentation",
      legal: "Legal",
      terms: "Terms of Service",
      privacy: "Privacy Policy",
      docNav: {
        overview: "Overview",
        quickStart: "Quick Start",
        bestPractices: "Best Practices",
        qa: "Q&A / Common Issues",
        credits: "What are Credits",
        plans: "Membership & Monthly Credits",
        models: "Model Pricing",
        examples: "Examples",
        history: "Usage & History",
      },
      title: "Terms of Service",
      updatedAt: "Last updated: 2026-01-28",
      sections: [
        {
          title: "1. Scope",
          body: [
            "These Terms apply to your use of Persona AI (website, apps, and related services).",
            "By using the Service, you agree to these Terms and future updates.",
          ],
        },
        {
          title: "2. Accounts",
          body: [
            "You are responsible for activities under your account.",
            "Contact us promptly if you suspect unauthorized access.",
          ],
        },
        {
          title: "3. Service & Billing",
          body: [
            "Some features may be paid (e.g., membership and Credits). Details are shown in-product.",
            "We may adjust pricing or quotas based on upstream costs and product updates.",
          ],
        },
        {
          title: "4. Content & Compliance",
          body: [
            "You are responsible for your inputs and outputs and must comply with applicable laws.",
            "Do not use the Service for unlawful, infringing, harassing, fraudulent, or abusive activities.",
          ],
        },
        {
          title: "5. Disclaimers",
          body: [
            "Model outputs may be inaccurate or incomplete and are provided for informational purposes only.",
            "To the extent permitted by law, we are not liable for losses arising from reliance on outputs.",
          ],
        },
        {
          title: "6. Contact",
          body: ["If you have questions about these Terms, contact us via in-app feedback or email."],
        },
      ],
    };
  }, [lang]);

  const navLinks = useMemo(
    () => [
      { href: "/doc#overview", label: t.docNav.overview },
      { href: "/doc#quick-start", label: t.docNav.quickStart },
      { href: "/doc#best-practices", label: t.docNav.bestPractices },
      { href: "/doc#qa", label: t.docNav.qa },
      { href: "/doc#credits", label: t.docNav.credits },
      { href: "/doc#plans", label: t.docNav.plans },
      { href: "/doc#models", label: t.docNav.models },
      { href: "/doc#examples", label: t.docNav.examples },
      { href: "/doc#history", label: t.docNav.history },
    ],
    [t]
  );

  return (
    <div className="min-h-screen bg-white text-zinc-900 dark:bg-black dark:text-zinc-50">
      <header className="sticky top-0 z-50 border-b border-zinc-100 bg-white/80 px-6 py-4 backdrop-blur-md dark:border-zinc-800 dark:bg-black/80 lg:px-12">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link
            href="/landing"
            className="text-sm font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
          >
            {t.backHome}
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t.header}</div>
            <div className="flex items-center rounded-md border border-zinc-200 bg-white text-xs dark:border-zinc-700 dark:bg-zinc-950">
              <button
                type="button"
                onClick={() => setLang("en")}
                className={`px-2 py-1 ${
                  lang === "en"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLang("zh")}
                className={`px-2 py-1 ${
                  lang === "zh"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                中文
              </button>
            </div>
            <div className="hidden items-center gap-3 text-xs text-zinc-600 dark:text-zinc-300 sm:flex">
              <Link href="/terms" className="font-semibold text-zinc-900 dark:text-zinc-50">
                {t.terms}
              </Link>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <Link href="/privacy" className="hover:text-zinc-900 dark:hover:text-zinc-50">
                {t.privacy}
              </Link>
            </div>
            <Link
              href="/board"
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {t.dashboard}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl px-6 pb-24 pt-10 lg:px-12">
        <div className="relative flex w-full flex-col md:flex-row md:gap-10">
          <aside className="hidden w-60 shrink-0 border-r border-zinc-100 pr-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300 md:block">
            <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {t.toc}
              </div>
              <nav className="mt-4 space-y-1">
                {navLinks.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block rounded-md px-2 py-1 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                  >
                    {item.label}
                  </Link>
                ))}
                <div className="pt-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {t.legal}
                  </div>
                  <Link
                    href="/terms"
                    className="block rounded-md bg-zinc-100 px-2 py-1 font-medium text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50"
                  >
                    {t.terms}
                  </Link>
                  <Link
                    href="/privacy"
                    className="block rounded-md px-2 py-1 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                  >
                    {t.privacy}
                  </Link>
                </div>
              </nav>
            </div>
          </aside>

          <div className="min-w-0 flex-1 space-y-8">
            <section className="space-y-3">
              <h1 className="font-serif text-3xl font-bold tracking-tight sm:text-4xl">{t.title}</h1>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{t.updatedAt}</div>
            </section>

            <div className="space-y-8">
              {t.sections.map((s) => (
                <section key={s.title} className="space-y-3">
                  <h2 className="text-xl font-semibold tracking-tight">{s.title}</h2>
                  <ul className="ml-5 list-disc space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                    {s.body.map((b, i) => (
                      <li key={`${s.title}-${i}`}>{b}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

