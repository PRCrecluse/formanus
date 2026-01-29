import type { Skill } from "../../skillTypes";
import { createBoardDoc, createChatModel, fetchNotionPageText } from "../../skillShared";

export const skill: Skill = {
  id: "wechat-competitor-collection",
  name: "WeChat Competitor Collection",
  description: "Reads a Notion page and extracts WeChat competitor information into a structured document.",
  category: "integration",
  getStatus: () => "ready",
  run: async ({ input, context, modelId }) => {
    const obj = (input ?? {}) as { notionPageId?: string };
    if (!obj.notionPageId) return { ok: false, error: "notionPageId is required" };

    try {
      const token = process.env.NOTION_TOKEN || "";
      const rawText = await fetchNotionPageText(token, obj.notionPageId);
      const chatModel = createChatModel(modelId);
      const structured = await chatModel.invoke(`Extract WeChat competitors from this text and format as a list: ${rawText}`);

      const saveResult = await createBoardDoc({
        title: "WeChat Competitor List",
        content: structured.content.toString(),
        userId: context.userId,
        accessToken: context.accessToken,
        personaId: null,
      });

      return { ok: true, output: { docId: saveResult.ok ? saveResult.docId : null } };
    } catch (e) {
      return { ok: false, error: "Collection failed" };
    }
  },
};
