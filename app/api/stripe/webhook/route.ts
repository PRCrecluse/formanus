import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

export const runtime = "nodejs";

type PlanId = "basic_monthly" | "basic_yearly" | "pro_monthly" | "pro_yearly";
type MembershipStatus = PlanId | "free";

type StripeCheckoutSession = {
  id?: string;
  payment_link?: string | null;
  client_reference_id?: string | null;
  customer_email?: string | null;
  customer_details?: {
    email?: string | null;
  } | null;
  metadata?: Record<string, unknown> | null;
};

type StripeSubscription = {
  id?: string;
  status?: string | null;
  customer?: string | null;
  customer_email?: string | null;
  metadata?: Record<string, unknown> | null;
};

type StripeEvent = {
  type?: string | null;
  data?: {
    object?: StripeCheckoutSession | StripeSubscription | null;
  } | null;
};

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

const STRIPE_ENV = (process.env.STRIPE_ENV ?? "").toString();

const paymentLinkPlanCache = new Map<string, PlanId>();

const CREDITS_PER_PLAN: Record<PlanId, number> = {
  basic_monthly: 500,
  basic_yearly: 500,
  pro_monthly: 1000,
  pro_yearly: 1000,
};

function uuidFromText(input: string): string {
  const bytes = createHash("sha256").update(input).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function ensurePaymentLinkPlanCache() {
  if (paymentLinkPlanCache.size > 0) return;
  const stripeSecretKey = (process.env.STRIPE_SECRET_KEY ?? "").toString().trim();
  if (!stripeSecretKey) {
    throw new Error("Stripe not configured");
  }
  const knownUrls = new Map<string, PlanId>();
  const baseUrls =
    STRIPE_ENV === "test"
      ? TEST_PLAN_CHECKOUT_URLS
      : LIVE_PLAN_CHECKOUT_URLS;
  (Object.keys(LIVE_PLAN_CHECKOUT_URLS) as PlanId[]).forEach((id) => {
    const url = baseUrls[id];
    if (url) knownUrls.set(url, id);
  });
  const params = new URLSearchParams({ limit: "100" });
  const res = await fetch(`https://api.stripe.com/v1/payment_links?${params.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
    },
  });
  if (!res.ok) {
    throw new Error("Failed to list Stripe payment links");
  }
  const body = (await res.json()) as { data?: Array<{ id?: string; url?: string | null }> };
  paymentLinkPlanCache.clear();
  for (const link of body.data ?? []) {
    const id = typeof link.id === "string" ? link.id : "";
    const url = typeof link.url === "string" ? link.url : "";
    if (!id || !url) continue;
    const planId = knownUrls.get(url);
    if (planId) {
      paymentLinkPlanCache.set(id, planId);
    }
  }
}

function pickPlanIdFromSession(session: StripeCheckoutSession): PlanId | null {
  const paymentLinkId = typeof session.payment_link === "string" ? session.payment_link : "";
  if (paymentLinkId) {
    const cached = paymentLinkPlanCache.get(paymentLinkId);
    if (cached) return cached;
  }
  const meta = session.metadata ?? null;
  const rawMetaPlan = meta && typeof meta.plan_id === "string" ? meta.plan_id : "";
  if (rawMetaPlan) {
    const trimmed = rawMetaPlan.trim();
    if (trimmed === "basic_monthly" || trimmed === "basic_yearly" || trimmed === "pro_monthly" || trimmed === "pro_yearly") {
      return trimmed;
    }
  }
  return null;
}

function pickUserIdentifiersFromSession(session: StripeCheckoutSession) {
  const clientRef = typeof session.client_reference_id === "string" ? session.client_reference_id.trim() : "";
  const emailFromDetails =
    session.customer_details && typeof session.customer_details.email === "string"
      ? session.customer_details.email.trim()
      : "";
  const emailFallback = typeof session.customer_email === "string" ? session.customer_email.trim() : "";
  const email = emailFromDetails || emailFallback;
  return { clientRef, email };
}

async function lookupCustomerEmail(customerId: string): Promise<string | null> {
  const stripeSecretKey = (process.env.STRIPE_SECRET_KEY ?? "").toString().trim();
  if (!stripeSecretKey || !customerId) return null;
  const res = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
    },
  });
  if (!res.ok) {
    return null;
  }
  const body = (await res.json()) as { email?: string | null };
  const email = typeof body.email === "string" ? body.email.trim() : "";
  return email || null;
}

async function updateUserMembership(args: {
  userId: string | null;
  email: string | null;
  status: MembershipStatus;
  stripeSessionId?: string | null;
}) {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").toString().trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").toString().trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase not configured");
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  let userId = args.userId ? args.userId.trim() : "";
  if (!userId && args.email) {
    const email = args.email.trim();
    if (email) {
      const lookup = await supabase.from("users").select("id").eq("email", email).maybeSingle();
      if (!lookup.error && lookup.data && typeof lookup.data.id === "string") {
        userId = lookup.data.id;
      }
    }
  }
  if (!userId) {
    return;
  }

  let creditsDelta = 0;
  if (args.status !== "free") {
    creditsDelta = CREDITS_PER_PLAN[args.status] ?? 0;
  }

  const sessionId = typeof args.stripeSessionId === "string" ? args.stripeSessionId.trim() : "";
  const grantKey = sessionId && args.status !== "free" ? uuidFromText(`stripe:checkout_session:${sessionId}:plan:${args.status}:user:${userId}`) : "";

  if (creditsDelta > 0 && grantKey) {
    const currentCreditsRes = await supabase.from("users").select("credits").eq("id", userId).maybeSingle();
    if (currentCreditsRes.error) {
      throw new Error(currentCreditsRes.error.message);
    }
    const currentCreditsRaw = (currentCreditsRes.data as { credits?: unknown } | null)?.credits;
    const currentCredits = typeof currentCreditsRaw === "number" && Number.isFinite(currentCreditsRaw) ? currentCreditsRaw : 0;
    const newCredits = currentCredits + creditsDelta;

    const insertRes = await supabase.from("credit_history").insert({
      id: grantKey,
      user_id: userId,
      title: `Stripe purchase · ${args.status}`,
      qty: creditsDelta,
      total: newCredits,
    });
    if (insertRes.error) {
      const code = (insertRes.error as { code?: string }).code;
      if (code === "23505") {
        await supabase.from("users").update({ membership_status: args.status }).eq("id", userId);
        return;
      }
      throw new Error(insertRes.error.message);
    }

    const updateRes = await supabase
      .from("users")
      .update({ membership_status: args.status, credits: newCredits })
      .eq("id", userId);
    if (updateRes.error) {
      throw new Error(updateRes.error.message);
    }
    return;
  }

  await supabase.from("users").update({ membership_status: args.status }).eq("id", userId);
}

async function handleSubscriptionEnded(sub: StripeSubscription) {
  const meta = sub.metadata ?? null;
  const metaUserId = meta && typeof meta.user_id === "string" ? meta.user_id.trim() : "";
  const metaClientRef = meta && typeof meta.client_reference_id === "string" ? meta.client_reference_id.trim() : "";
  const metaEmail = meta && typeof meta.email === "string" ? meta.email.trim() : "";

  const userId = metaUserId || metaClientRef;
  let email = metaEmail;

  if (!email && typeof sub.customer_email === "string") {
    email = sub.customer_email.trim();
  }
  if (!email && typeof sub.customer === "string") {
    const lookedUpEmail = await lookupCustomerEmail(sub.customer);
    if (lookedUpEmail) {
      email = lookedUpEmail;
    }
  }

  if (!userId && !email) {
    return;
  }
  await updateUserMembership({ userId: userId || null, email: email || null, status: "free" });
}

export async function POST(req: Request) {
  const headers = req.headers;
  const sharedSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").toString().trim();
  const headerSecret =
    headers.get("x-aipersona-stripe-secret") ??
    headers.get("X-AIPERSONA_STRIPE_SECRET") ??
    headers.get("x-aipersona-secret");
  if (!sharedSecret || !headerSecret || headerSecret !== sharedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let event: StripeEvent;
  try {
    event = (await req.json()) as StripeEvent;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!event.type) {
    return new Response("OK", { status: 200 });
  }

  if (event.type === "checkout.session.completed") {
    const session = (event.data?.object ?? null) as StripeCheckoutSession | null;
    if (!session) {
      return new Response("OK", { status: 200 });
    }
    try {
      await ensurePaymentLinkPlanCache();
    } catch {
    }
    const planId = pickPlanIdFromSession(session);
    if (!planId) {
      return new Response("OK", { status: 200 });
    }
    const ids = pickUserIdentifiersFromSession(session);
    try {
      await updateUserMembership({
        userId: ids.clientRef || null,
        email: ids.email || null,
        status: planId,
        stripeSessionId: typeof session.id === "string" ? session.id : null,
      });
    } catch {
    }
    return new Response("OK", { status: 200 });
  }

  if (event.type === "customer.subscription.deleted" || event.type === "customer.subscription.updated") {
    const sub = (event.data?.object ?? null) as StripeSubscription | null;
    if (!sub) {
      return new Response("OK", { status: 200 });
    }
    const status = (sub.status ?? "").toLowerCase();
    if (!status || (event.type === "customer.subscription.updated" && status !== "canceled")) {
      return new Response("OK", { status: 200 });
    }
    try {
      await handleSubscriptionEnded(sub);
    } catch {
    }
    return new Response("OK", { status: 200 });
  }

  return new Response("OK", { status: 200 });
}
