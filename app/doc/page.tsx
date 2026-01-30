"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Lang = "en" | "zh";

export default function DocPage() {
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
      .catch((err) => console.error("Failed to detect country:", err));
    Promise.resolve().then(() => setLangReady(true));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!langReady) return;
    window.localStorage.setItem("aipersona.doc.lang", lang);
  }, [lang, langReady]);

  const CREDIT_PLANS = useMemo(
    () =>
      lang === "en"
        ? [
            { id: "basic_monthly", name: "Basic · Monthly", price: "$40 / mo", creditsPerMonth: 500, highlight: false },
            { id: "pro_monthly", name: "Pro · Monthly", price: "$100 / mo", creditsPerMonth: 1000, highlight: true },
            { id: "basic_yearly", name: "Basic · Yearly", price: "$400 / yr", creditsPerMonth: 500, highlight: false },
            { id: "pro_yearly", name: "Pro · Yearly", price: "$1000 / yr", creditsPerMonth: 1000, highlight: true },
          ]
        : [
            { id: "basic_monthly", name: "普通会员 · 按月", price: "$40 / 月", creditsPerMonth: 500, highlight: false },
            { id: "pro_monthly", name: "高级会员 · 按月", price: "$100 / 月", creditsPerMonth: 1000, highlight: true },
            { id: "basic_yearly", name: "普通会员 · 年付", price: "$400 / 年", creditsPerMonth: 500, highlight: false },
            { id: "pro_yearly", name: "高级会员 · 年付", price: "$1000 / 年", creditsPerMonth: 1000, highlight: true },
          ],
    [lang]
  );

  const MODEL_PRICING = useMemo(
    () =>
      lang === "en"
        ? [
            { id: "persona-ai", name: "PersonaAI (Gemini 3.0 Pro)", creditsPerK: 0.9, desc: "High-quality reasoning model for content creation and deep analysis." },
            {
              id: "advanced-bundle",
              name: "Nanobanana / GPT5.2 / Gemini3.0 Pro / Minimax M2 / Kimi0905",
              creditsPerK: 0.45,
              desc: "Cost-effective general models for daily Q&A, creative help, and operations advice.",
            },
          ]
        : [
            { id: "persona-ai", name: "PersonaAI（基于 Gemini 3.0 Pro）", creditsPerK: 0.9, desc: "高级推理与创作模型，适合内容生产、深度分析等场景。" },
            {
              id: "advanced-bundle",
              name: "Nanobanana / GPT5.2 / Gemini3.0 Pro / Minimax M2 / Kimi0905",
              creditsPerK: 0.45,
              desc: "高性价比通用模型组合，适合日常问答、创意辅助、运营建议。",
            },
          ],
    [lang]
  );

  const t = useMemo(() => {
    if (lang === "en") {
      return {
        backHome: "← Back to Home",
        header: "Persona AI · Billing & Credits Guide",
        dashboard: "Dashboard",
        toc: "Documentation",
        legal: "Legal",
        terms: "Terms of Service",
        privacy: "Privacy Policy",
        nav: {
          overview: "Overview",
          mintlify: "Mintlify Hosting",
          credits: "1. What are Credits",
          plans: "2. Membership & Monthly Credits",
          models: "3. Model Pricing (Credits)",
          examples: "4. Examples",
          history: "5. Usage & History",
          quickStart: "Quick Start",
          bestPractices: "Best Practices",
          qa: "Q&A / Common Issues",
        },
        overviewTitle: "Billing & Credits Guide",
        overviewIntro:
          "Persona AI uses a 'usage-based billing + Credits quota' model to settle the cost of your LLM operations in Chatbox. This page helps you understand how to purchase Credits, how many Credits are included per membership, and approximate consumption for each model.",
        mintlifyTitle: "Host docs on Mintlify",
        mintlifyIntro:
          "We host the documentation on Mintlify and proxy it to a subpath under our main domain. Follow the Mintlify deployment guide and use the Vercel rewrites below to serve docs at a subpath.",
        mintlifySteps: [
          "Open Mintlify dashboard → Custom domain setup and enable Host at subpath.",
          "Make sure the Mintlify project domain is ready and note the subdomain from the dashboard URL.",
          "Add the rewrites below to vercel.json (replace subdomain and subpath).",
        ],
        mintlifyLinksLabel: "Reference docs",
        mintlifyLinks: [
          {
            label: "Mintlify Vercel subpath guide",
            href: "https://www.mintlify.com/docs/deploy/vercel.md",
          },
          {
            label: "Documentation index (llms.txt)",
            href: "https://www.mintlify.com/docs/llms.txt",
          },
        ],
        mintlifyCode: `{
  "rewrites": [
    {
      "source": "/_mintlify/:path*",
      "destination": "https://[subdomain].mintlify.app/_mintlify/:path*"
    },
    {
      "source": "/api/request",
      "destination": "https://[subdomain].mintlify.app/_mintlify/api/request"
    },
    {
      "source": "/[subpath]",
      "destination": "https://[subdomain].mintlify.app/[subpath]"
    },
    {
      "source": "/[subpath]/llms.txt",
      "destination": "https://[subdomain].mintlify.app/llms.txt"
    },
    {
      "source": "/[subpath]/llms-full.txt",
      "destination": "https://[subdomain].mintlify.app/llms-full.txt"
    },
    {
      "source": "/[subpath]/sitemap.xml",
      "destination": "https://[subdomain].mintlify.app/sitemap.xml"
    },
    {
      "source": "/[subpath]/robots.txt",
      "destination": "https://[subdomain].mintlify.app/robots.txt"
    },
    {
      "source": "/[subpath]/mcp",
      "destination": "https://[subdomain].mintlify.app/mcp"
    },
    {
      "source": "/[subpath]/:path*",
      "destination": "https://[subdomain].mintlify.app/[subpath]/:path*"
    },
    {
      "source": "/mintlify-assets/:path+",
      "destination": "https://[subdomain].mintlify.app/mintlify-assets/:path+"
    }
  ]
}`,
        creditsTitle: "1. What are Credits?",
        creditsBody:
          "Credits represent your LLM usage quota. All chats, generations, and model calls are deducted from Credits according to the tokens used. We measure usage by tokens:",
        creditsBullets: ["Input tokens: content sent to the model (including recent context)", "Output tokens: content returned by the model", "Total cost per round = input tokens + output tokens"],
        plansTitle: "2. Membership & Monthly Credits",
        plansIntro: ["You can purchase or switch membership on the", "Pricing page", "or the", "Billing page", ". Different plans include these monthly Credits:"],
        modelTitle: "3. Model Pricing (Credits per 1,000 tokens)",
        modelIntro: "We convert total tokens for each chat round into Credits by the selected model's unit price. Rules:",
        modelBullets: ["Unit is per 1,000 tokens (partial proportional).", "Total tokens = input + output.", "Different models have different Credits per 1,000 tokens."],
        tableHead: ["Model", "Credits / 1,000 tokens", "Notes"],
        tip: "Note: These rates may be adjusted over time based on upstream cost and product form. We'll keep them stable and update here when necessary.",
        examplesTitle: "4. How many Credits does a typical chat cost?",
        examplesScenario: "Assume you choose PersonaAI (Gemini 3.0 Pro) and run a typical chat:",
        examplesBullets: ["Question + context ≈ 500 tokens", "Model reply ≈ 800 tokens", "Total ≈ 1,300 tokens"],
        examplesCalc: "With PersonaAI 0.9 Credits per 1,000 tokens, the deduction is:",
        examplesResult: "1,300 ÷ 1,000 × 0.9 ≈ 1.17 Credits",
        examplesNote: "So, 500 Credits can support hundreds to thousands of high-quality rounds (depending on output length).",
        historyTitle: "5. Where to check remaining Credits & history?",
        historyBody: [
          "You can always check your Credits balance and a detailed log in-app:",
          "After login, open Settings from the top-right avatar menu.",
          "Switch to the “Usage History” tab to see deductions and changes.",
          "For Team/Enterprise needs (custom quota, isolated model config), contact us for more flexible billing.",
        ],
        quickStartTitle: "Quick Start",
        quickStartBullets: [
          "Enable at least one model in Settings → Models.",
          "Choose PersonaAI for high-quality reasoning, or select a cost-effective model for routine tasks.",
          "Start a chat and watch Credits in Usage History.",
        ],
        bestPracticesTitle: "Best Practices",
        bestBullets: [
          "Keep prompts concise; long context increases input tokens.",
          "Prefer short, focused outputs when possible.",
          "Use PersonaAI for complex tasks; use bundle models for lightweight Q&A.",
        ],
        qaTitle: "Q&A / Common Issues",
        qaBullets: [
          "Why is Credit deduction higher than expected? Check total tokens (input + output).",
          "Model unavailable? Ensure API keys are configured server-side or switch model.",
          "Slow response? Try shorter outputs or change model.",
        ],
      };
    }
    return {
      backHome: "← 回到首页",
      header: "Persona AI · 计费与 Credits 使用说明",
      dashboard: "控制台",
      toc: "文档目录",
      legal: "法律条款",
      terms: "用户协议",
      privacy: "隐私政策",
      nav: {
        overview: "概览",
        mintlify: "Mintlify 托管",
        credits: "1. Credits 是什么",
        plans: "2. 会员与每月 Credits",
        models: "3. 模型扣费标准",
        examples: "4. 实际扣费示例",
        history: "5. 查看用量与历史",
        quickStart: "快速开始",
        bestPractices: "最佳实践",
        qa: "Q&A / 可能遇到的问题",
      },
      overviewTitle: "计费与 Credits 使用说明",
      overviewIntro: "Persona AI 使用「按模型使用量计费 + Credits 额度」的方式，对你在 Chatbox 中调用大模型的开销进行结算。本页面帮助你快速理解：如何购买 Credits、不同会员每月包含多少 Credits，以及每个模型大概消耗多少 Credits。",
      mintlifyTitle: "使用 Mintlify 托管文档",
      mintlifyIntro:
        "我们的文档托管在 Mintlify，通过 Vercel 子路径反向代理到主站域名。请按 Mintlify 的部署指引开启子路径托管，并在 vercel.json 中加入下列 rewrites。",
      mintlifySteps: [
        "进入 Mintlify Dashboard → Custom domain setup，开启 Host at subpath。",
        "确认项目域名可用，并记录 dashboard URL 末尾的 subdomain。",
        "在 vercel.json 中添加下面的 rewrites，替换 subdomain 与 subpath。",
      ],
      mintlifyLinksLabel: "参考文档",
      mintlifyLinks: [
        {
          label: "Vercel 子路径部署指南",
          href: "https://www.mintlify.com/docs/deploy/vercel.md",
        },
        {
          label: "文档索引（llms.txt）",
          href: "https://www.mintlify.com/docs/llms.txt",
        },
      ],
      mintlifyCode: `{
  "rewrites": [
    {
      "source": "/_mintlify/:path*",
      "destination": "https://[subdomain].mintlify.app/_mintlify/:path*"
    },
    {
      "source": "/api/request",
      "destination": "https://[subdomain].mintlify.app/_mintlify/api/request"
    },
    {
      "source": "/[subpath]",
      "destination": "https://[subdomain].mintlify.app/[subpath]"
    },
    {
      "source": "/[subpath]/llms.txt",
      "destination": "https://[subdomain].mintlify.app/llms.txt"
    },
    {
      "source": "/[subpath]/llms-full.txt",
      "destination": "https://[subdomain].mintlify.app/llms-full.txt"
    },
    {
      "source": "/[subpath]/sitemap.xml",
      "destination": "https://[subdomain].mintlify.app/sitemap.xml"
    },
    {
      "source": "/[subpath]/robots.txt",
      "destination": "https://[subdomain].mintlify.app/robots.txt"
    },
    {
      "source": "/[subpath]/mcp",
      "destination": "https://[subdomain].mintlify.app/mcp"
    },
    {
      "source": "/[subpath]/:path*",
      "destination": "https://[subdomain].mintlify.app/[subpath]/:path*"
    },
    {
      "source": "/mintlify-assets/:path+",
      "destination": "https://[subdomain].mintlify.app/mintlify-assets/:path+"
    }
  ]
}`,
      creditsTitle: "1. Credits 是什么？",
      creditsBody: "Credits 可以理解为「大模型调用额度」，所有在 Chatbox 中对话、生成内容、调用模型的行为，都会根据实际使用的 tokens 从 Credits 中扣除。我们按 tokens 计量使用量：",
      creditsBullets: ["输入 tokens：你发送给模型的内容（包括最近对话上下文）", "输出 tokens：模型返回给你的内容", "每一次对话的总消耗 = 输入 tokens + 输出 tokens"],
      plansTitle: "2. 会员与每月可用 Credits",
      plansIntro: ["你可以在", "定价页面", "或", "Billing 页面", "中购买或切换会员。不同会员方案，每个月包含的 Credits 如下："],
      modelTitle: "3. 不同模型的 Credits 扣费标准",
      modelIntro: "我们会根据你选择的模型，对「本轮对话产生的总 tokens 数」按不同单价折算为 Credits。为了让计算简单易懂，我们采用统一的规则：",
      modelBullets: ["以每 1,000 tokens 为计费单位（不足 1,000 按比例计算）。", "总 tokens = 输入 tokens + 输出 tokens。", "不同模型有不同的每 1,000 tokens 消耗 Credits 标准。"],
      tableHead: ["模型", "每 1,000 tokens 消耗", "说明"],
      tip: "提示：上述标准会根据上游模型成本和产品形态适时微调，但我们会尽量保持长期稳定，并在调整时于本页面进行更新。",
      examplesTitle: "4. 实际对话中会扣多少 Credits？",
      examplesScenario: "假设你选择 PersonaAI（基于 Gemini 3.0 Pro），并进行一次典型对话：",
      examplesBullets: ["你发送的问题和上下文合计约 500 tokens", "模型回复内容约 800 tokens", "本轮总 tokens ≈ 1,300 tokens"],
      examplesCalc: "PersonaAI 按每 1,000 tokens 消耗 0.9 Credits 计算，则本轮大约扣除：",
      examplesResult: "1,300 ÷ 1,000 × 0.9 ≈ 1.17 Credits",
      examplesNote: "也就是说，500 Credits 约可以支持几百到上千轮高质量对话（取决于每次生成的内容长短）。",
      historyTitle: "5. 在哪里查看剩余 Credits 与历史消耗？",
      historyBody: ["你可以在应用内随时查看自己的 Credits 余额和详细的使用记录：", "登录后，进入右上角头像菜单中的 Settings。", "切换到「Usage History」标签页，可以看到每次扣费记录与 Credits 变化。", "如果你有团队版或企业版需求（自定义配额、独立模型配置等），可以通过站内反馈或邮件联系我们，我们会根据你的场景提供更灵活的计费方案。"],
      quickStartTitle: "快速开始",
      quickStartBullets: ["在 Settings → Models 启用至少一个模型。", "复杂任务优先选择 PersonaAI；日常任务选择性价比更高的模型。", "开始对话后在 Usage History 查看 Credits。"],
      bestPracticesTitle: "最佳实践",
      bestBullets: ["保持提示词精炼，过长上下文会增加输入 tokens。", "输出尽量简短聚焦。", "复杂任务用 PersonaAI，轻量问答用组合模型。"],
      qaTitle: "Q&A / 可能遇到的问题",
      qaBullets: ["扣费高于预期？请检查总 tokens（输入 + 输出）。", "模型不可用？请确认服务端已配置 API Key，或切换模型。", "响应较慢？尝试缩短输出或更换模型。"],
    };
  }, [lang]);

  return (
    <div className="min-h-screen bg-white text-zinc-900 dark:bg-black dark:text-zinc-50">
      <header className="sticky top-0 z-50 border-b border-zinc-100 bg-white/80 px-6 py-4 backdrop-blur-md dark:border-zinc-800 dark:bg-black/80 lg:px-12">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/landing" className="text-sm font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50">
            {t.backHome}
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t.header}</div>
            <div className="flex items-center rounded-md border border-zinc-200 bg-white text-xs dark:border-zinc-700 dark:bg-zinc-950">
              <button
                type="button"
                onClick={() => setLang("en")}
                className={`px-2 py-1 ${lang === "en" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-700 dark:text-zinc-300"}`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLang("zh")}
                className={`px-2 py-1 ${lang === "zh" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-700 dark:text-zinc-300"}`}
              >
                中文
              </button>
            </div>
            <div className="hidden items-center gap-3 text-xs text-zinc-600 dark:text-zinc-300 sm:flex">
              <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-zinc-50">
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
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t.toc}</div>
              <nav className="mt-4 space-y-1">
                <a href="#overview" className="block rounded-md px-2 py-1 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
                  {t.nav.overview}
                </a>
                <a href="#quick-start" className="block rounded-md px-2 py-1 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
                  {t.nav.quickStart}
                </a>
                <a href="#best-practices" className="block rounded-md px-2 py-1 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
                  {t.nav.bestPractices}
                </a>
                <a href="#qa" className="block rounded-md px-2 py-1 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
                  {t.nav.qa}
                </a>
                <a href="#mintlify" className="block rounded-md px-2 py-1 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
                  {t.nav.mintlify}
                </a>
                <a href="#credits" className="block rounded-md px-2 py-1 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
                  {t.nav.credits}
                </a>
                <a href="#plans" className="block rounded-md px-2 py-1 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
                  {t.nav.plans}
                </a>
                <a href="#models" className="block rounded-md px-2 py-1 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
                  {t.nav.models}
                </a>
                <a href="#examples" className="block rounded-md px-2 py-1 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
                  {t.nav.examples}
                </a>
                <a href="#history" className="block rounded-md px-2 py-1 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50">
                  {t.nav.history}
                </a>
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
                    className="block rounded-md px-2 py-1 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                  >
                    {t.privacy}
                  </Link>
                </div>
              </nav>
            </div>
          </aside>

          <div className="min-w-0 flex-1 space-y-12">
            <section id="overview" className="space-y-4">
              <h1 className="font-serif text-3xl font-bold tracking-tight sm:text-4xl">{t.overviewTitle}</h1>
              <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">{t.overviewIntro}</p>
            </section>

            <section id="mintlify" className="space-y-4">
              <h2 className="text-xl font-semibold tracking-tight">{t.mintlifyTitle}</h2>
              <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">{t.mintlifyIntro}</p>
              <ol className="ml-5 list-decimal space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                {t.mintlifySteps.map((step, i) => (
                  <li key={`mint-step-${i}`}>{step}</li>
                ))}
              </ol>
              <div className="space-y-2 text-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t.mintlifyLinksLabel}</div>
                <div className="flex flex-wrap gap-3">
                  {t.mintlifyLinks.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-50"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
              <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 text-xs text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                <div className="border-b border-zinc-200 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  vercel.json
                </div>
                <pre className="overflow-x-auto px-4 py-3 leading-relaxed">
                  <code>{t.mintlifyCode}</code>
                </pre>
              </div>
            </section>

            <section id="quick-start" className="space-y-3">
              <h2 className="text-xl font-semibold tracking-tight">{t.quickStartTitle}</h2>
              <ul className="ml-5 list-disc space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                {t.quickStartBullets.map((b, i) => (
                  <li key={`qs-${i}`}>{b}</li>
                ))}
              </ul>
            </section>

            <section id="best-practices" className="space-y-3">
              <h2 className="text-xl font-semibold tracking-tight">{t.bestPracticesTitle}</h2>
              <ul className="ml-5 list-disc space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                {t.bestBullets.map((b, i) => (
                  <li key={`bp-${i}`}>{b}</li>
                ))}
              </ul>
            </section>

            <section id="qa" className="space-y-3">
              <h2 className="text-xl font-semibold tracking-tight">{t.qaTitle}</h2>
              <ul className="ml-5 list-disc space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                {t.qaBullets.map((b, i) => (
                  <li key={`qa-${i}`}>{b}</li>
                ))}
              </ul>
            </section>

            <section id="credits" className="space-y-4">
              <h2 className="text-xl font-semibold tracking-tight">{t.creditsTitle}</h2>
              <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
                <p>{t.creditsBody}</p>
                <ul className="ml-5 list-disc space-y-1">
                  {t.creditsBullets.map((b, i) => (
                    <li key={`cb-${i}`}>{b}</li>
                  ))}
                </ul>
              </div>
            </section>

            <section id="plans" className="space-y-4">
              <h2 className="text-xl font-semibold tracking-tight">{t.plansTitle}</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {t.plansIntro[0]}{" "}
                <Link href="/pricing" className="mx-1 underline underline-offset-4">
                  {t.plansIntro[1]}
                </Link>{" "}
                {t.plansIntro[2]}{" "}
                <Link href="/billing" className="mx-1 underline underline-offset-4">
                  {t.plansIntro[3]}
                </Link>{" "}
                {t.plansIntro[4]}
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {CREDIT_PLANS.map((plan) => (
                  <div
                    key={plan.id}
                    className={`rounded-2xl border p-5 text-sm shadow-sm dark:border-zinc-800 ${
                      plan.highlight ? "border-zinc-900 bg-zinc-900 text-zinc-50 dark:border-zinc-100" : "border-zinc-200 bg-white text-zinc-900 dark:bg-zinc-950"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-base font-semibold tracking-tight">{plan.name}</div>
                      <div className="text-sm font-semibold">{plan.price}</div>
                    </div>
                    <div className="mt-2 text-sm">
                      {lang === "en" ? "Includes " : "每个月包含"}{" "}
                      <span className="font-semibold">{plan.creditsPerMonth} Credits</span>
                      {lang === "en" ? "" : "。"}
                    </div>
                    <ul className="mt-3 space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                      {lang === "en" ? (
                        <>
                          <li>· Overages are deducted based on actual usage</li>
                          <li>· Yearly plan is billed annually, Credits are issued monthly</li>
                        </>
                      ) : (
                        <>
                          <li>· 超出部分按实际使用量从 Credits 中扣除</li>
                          <li>· 年付方案按年一次性支付，每月自动发放对应 Credits</li>
                        </>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            <section id="models" className="space-y-4">
              <h2 className="text-xl font-semibold tracking-tight">{t.modelTitle}</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.modelIntro}</p>
              <ul className="ml-5 list-disc space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                {t.modelBullets.map((b, i) => (
                  <li key={`mb-${i}`}>{b}</li>
                ))}
              </ul>

              <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                <div className="grid grid-cols-3 border-b border-zinc-100 bg-zinc-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  <div>{t.tableHead[0]}</div>
                  <div>{t.tableHead[1]}</div>
                  <div>{t.tableHead[2]}</div>
                </div>
                {MODEL_PRICING.map((m) => (
                  <div key={m.id} className="grid grid-cols-3 border-t border-zinc-100 px-4 py-3 text-sm dark:border-zinc-800">
                    <div className="pr-4 font-medium">{m.name}</div>
                    <div className="pr-4">
                      <span className="font-semibold">{m.creditsPerK}</span> Credits / 1,000 tokens
                    </div>
                    <div className="text-zinc-600 dark:text-zinc-300">{m.desc}</div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-zinc-500 dark:text-zinc-400">{t.tip}</p>
            </section>

            <section id="examples" className="space-y-4">
              <h2 className="text-xl font-semibold tracking-tight">{t.examplesTitle}</h2>
              <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
                <p>{t.examplesScenario}</p>
                <ul className="ml-5 list-disc space-y-1">
                  {t.examplesBullets.map((b, i) => (
                    <li key={`ex-${i}`}>{b}</li>
                  ))}
                </ul>
                <p className="mt-1">{t.examplesCalc}</p>
                <p className="rounded-lg bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">{t.examplesResult}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{t.examplesNote}</p>
              </div>
            </section>

            <section id="history" className="space-y-4">
              <h2 className="text-xl font-semibold tracking-tight">{t.historyTitle}</h2>
              <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
                <ul className="ml-5 list-disc space-y-1">
                  {t.historyBody.map((b, i) => (
                    <li key={`hb-${i}`}>{b}</li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
