import { describe, expect, it } from "vitest";
import type { Question, Requirement } from "../../schema/kit.js";
import { findUncoveredMustRequirementIds, findUncoveredRequirementIds } from "../coverage-checker.js";

const requirements: Requirement[] = [
  { id: "r1", text: "React", kind: "technical", priority: "must" },
  { id: "r2", text: "Communication", kind: "behavioural", priority: "must" },
  { id: "r3", text: "GraphQL", kind: "technical", priority: "nice" },
];

function question(id: string, requirement_ids: string[]): Question {
  return {
    id,
    requirement_ids,
    category: "technical",
    prompt: "p",
    answer_outline: "a",
    difficulty: 1,
    origin: "generated",
    status: "pristine",
  };
}

describe("findUncoveredRequirementIds", () => {
  it("returns all requirement ids when there are no questions", () => {
    expect(findUncoveredRequirementIds(requirements, [])).toEqual(["r1", "r2", "r3"]);
  });

  it("returns nothing when every requirement is covered", () => {
    const questions = [question("q1", ["r1"]), question("q2", ["r2"]), question("q3", ["r3"])];
    expect(findUncoveredRequirementIds(requirements, questions)).toEqual([]);
  });

  it("returns only the requirements no question references", () => {
    const questions = [question("q1", ["r1"])];
    expect(findUncoveredRequirementIds(requirements, questions)).toEqual(["r2", "r3"]);
  });

  it("counts a requirement covered even if it's only one of several ids on a question", () => {
    const questions = [question("q1", ["r1", "r2", "r3"])];
    expect(findUncoveredRequirementIds(requirements, questions)).toEqual([]);
  });

  it("ignores question requirement_ids that don't match any real requirement", () => {
    const questions = [question("q1", ["not-a-real-id"])];
    expect(findUncoveredRequirementIds(requirements, questions)).toEqual(["r1", "r2", "r3"]);
  });
});

describe("findUncoveredMustRequirementIds", () => {
  it("only reports uncovered must-priority requirements, ignoring uncovered nice ones", () => {
    const questions = [question("q1", ["r1"])]; // r2 (must) and r3 (nice) uncovered
    expect(findUncoveredMustRequirementIds(requirements, questions)).toEqual(["r2"]);
  });

  it("returns an empty array when all must requirements are covered, even if nice ones aren't", () => {
    const questions = [question("q1", ["r1"]), question("q2", ["r2"])];
    expect(findUncoveredMustRequirementIds(requirements, questions)).toEqual([]);
  });
});
