import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import type { User } from "@supabase/supabase-js";
import { getMongoDb } from "@/lib/mongodb";

export const runtime = "nodejs";

const ADMIN_EMAIL = "1765591779@qq.com";
const ADMIN_PROVIDER = "apple";
const ADMIN_QUERY_PARAM_KEY = "panel";
const ADMIN_QUERY_PARAM_SECRET = (process.env.NEXT_PUBLIC_ADMIN_PANEL_KEY ?? "").toString().trim();
const ADMIN_QUERY_PARAM_REQUIRED = ADMIN_QUERY_PARAM_SECRET.length > 0;

function isAdminUser(user: User, req: Request) {
  const email = (user.email ?? "").toLowerCase().trim();
  const provider = (user.app_metadata?.provider ?? "").toString().toLowerCase().trim();
  if (email !== ADMIN_EMAIL.toLowerCase().trim()) return false;
  if (provider !== ADMIN_PROVIDER) return false;
  if (!ADMIN_QUERY_PARAM_REQUIRED) return true;
  const url = new URL(req.url);
  const queryValue = (url.searchParams.get(ADMIN_QUERY_PARAM_KEY) ?? "").toString().trim();
  return queryValue === ADMIN_QUERY_PARAM_SECRET;
}

type BindingDoc = {
  _id: string;
  modelId: string;
  updatedAt: Date;
};

type PostBody = {
  skillId?: unknown;
  modelId?: unknown;
};

export async function GET(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminUser(auth.user, req)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const db = await getMongoDb();
  const rows = await db
    .collection<BindingDoc>("skill_model_bindings")
    .find({})
    .project<{ _id: string; modelId: string; updatedAt: Date }>({ _id: 1, modelId: 1, updatedAt: 1 })
    .toArray();

  const bindings = rows
    .map((r) => ({
      skillId: r._id,
      modelId: (r.modelId ?? "").toString(),
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : null,
    }))
    .filter((b) => b.skillId && b.modelId)
    .sort((a, b) => a.skillId.localeCompare(b.skillId));

  return Response.json({ bindings }, { status: 200 });
}

export async function POST(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminUser(auth.user, req)) return Response.json({ error: "Forbidden" }, { status: 403 });

  let body: PostBody | null = null;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    body = null;
  }

  const skillId = typeof body?.skillId === "string" ? body.skillId.trim() : "";
  const modelIdRaw = body?.modelId;
  const modelId = typeof modelIdRaw === "string" ? modelIdRaw.trim() : "";

  if (!skillId) return Response.json({ error: "skillId is required" }, { status: 400 });

  const db = await getMongoDb();
  const now = new Date();

  if (!modelId) {
    await db.collection<BindingDoc>("skill_model_bindings").deleteOne({ _id: skillId });
    return Response.json({ ok: true }, { status: 200 });
  }

  await db.collection<BindingDoc>("skill_model_bindings").updateOne(
    { _id: skillId },
    { $set: { modelId, updatedAt: now } },
    { upsert: true }
  );

  return Response.json({ ok: true }, { status: 200 });
}

