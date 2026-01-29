import type { Skill } from "../../skillTypes";
import { fetchNotionPageText } from "../../skillShared";

export const skill: Skill = {
  id: "notion-integration",
  name: "Notion Integration",
  description: "Read Notion page blocks and extract plain text.",
  category: "integration",
  getStatus: () => {
    const token = (process.env.NOTION_TOKEN ?? "").toString().trim();
    return token ? "ready" : "needs_config";
  },
  run: async ({ input }) => {
    const obj = (input ?? {}) as { token?: unknown; pageId?: unknown };
    const token = (typeof obj.token === "string" ? obj.token : process.env.NOTION_TOKEN ?? "").toString().trim();
    const pageId = (typeof obj.pageId === "string" ? obj.pageId : "").toString().trim();
    if (!token) return { ok: false, error: "Missing Notion token (NOTION_TOKEN)" };
    if (!pageId) return { ok: false, error: "pageId is required" };
    const text = await fetchNotionPageText(token, pageId);
    return { ok: true, output: { pageId, text } };
  },
};
