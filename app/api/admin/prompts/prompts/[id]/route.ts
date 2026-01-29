import { loadPromptTemplate } from "@/lib/prompts";

export const runtime = "nodejs";

function isSafePromptId(id: string) {
  return /^[a-zA-Z0-9._-]+$/.test(id);
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const idRaw = (params?.id ?? "").toString().trim();
  const id = decodeURIComponent(idRaw);
  if (!id || !isSafePromptId(id)) {
    return Response.json({ error: "Invalid prompt id" }, { status: 400 });
  }
  const content = await loadPromptTemplate(id);
  if (!content) {
    return Response.json({ error: "Prompt not found" }, { status: 404 });
  }
  return Response.json({ id, content }, { status: 200 });
}

