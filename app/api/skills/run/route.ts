import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import { runSkill } from "../skillsRegistry";
import { getMongoDb } from "@/lib/mongodb";

export const runtime = "nodejs";

type RunBody = {
  id?: unknown;
  input?: unknown;
  modelId?: unknown;
};

export async function POST(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RunBody | null = null;
  try {
    body = (await req.json()) as RunBody;
  } catch {
    body = null;
  }

  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const modelId = typeof body?.modelId === "string" ? body.modelId.trim() : null;
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const db = await getMongoDb();
    const state = await db
      .collection<{ userId: string; skillId: string; installed: boolean }>("user_skill_states")
      .findOne({ userId: auth.user.id, skillId: id, installed: false });
    if (state) {
      return Response.json({ error: "Skill not installed" }, { status: 403 });
    }
  } catch {
    void 0;
  }

  let effectiveModelId = modelId;
  try {
    const db = await getMongoDb();
    const doc = await db
      .collection<{ _id: string; modelId: string }>("skill_model_bindings")
      .findOne({ _id: id });
    const fixed = (doc?.modelId ?? "").toString().trim();
    if (fixed) effectiveModelId = fixed;
  } catch {
    void 0;
  }

  const result = await runSkill({
    id,
    input: body?.input,
    modelId: effectiveModelId,
    context: { userId: auth.user.id, accessToken: auth.accessToken },
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json({ output: result.output, modelId: effectiveModelId }, { status: 200 });
}
