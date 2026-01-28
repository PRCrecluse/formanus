import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import { listSkills } from "./skillsRegistry";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const skills = listSkills().map((s) => {
    const visibility = s.category === "web" ? "public" : "private";
    const configured = s.status === "ready";
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      visibility,
      configured,
    };
  });
  return Response.json({ skills }, { status: 200 });
}
