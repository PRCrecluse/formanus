import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import { getMongoDb } from "@/lib/mongodb";
import { listSkills } from "./skillsRegistry";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const installState = new Map<string, boolean>();
  try {
    const db = await getMongoDb();
    const docs = await db
      .collection<{ skillId?: unknown; installed?: unknown }>("user_skill_states")
      .find({ userId: auth.user.id })
      .toArray();
    for (const doc of docs) {
      const skillId = typeof doc.skillId === "string" ? doc.skillId : "";
      if (!skillId) continue;
      const installed = typeof doc.installed === "boolean" ? doc.installed : true;
      installState.set(skillId, installed);
    }
  } catch {
    void 0;
  }

  const skills = listSkills().map((s) => {
    const visibility = s.category === "web" ? "public" : "private";
    const configured = s.status === "ready";
    const installed = installState.get(s.id) ?? true;
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      visibility,
      configured,
      installed,
    };
  });
  return Response.json({ skills }, { status: 200 });
}

export async function PATCH(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = (await req.json()) as unknown;
  } catch {
    body = null;
  }

  const obj = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  const id = typeof obj?.id === "string" ? obj.id.trim() : "";
  const installed = typeof obj?.installed === "boolean" ? obj.installed : null;

  if (!id || installed === null) {
    return Response.json({ error: "id and installed are required" }, { status: 400 });
  }

  const exists = listSkills().some((s) => s.id === id);
  if (!exists) {
    return Response.json({ error: "Unknown skill" }, { status: 404 });
  }

  const db = await getMongoDb();
  const col = db.collection<{ _id: string; userId: string; skillId: string; installed: boolean; updatedAt: Date }>(
    "user_skill_states"
  );

  if (installed) {
    await col.deleteOne({ userId: auth.user.id, skillId: id });
  } else {
    await col.updateOne(
      { userId: auth.user.id, skillId: id },
      {
        $set: {
          _id: `${auth.user.id}:${id}`,
          userId: auth.user.id,
          skillId: id,
          installed: false,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  return Response.json({ ok: true, id, installed }, { status: 200 });
}
