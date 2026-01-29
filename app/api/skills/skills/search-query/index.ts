import type { Skill } from "../../skillTypes";
import { clampInt } from "../../skillShared";
import { runWebSearch } from "@/lib/skills";

export const skill: Skill = {
  id: "search-query",
  name: "Search Query",
  description: "Search the web and return top results.",
  category: "web",
  getStatus: () => "ready",
  run: async ({ input }) => {
    const obj = (input ?? {}) as { query?: unknown; limit?: unknown };
    const query = typeof obj.query === "string" ? obj.query.trim() : "";
    if (!query) return { ok: false, error: "query is required" };
    const limit = clampInt(obj.limit, 1, 10, 5);
    try {
      const results = await runWebSearch(query, limit);
      return { ok: true, output: { query, limit, results } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Search failed";
      return { ok: false, error: msg };
    }
  },
};
