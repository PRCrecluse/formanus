import type { Skill } from "../../skillTypes";
import { createBoardDoc, createChatModel } from "../../skillShared";

export const skill: Skill = {
  id: "article-writing-and-posting",
  name: "Article Writing & Posting",
  description: "Generates an article based on a topic, saves it to Board Resources, and optionally prepares a tweet summary.",
  category: "integration",
  getStatus: () => "ready",
  run: async ({ input, context, modelId }) => {
    const obj = (input ?? {}) as { topic?: string; style?: string; accountId?: string };
    const { topic, style = "professional", accountId } = obj;
    if (!topic) return { ok: false, error: "topic is required" };

    try {
      const chatModel = createChatModel(modelId);
      const response = await chatModel.invoke(`Write a ${style} article about: ${topic}`);
      const content = response.content.toString();

      const saveResult = await createBoardDoc({
        title: `Article: ${topic}`,
        content,
        userId: context.userId,
        accessToken: context.accessToken,
        personaId: null,
      });

      if (!saveResult.ok) return { ok: false, error: saveResult.error };

      return { ok: true, output: { docId: saveResult.docId, content: content.slice(0, 500) + "..." } };
    } catch (e) {
      return { ok: false, error: "Failed to generate article" };
    }
  },
};
