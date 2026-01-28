"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

type PlanId = "basic_monthly" | "basic_yearly" | "pro_monthly" | "pro_yearly";
type MembershipStatus = "free" | PlanId;
type UsageRow = Record<string, unknown>;

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

function pickValue<T = unknown>(row: UsageRow, keys: string[]): T | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return value as T;
  }
  return undefined;
}

function formatDate(value: unknown): string {
  if (typeof value === "string" || value instanceof Date) {
    const d = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
    }
  }
  return "-";
}

function formatMoney(value: unknown): string {
  if (typeof value === "number") return `$${value.toFixed(2)}`;
  if (typeof value === "string") {
    const n = Number(value);
    if (!Number.isNaN(n)) return `$${n.toFixed(2)}`;
  }
  return "-";
}

export default function BillingPage() {
  const plans = useMemo(
    () => [
      {
        id: "basic_monthly" as const,
        title: "Basic Plan",
        subtitle: "Monthly",
        priceLabel: "$40 / mo",
        accent: "bg-white text-black hover:bg-zinc-200",
        features: [
          "500 credits per month",
          "Create up to 5 personas",
          "Basic social media operation advice",
          "Social media calendar and reminders",
        ],
      },
      {
        id: "basic_yearly" as const,
        title: "Basic Plan",
        subtitle: "Yearly",
        priceLabel: "$400 / yr",
        accent: "bg-white text-black hover:bg-zinc-200",
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
        subtitle: "Monthly",
        priceLabel: "$100 / mo",
        accent: "bg-white text-black hover:bg-zinc-200",
        features: [
          "1000 credits per month",
          "Unlimited personas",
          "Professional social media operation advice",
          "Social media calendar and reminders",
        ],
      },
      {
        id: "pro_yearly" as const,
        title: "Pro Plan",
        subtitle: "Yearly",
        priceLabel: "$1000 / yr",
        accent: "bg-white text-black hover:bg-zinc-200",
        features: [
          "1000 credits per month",
          "Unlimited personas",
          "Professional social media operation advice",
          "Social media calendar and reminders",
        ],
      },
    ],
    []
  );

  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus>("free");
  const [currentPlan, setCurrentPlan] = useState<PlanId>("basic_monthly");
  const [userId, setUserId] = useState<string | null>(null);
  const [billingRows, setBillingRows] = useState<UsageRow[]>([]);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingError, setBillingError] = useState<string | null>(null);

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
      const userId = sessionRes.data.session?.user?.id;
      if (!userId) {
        setUserId(null);
        setBillingLoading(false);
        setBillingError("Not logged in");
        return;
      }

      setUserId(userId);

      const { data: userRow, error: userError } = await supabase
        .from("users")
        .select("membership_status")
        .eq("id", userId)
        .single();

      if (!userError && userRow && typeof userRow.membership_status === "string") {
        const raw = (userRow.membership_status as string).toLowerCase();
        const normalized = (raw === "free" ? "free" : raw) as MembershipStatus;
        setMembershipStatus(normalized);
        if (normalized !== "free") {
          setCurrentPlan(normalized as PlanId);
        }
      } else {
        setMembershipStatus("free");
      }

      const billingHistoryEnabled = process.env.NEXT_PUBLIC_ENABLE_BILLING_HISTORY === "true";
      if (!billingHistoryEnabled) {
        setBillingRows([]);
        setBillingError(null);
        setBillingLoading(false);
        return;
      }

      const { data: billData, error: billError } = await supabase
        .from("billing_history")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      
      // If table doesn't exist (404) or other error, just show empty
      if (billError) {
        if (billError.code === "PGRST204" || billError.message.includes("does not exist") || billError.code === "42P01") {
           // Table missing, treat as empty
           setBillingRows([]);
           setBillingError(null);
        } else {
           // Other error
           setBillingRows([]);
           setBillingError(billError.message);
        }
      } else {
        setBillingRows((billData ?? []) as UsageRow[]);
        setBillingError(null);
      }
      setBillingLoading(false);
    };

    void run();
  }, []);

  const currentPlanMeta = useMemo(() => plans.find((p) => p.id === currentPlan), [plans, currentPlan]);

  return (
    <div className="min-h-screen bg-white text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Billing &amp; Invoices</h1>
          <a
            href="https://billing.stripe.com/p/login/3cI14o6VCevr0mvcoI5ZC00"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            <span>Manage in Stripe</span>
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>

        <div className="mt-6 space-y-6">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Your current plan</div>
                <div className="mt-1 text-xl font-semibold">
                  {membershipStatus === "free"
                    ? "Free Plan"
                    : currentPlanMeta
                      ? `${currentPlanMeta.title} · ${currentPlanMeta.subtitle}`
                      : "—"}
                </div>
                <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {membershipStatus === "free" ? "Free" : currentPlanMeta?.priceLabel ?? ""}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const selected = membershipStatus !== "free" && plan.id === currentPlan;
              const canUpgradeFromBasicMonthly = membershipStatus === "basic_monthly" && plan.id !== "basic_monthly";
              const checkoutUrl = buildCheckoutUrl(plan.id);
              return (
                <div
                  key={plan.id}
                  className={`rounded-2xl border p-5 shadow-sm transition-colors ${
                    selected
                      ? "border-zinc-900 bg-white dark:border-zinc-200 dark:bg-zinc-900"
                      : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-base font-semibold">{plan.title}</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">{plan.subtitle}</div>
                  </div>
                  <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{plan.priceLabel}</div>

                  <div className="mt-4 space-y-2 text-sm text-zinc-600 dark:text-zinc-200">
                    {plan.features.map((f) => (
                      <div key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 text-zinc-900 dark:text-zinc-200" />
                        <span className="leading-5">{f}</span>
                      </div>
                    ))}
                  </div>
                  {selected ? (
                    <button
                      type="button"
                      className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-zinc-700 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-600"
                    >
                      Current Plan
                    </button>
                  ) : checkoutUrl ? (
                    <a
                      href={checkoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`mt-5 inline-flex w-full items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                        membershipStatus === "free" ? plan.accent : "bg-zinc-900 text-white hover:bg-zinc-800"
                      }`}
                    >
                      {membershipStatus === "free" ? "Select Plan" : canUpgradeFromBasicMonthly ? "Upgrade" : "Change Plan"}
                    </a>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-base font-semibold">Billing history</div>
                <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Latest 50 USD invoices</div>
              </div>
              {billingLoading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
            </div>

            {billingError && (
              <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {billingError}
              </div>
            )}

            {!billingError && (
              <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                <div className="grid grid-cols-12 gap-2 bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-500 dark:bg-zinc-900/50 dark:text-zinc-400">
                  <div className="col-span-5">Name</div>
                  <div className="col-span-3">Amount</div>
                  <div className="col-span-4">Date</div>
                </div>
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {!billingLoading && billingRows.length === 0 && (
                    <div className="px-4 py-6 text-sm text-zinc-500">No records</div>
                  )}
                  {billingRows.map((row, idx) => {
                    const name = pickValue<string>(row, ["name", "title", "description"]) ?? "-";
                    const amount = pickValue<number | string>(row, ["amount", "price"]) ?? "-";
                    const date = formatDate(pickValue(row, ["created_at", "date", "timestamp"]));
                    return (
                      <div key={`${idx}`} className="grid grid-cols-12 gap-2 px-4 py-3 text-sm">
                        <div className="col-span-5 text-zinc-900 dark:text-zinc-200">{name}</div>
                        <div className="col-span-3 text-zinc-700 dark:text-zinc-300">{typeof amount === "number" ? `$${amount.toFixed(2)}` : String(amount)}</div>
                        <div className="col-span-4 text-zinc-700 dark:text-zinc-300">{date}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
