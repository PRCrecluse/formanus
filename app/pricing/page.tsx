"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type PlanId = "basic_monthly" | "basic_yearly" | "pro_monthly" | "pro_yearly";

const LIVE_PLAN_CHECKOUT_URLS: Record<PlanId, string> = {
  basic_monthly: "https://buy.stripe.com/3cI14o6VCevr0mvcoI5ZC00",
  pro_monthly: "https://buy.stripe.com/6oUcN65Ry9b7gltbkE5ZC01",
  basic_yearly: "https://buy.stripe.com/bJedRafs8gDz7OX1K45ZC02",
  pro_yearly: "https://buy.stripe.com/5kQ3cwdk05YV1qzewQ5ZC03",
};

const TEST_PLAN_CHECKOUT_URLS: Partial<Record<PlanId, string>> = {
  basic_monthly: "https://buy.stripe.com/test_00w14pccc21PbclfyO2B200",
  basic_yearly: "https://buy.stripe.com/test_3cI28t2BCayl4NXdqG2B202",
  pro_yearly: "https://buy.stripe.com/test_00w28ta449uhgwFfyO2B203",
  pro_monthly: "https://buy.stripe.com/test_cNibJ3gss5e10xH86m2B201",
};

const STRIPE_ENV = process.env.NEXT_PUBLIC_STRIPE_ENV ?? "";
const useTestStripeLinks = STRIPE_ENV === "test";

const monthlyPlans = [
  {
    id: "basic_monthly" as const,
    title: "Basic Plan",
    price: "$40",
    cadence: "/mo",
    recommended: false,
    features: [
      "500 credits per month",
      "Create up to 5 personas",
      "Basic social media operation advice",
      "Social media calendar and reminders",
    ],
  },
  {
    id: "pro_monthly" as const,
    title: "Pro Plan",
    price: "$100",
    cadence: "/mo",
    recommended: true,
    features: [
      "1000 credits per month",
      "Unlimited personas",
      "Professional social media operation advice",
      "Social media calendar and reminders",
    ],
  },
];

const yearlyPlans = [
  {
    id: "basic_yearly" as const,
    title: "Basic Plan",
    price: "$400",
    cadence: "/yr",
    recommended: false,
    features: [
      "500 credits per month",
      "Create up to 5 personas",
      "Basic social media operation advice",
      "Social media calendar and reminders",
    ],
  },
  {
    id: "pro_yearly" as const,
    title: "Pro Plan",
    price: "$1000",
    cadence: "/yr",
    recommended: true,
    features: [
      "1000 credits per month",
      "Unlimited personas",
      "Professional social media operation advice",
      "Social media calendar and reminders",
    ],
  },
];

function PlanCard({
  title,
  price,
  cadence,
  recommended,
  features,
  checkoutUrl,
}: {
  title: string;
  price: string;
  cadence: string;
  recommended: boolean;
  features: string[];
  checkoutUrl: string | null;
}) {
  return (
    <div
      className={`relative w-full rounded-2xl border bg-white p-6 shadow-sm transition-colors dark:bg-zinc-950 ${
        recommended
          ? "border-zinc-900 dark:border-zinc-200"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="text-lg font-semibold tracking-tight">{title}</div>
        {recommended && (
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-white dark:bg-white dark:text-black">
            Recommended
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <div className="text-3xl font-semibold tracking-tight">{price}</div>
        <div className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {cadence}
        </div>
      </div>
      <div className="mt-5 space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
        {features.map((f) => (
          <div key={f} className="flex items-start gap-2">
            <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-zinc-900 dark:bg-zinc-200" />
            <span className="leading-5">{f}</span>
          </div>
        ))}
      </div>
      {checkoutUrl ? (
        <a
          href={checkoutUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`mt-6 inline-flex w-full items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            recommended
              ? "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
          }`}
        >
          Subscribe
        </a>
      ) : (
        <Link
          href="/login"
          className={`mt-6 inline-flex w-full items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            recommended
              ? "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
          }`}
        >
          Log in to subscribe
        </Link>
      )}
    </div>
  );
}

export default function PricingPage() {
  const [activeCycle, setActiveCycle] = useState<"monthly" | "yearly">("monthly");
  const [userId, setUserId] = useState<string | null>(null);

  const sectionTitle = useMemo(() => {
    return activeCycle === "monthly" ? "Personal plans · Monthly" : "Personal plans · Yearly";
  }, [activeCycle]);

  const buildCheckoutUrl = (planId: PlanId): string | null => {
    const baseUrl =
      (useTestStripeLinks ? TEST_PLAN_CHECKOUT_URLS[planId] : undefined) ??
      LIVE_PLAN_CHECKOUT_URLS[planId];
    if (!baseUrl) return null;
    if (!userId) return baseUrl;
    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}client_reference_id=${encodeURIComponent(userId)}`;
  };

  useEffect(() => {
    const run = async () => {
      const sessionRes = await supabase.auth.getSession();
      const userId = sessionRes.data.session?.user?.id ?? null;
      setUserId(userId);
    };
    void run();
  }, []);

  return (
    <div className="min-h-screen bg-white text-zinc-900 dark:bg-black dark:text-zinc-50">
      <nav className="fixed top-0 z-50 flex w-full items-center justify-between border-b border-zinc-100 bg-white/80 px-6 py-4 backdrop-blur-md dark:border-zinc-800 dark:bg-black/80 lg:px-12">
        <Link href="/landing" className="flex items-center gap-2">
          <div className="relative h-8 w-8 overflow-hidden rounded-md">
            <Image
              src="/logo-dark-icon.png"
              alt="Persona AI"
              fill
              sizes="32px"
              className="object-contain dark:hidden"
            />
            <Image
              src="/logo-light-icon.png"
              alt="Persona AI"
              fill
              sizes="32px"
              className="hidden object-contain dark:block"
            />
          </div>
          <span className="font-serif text-lg font-bold tracking-tight">
            Persona AI
          </span>
        </Link>

        <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-8 text-base font-bold text-zinc-900 dark:text-zinc-50 md:flex">
          <Link href="/pricing" className="transition-opacity hover:opacity-70">
            Pricing
          </Link>
          <Link href="/use-cases" className="transition-opacity hover:opacity-70">
            Use cases
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/doc" className="transition-opacity hover:opacity-70">
                Doc
            </Link>
            <Link href="/blog" className="transition-opacity hover:opacity-70">
                Blog
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="hidden text-sm font-medium hover:text-zinc-600 dark:hover:text-zinc-300 md:block"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-[#0070f3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0060df]"
          >
            Sign up
          </Link>
        </div>
      </nav>

      <main className="mx-auto flex w-full max-w-6xl flex-col px-6 pb-24 pt-28 lg:px-12">
        <div className="flex flex-col items-center text-center">
          <h1 className="font-serif text-5xl font-bold tracking-tight sm:text-6xl">
            Pricing
          </h1>
          <div className="mt-6">
            <div className="relative inline-flex items-center rounded-full border border-zinc-200 bg-white p-1 text-sm font-semibold text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
              <div
                className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-zinc-100 shadow-sm transition-transform duration-300 ease-out dark:bg-zinc-900 ${
                  activeCycle === "monthly" ? "translate-x-0" : "translate-x-full"
                }`}
              />
              <button
                type="button"
                aria-pressed={activeCycle === "monthly"}
                onClick={() => setActiveCycle("monthly")}
                className="relative z-10 rounded-full px-4 py-2 transition-colors hover:text-zinc-900 dark:hover:text-zinc-50"
              >
                Monthly
              </button>
              <button
                type="button"
                aria-pressed={activeCycle === "yearly"}
                onClick={() => setActiveCycle("yearly")}
                className="relative z-10 rounded-full px-4 py-2 transition-colors hover:text-zinc-900 dark:hover:text-zinc-50"
              >
                Yearly
              </button>
            </div>
          </div>
          <p className="mt-4 max-w-2xl text-base text-zinc-600 dark:text-zinc-400">
            Pick a plan that fits your workflow. Upgrade anytime.
          </p>
        </div>

        <section className="mt-14">
          <div className="mb-4 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
            {sectionTitle}
          </div>

          <div className="overflow-hidden">
            <div
              className={`flex w-[200%] transition-transform duration-300 ease-out ${
                activeCycle === "monthly" ? "translate-x-0" : "-translate-x-1/2"
              }`}
            >
              <div className="w-1/2 shrink-0 pr-2">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {monthlyPlans.map((p) => (
                    <PlanCard
                      key={p.id}
                      title={p.title}
                      price={p.price}
                      cadence={p.cadence}
                      recommended={p.recommended}
                      features={p.features}
                      checkoutUrl={buildCheckoutUrl(p.id)}
                    />
                  ))}
                </div>
              </div>
              <div className="w-1/2 shrink-0 pl-2">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {yearlyPlans.map((p) => (
                    <PlanCard
                      key={p.id}
                      title={p.title}
                      price={p.price}
                      cadence={p.cadence}
                      recommended={p.recommended}
                      features={p.features}
                      checkoutUrl={buildCheckoutUrl(p.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
