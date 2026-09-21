import { generateFlashcards, assignFlashcardIds } from "../generation/flashcard-generation.js";
import type { GeminiClientConfig } from "../generation/gemini-client.js";
import { generateCompanyBrief } from "../generation/company-brief.js";
import { extractRequirements } from "../generation/requirement-extraction.js";
import { assignQuestionIds, generateQuestionBank } from "../generation/question-generation.js";
import { runCoverageLoop } from "../coverage/coverage-loop.js";
import { allocateSchedule } from "../schedule/schedule-allocator.js";
import { crawlCompanySite } from "../retrieval/crawler.js";
import { searchPublicInterviewDiscussion } from "../retrieval/search.js";
import { validateUrl, type UrlValidatorOptions } from "../retrieval/url-validator.js";
import { validateKit, type Kit } from "../schema/kit.js";
import { deriveCompanyNameFromUrl, deriveRoleBasics } from "./derive.js";
import { PipelineError } from "./errors.js";

export const DEFAULT_USER_AGENT = "AIInterviewPrepKitBot/1.0 (+https://github.com/aipk)";

export interface GenerateKitInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export interface GenerateKitDeps {
  geminiConfig: GeminiClientConfig;
  urlValidatorOptions: UrlValidatorOptions;
  userAgent?: string;
}

export type GenerateKitStage = "researching" | "generating" | "checking";

/**
 * fired as the pipeline moves through each stage that is not the final
 * one, along with whatever partial data became available at that point.
 * the backend uses this to save job status and progress, plus early
 * source, role and research data, so a poll endpoint shows real progress.
 * the cli ignores it completely since a batch run has no need to report
 * progress per case.
 */
export type GenerateKitProgressCallback = (
  stage: GenerateKitStage,
  partial?: Record<string, unknown>,
) => void | Promise<void>;

export interface GenerateKitResult {
  kit: Kit;
  researchPages: Array<{ url: string; text: string }>;
  hiringProcessNotes: string;
}

/**
 * this is the one function both the backend's background job and the
 * cli's batch runner call to build a kit, so the same logic is used
 * everywhere instead of being written twice. it runs retrieval, then
 * extraction and generation, then coverage, then the schedule, checks the
 * result, and returns it. it throws PipelineError only when a kit could
 * not be produced at all, such as an unreachable company site or a final
 * result that fails validation. a thin or missing research result is not
 * treated as a failure here, that gets recorded honestly inside the kit
 * itself and still counts as a working result.
 */
export async function generateKit(
  input: GenerateKitInput,
  deps: GenerateKitDeps,
  onProgress?: GenerateKitProgressCallback,
): Promise<GenerateKitResult> {
  const userAgent = deps.userAgent ?? DEFAULT_USER_AGENT;

  await onProgress?.("researching");

  const initialValidation = await validateUrl(input.companyUrl, deps.urlValidatorOptions);
  if (!initialValidation.ok) {
    throw new PipelineError("COMPANY_UNREACHABLE", `Company URL rejected: ${initialValidation.reason}`);
  }

  const crawl = await crawlCompanySite(input.companyUrl, { userAgent, urlValidatorOptions: deps.urlValidatorOptions });
  const companyName = deriveCompanyNameFromUrl(input.companyUrl);
  const discussion = await searchPublicInterviewDiscussion(companyName, { userAgent });
  const hiringProcessNotes = discussion.found
    ? discussion.results.map((r) => `${r.title}: ${r.snippet}`).join("\n")
    : (discussion.note ?? "");

  const researchPages = crawl.pages.map((p) => ({ url: p.finalUrl, text: p.text }));
  const { title, seniority } = deriveRoleBasics(input.jd);

  await onProgress?.("generating", {
    source: {
      company: companyName,
      company_url: input.companyUrl,
      role: title,
      location: "",
      jd_chars: input.jd.length,
      researched_at: new Date().toISOString(),
      pages_used: crawl.pages.map((p) => p.finalUrl),
    },
    role: { title, seniority, responsibilities: [], requirements: [] },
    research: { pages: researchPages, hiringProcessNotes },
  });

  const requirements = await extractRequirements(input.jd, { geminiConfig: deps.geminiConfig });
  const brief = await generateCompanyBrief(companyName, researchPages, deps.geminiConfig);
  const companyContext = `${brief.summary}\n${brief.what_they_do}`;

  const initialQuestions = assignQuestionIds(
    await generateQuestionBank({
      requirements,
      companyContext,
      hiringProcessNotes,
      geminiConfig: deps.geminiConfig,
    }),
  );

  await onProgress?.("checking");

  const coverageResult = await runCoverageLoop({
    requirements,
    initialQuestions,
    companyContext,
    hiringProcessNotes,
    geminiConfig: deps.geminiConfig,
  });

  const flashcards = assignFlashcardIds(
    await generateFlashcards({ requirements, questions: coverageResult.questions, geminiConfig: deps.geminiConfig }),
  );

  const schedule = allocateSchedule(coverageResult.questions, requirements, input.days);

  const finalKit = {
    source: {
      company: companyName,
      company_url: input.companyUrl,
      role: title,
      location: "",
      jd_chars: input.jd.length,
      researched_at: new Date().toISOString(),
      pages_used: crawl.pages.map((p) => p.finalUrl),
    },
    company_brief: brief,
    role: { title, seniority, responsibilities: [], requirements },
    questions: coverageResult.questions,
    flashcards,
    schedule,
    coverage: { uncovered_requirement_ids: coverageResult.uncoveredRequirementIds, passes: coverageResult.passes },
  };

  const validation = validateKit(finalKit);
  if (!validation.ok) {
    throw new PipelineError(
      "KIT_VALIDATION_FAILED",
      `Generated kit failed structure validation: ${validation.errors.join("; ")}`,
    );
  }

  return { kit: validation.data, researchPages, hiringProcessNotes };
}
