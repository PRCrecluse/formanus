import type { SkillMeta, SkillRunResult, SkillContext, Skill } from "./skillTypes";
import { SKILLS } from "./skills";

export type { SkillMeta, SkillRunResult, SkillContext, Skill };

export function getSkill(id: string): Skill | undefined {
  return SKILLS.find((s) => s.id === id);
}

export function listSkills(): SkillMeta[] {
  return SKILLS.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    status: s.getStatus(),
  }));
}

export async function runSkill(args: { id: string; input: unknown; context: SkillContext; modelId?: string | null }): Promise<SkillRunResult> {
  const skill = SKILLS.find((s) => s.id === args.id) ?? null;
  if (!skill) return { ok: false, error: "Unknown skill" };
  return skill.run({ input: args.input, context: args.context, modelId: args.modelId });
}
