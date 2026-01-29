export type SkillStatus = "ready" | "needs_config";

export type SkillMeta = {
  id: string;
  name: string;
  description: string;
  category: "web" | "integration" | "documents";
  status: SkillStatus;
};

type SkillRunOk = { ok: true; output: unknown };
type SkillRunErr = { ok: false; error: string };
export type SkillRunResult = SkillRunOk | SkillRunErr;

export type SkillContext = {
  userId: string;
  accessToken: string;
};

export type Skill = {
  id: string;
  name: string;
  description: string;
  category: SkillMeta["category"];
  getStatus: () => SkillStatus;
  run: (args: { input: unknown; context: SkillContext; modelId?: string | null }) => Promise<SkillRunResult>;
};
