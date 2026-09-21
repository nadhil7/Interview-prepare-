import type { Question, Requirement } from "../schema/kit.js";

/**
 * plain code, no llm involved. coverage is just a set check, never a
 * decision left to the model. returns the ids of requirements that no
 * question points to.
 */
export function findUncoveredRequirementIds(requirements: Requirement[], questions: Question[]): string[] {
  const coveredIds = new Set(questions.flatMap((q) => q.requirement_ids));
  return requirements.filter((r) => !coveredIds.has(r.id)).map((r) => r.id);
}

export function findUncoveredMustRequirementIds(requirements: Requirement[], questions: Question[]): string[] {
  const uncovered = new Set(findUncoveredRequirementIds(requirements, questions));
  return requirements.filter((r) => r.priority === "must" && uncovered.has(r.id)).map((r) => r.id);
}
