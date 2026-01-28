"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Lang = "en" | "zh";

export default function PrivacyPage() {
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
        header: "Persona AI · 隐私政策",
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
        title: "隐私政策（Privacy Policy）",
        updatedAt: "最后更新：2026-01-28",
        sections: [
          {
            title: "1. 我们收集的信息",
            body: [
              "账户信息：如邮箱、第三方登录标识等。",
              "使用信息：如功能使用记录、日志、设备与浏览器信息等。",
              "内容数据：你输入的提示词与生成的内容可能会用于提供与改进服务。",
            ],
          },
          {
            title: "2. 信息的使用方式",
            body: [
              "用于提供、维护与改进产品功能与体验。",
              "用于计费、风控与安全防护。",
              "用于客服支持与问题排查。",
            ],
          },
          {
            title: "3. 信息共享与披露",
            body: [
              "我们可能与用于提供服务的第三方基础设施/模型提供方共享必要信息（例如模型推理所需的输入）。",
              "除法律法规要求或为保护用户与服务安全外，我们不会出售你的个人信息。",
            ],
          },
          {
            title: "4. 数据保存与安全",
            body: [
              "我们会在实现服务目的所需的期限内保存数据。",
              "我们会采取合理的技术与组织措施保护数据安全，但无法保证绝对安全。",
            ],
          },
          {
            title: "5. 你的权利",
            body: [
              "你可以在适用法律下请求访问、更正、删除你的个人信息。",
              "你可以通过站内反馈或邮件联系我们处理相关请求。",
            ],
          },
          {
            title: "6. 联系方式",
            body: ["如对本隐私政策有疑问，请通过站内反馈或邮件与我们联系。"],
          },
        ],
      };
    }

    return {
      backHome: "← Back to Home",
      header: "Persona AI · Privacy Policy",
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
      title: "Privacy Policy",
      updatedAt: "Last updated: 2026-01-28",
      sections: [
        {
          title: "1. Information We Collect",
          body: [
            "Account information: such as email and third-party auth identifiers.",
            "Usage information: logs, feature usage, device and browser signals.",
            "Content data: your prompts and generated outputs may be processed to provide and improve the Service.",
          ],
        },
        {
          title: "2. How We Use Information",
          body: [
            "Provide, maintain, and improve product features and experience.",
            "Billing, fraud prevention, and security protection.",
            "Customer support and troubleshooting.",
          ],
        },
        {
          title: "3. Sharing & Disclosure",
          body: [
            "We may share necessary information with service providers (e.g., model providers for inference).",
            "We do not sell your personal information, except as required by law or to protect users and the Service.",
          ],
        },
        {
          title: "4. Retention & Security",
          body: [
            "We retain data for as long as needed to fulfill the purposes described.",
            "We use reasonable safeguards, but cannot guarantee absolute security.",
          ],
        },
        {
          title: "5. Your Rights",
          body: [
            "You may request access, correction, or deletion of personal information where applicable.",
            "Contact us via in-app feedback or email to make requests.",
          ],
        },
        {
          title: "6. Contact",
          body: ["If you have questions about this Privacy Policy, contact us via in-app feedback or email."],
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
              <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-zinc-50">
                {t.terms}
              </Link>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <Link href="/privacy" className="font-semibold text-zinc-900 dark:text-zinc-50">
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
                    className="block rounded-md px-2 py-1 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                  >
                    {t.terms}
                  </Link>
                  <Link
                    href="/privacy"
                    className="block rounded-md bg-zinc-100 px-2 py-1 font-medium text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50"
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

