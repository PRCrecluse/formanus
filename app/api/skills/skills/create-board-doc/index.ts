import type { Skill } from "../../skillTypes";
import { createBoardDoc } from "../../skillShared";

export const skill: Skill = {
  id: "create-board-doc",
  name: "Create Board Doc",
  description: "Saves text content to the user's board resources.",
  category: "documents",
  getStatus: () => "ready",
  run: async ({ input, context }) => {
    const { title, content, personaId } = (input ?? {}) as { title?: string; content?: string; personaId?: string };
    if (!title || !content) return { ok: false, error: "title and content are required" };
    const res = await createBoardDoc({
      title,
      content,
      userId: context.userId,
      accessToken: context.accessToken,
      personaId: personaId ?? null,
    });
    return res.ok ? { ok: true, output: { docId: res.docId } } : { ok: false, error: res.error };
  },
};
