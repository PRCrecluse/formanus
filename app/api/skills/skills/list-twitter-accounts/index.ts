import type { Skill } from "../../skillTypes";
import { getMongoDb } from "@/lib/mongodb";

export const skill: Skill = {
  id: "list-twitter-accounts",
  name: "List Twitter Accounts",
  description: "Returns all connected X/Twitter accounts for the user.",
  category: "integration",
  getStatus: () => "ready",
  run: async ({ context }) => {
    try {
      const db = await getMongoDb();
      const docs = await db
        .collection("social_accounts")
        .find({ userId: context.userId, provider: "twitter" })
        .toArray();
      const accounts = docs.map((d) => ({ id: d.providerAccountId, username: d.profile?.username, name: d.profile?.name }));
      return { ok: true, output: { accounts } };
    } catch (e) {
      return { ok: false, error: "Failed to list accounts" };
    }
  },
};
