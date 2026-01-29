import type { Skill } from "../../skillTypes";
import { postToXForUser } from "@/lib/integrations/x";

export const skill: Skill = {
  id: "post-to-twitter",
  name: "Post to Twitter",
  description: "Posts a tweet to a specific X account.",
  category: "integration",
  getStatus: () => "ready",
  run: async ({ input, context }) => {
    const { text, accountId } = (input ?? {}) as { text?: string; accountId?: string };
    if (!text) return { ok: false, error: "text is required" };
    const result = await postToXForUser({ userId: context.userId, text, accountId });
    return result.ok ? { ok: true, output: { tweetId: result.tweetId } } : { ok: false, error: result.error || "Post failed" };
  },
};
