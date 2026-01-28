import { getUserFromRequest } from "@/lib/supabaseAuthServer";
import { runAutomationOnce, syncAutomationScheduler } from "@/lib/automationScheduler";

export const runtime = "nodejs";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getUserFromRequest(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await context.params;
  const id = decodeURIComponent(rawId);

  await runAutomationOnce(id, auth.user.id);
  await syncAutomationScheduler().catch(() => null);

  return Response.json({ ok: true });
}

