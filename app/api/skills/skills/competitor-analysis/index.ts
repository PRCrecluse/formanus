import type { Skill } from "../../skillTypes";
import { createBoardDoc, createChatModel } from "../../skillShared";

export const skill: Skill = {
  id: "competitor-analysis",
  name: "Competitor Analysis",
  description: "Analyzes competitor X handles and generates a hot-content aggregation report.",
  category: "integration",
  getStatus: () => "ready",
  run: async ({ input, context, modelId }) => {
    const obj = (input ?? {}) as { handles?: string[] };
    const handles = obj.handles ?? [];
    if (handles.length === 0) return { ok: false, error: "handles are required" };

    try {
      const chatModel = createChatModel(modelId);
      const report = await chatModel.invoke(
        `Analyze these competitors: ${handles.join(", ")}. Identify hot topics and engagement trends.`
      );

      const saveResult = await createBoardDoc({
        title: `Competitor Analysis: ${handles.join(", ")}`,
        content: report.content.toString(),
        userId: context.userId,
        accessToken: context.accessToken,
        personaId: null,
      });

      return {
        ok: true,
        output: { docId: saveResult.ok ? saveResult.docId : null, summary: "Analysis completed and saved." },
      };
    } catch (e) {
      return { ok: false, error: "Analysis failed" };
    }
  },
};
