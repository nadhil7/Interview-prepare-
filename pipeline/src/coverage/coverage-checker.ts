import type { Question, Requirement } from "../schema/kit.js";

/**
 * Pure code, no LLM — coverage is a plain set-membership check, never a
 * decision left to the model. Returns the ids of requirements that no
 * question references.
 */
export function findUncoveredRequirementIds(requirements: Requirement[], questions: Question[]): string[] {
  const coveredIds = new Set(questions.flatMap((q) => q.requirement_ids));
  return requirements.filter((r) => !coveredIds.has(r.id)).map((r) => r.id);
}

export function findUncoveredMustRequirementIds(requirements: Requirement[], questions: Question[]): string[] {
  const uncovered = new Set(findUncoveredRequirementIds(requirements, questions));
  return requirements.filter((r) => r.priority === "must" && uncovered.has(r.id)).map((r) => r.id);
}
