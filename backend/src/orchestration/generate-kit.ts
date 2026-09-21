import crypto from "node:crypto";
import {
  allocateSchedule,
  assignFlashcardIds,
  assignQuestionIds,
  crawlCompanySite,
  extractRequirements,
  generateCompanyBrief,
  generateFlashcards,
  generateQuestionBank,
  runCoverageLoop,
  searchPublicInterviewDiscussion,
  validateKit,
  validateUrl,
  type GeminiClientConfig,
} from "@aipk/pipeline";
import { Kit, type KitDocument } from "../models/Kit.js";
import { deriveCompanyNameFromUrl, deriveRoleBasics } from "./derive.js";
import { AppError } from "./errors.js";

export const USER_AGENT = "AIInterviewPrepKitBot/1.0 (+https://github.com/aipk)";

export interface CreateKitInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export function computeRequestHash(input: CreateKitInput): string {
  return crypto
    .createHash("sha256")
    .update(`${input.jd}\n${input.companyUrl}\n${input.days}`)
    .digest("hex");
}

export interface FindOrCreateResult {
  kit: KitDocument;
  isNew: boolean;
}

/**
 * How long a job can sit in a non-terminal status before it's considered
 * abandoned — e.g. the process died mid-"researching"/"generating" and
 * nothing is ever going to finish it. Generous relative to the ~60-90s a
 * healthy run takes, so it only catches genuinely stuck jobs, not slow ones.
 */
export const STALE_JOB_TIMEOUT_MS = 5 * 60 * 1000;
const NON_TERMINAL_STATUSES = ["pending", "researching", "generating", "checking"];

function isStaleNonTerminalJob(status: string, updatedAt: Date | undefined): boolean {
  if (!NON_TERMINAL_STATUSES.includes(status) || !updatedAt) return false;
  return Date.now() - updatedAt.getTime() > STALE_JOB_TIMEOUT_MS;
}

/**
 * Sweeps every kit stuck in a non-terminal job status past the staleness
 * timeout and marks it "failed" with a STALE_JOB error. Run once at server
 * startup (recovers jobs orphaned by a crash/restart) and on an interval
 * (catches a job that hangs without the whole process dying). Nothing here
 * attempts to resume a partially-completed run — the pipeline isn't built
 * to pick up mid-crawl or mid-generation, so failing cleanly and letting
 * the user resubmit is the safe behavior.
 */
export async function sweepStaleJobs(timeoutMs: number = STALE_JOB_TIMEOUT_MS): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutMs);
  const result = await Kit.updateMany(
    { "job.status": { $in: NON_TERMINAL_STATUSES }, updatedAt: { $lt: cutoff } },
    {
      "job.status": "failed",
      "job.error": {
        code: "STALE_JOB",
        message: `Job did not reach a terminal status within ${timeoutMs}ms (process likely crashed or restarted mid-run) and was marked failed.`,
      },
    },
  );
  return result.modifiedCount;
}

/**
 * Duplicate-submission handling: same user + same (jd, companyUrl, days)
 * returns the existing kit instead of regenerating — unless that existing
 * kit's job is stuck (stale non-terminal status), in which case it's reset
 * to "pending" and returned as if new, so the caller restarts generation on
 * it rather than the user being permanently stuck on that exact input.
 */
export async function findOrCreateKitJob(userId: string, input: CreateKitInput): Promise<FindOrCreateResult> {
  const requestHash = computeRequestHash(input);
  const existing = await Kit.findOne({ userId, requestHash });
  if (existing) {
    const updatedAt = (existing as unknown as { updatedAt?: Date }).updatedAt;
    if (isStaleNonTerminalJob(existing.job?.status ?? "", updatedAt)) {
      existing.job = { status: "pending", progress: 0, error: null };
      await existing.save();
      return { kit: existing, isNew: true };
    }
    return { kit: existing, isNew: false };
  }

  const kit = await Kit.create({
    userId,
    requestHash,
    job: { status: "pending", progress: 0, error: null },
    source: {
      company: "",
      company_url: input.companyUrl,
      role: "",
      location: "",
      jd_chars: input.jd.length,
      researched_at: "",
      pages_used: [],
    },
    role: { title: "", seniority: "", responsibilities: [], requirements: [] },
    schedule: { days_available: input.days, days: [] },
  });

  return { kit, isNew: true };
}

async function setJobStatus(
  kitId: string,
  status: "researching" | "generating" | "checking" | "ready" | "failed",
  progress: number,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await Kit.findByIdAndUpdate(kitId, { "job.status": status, "job.progress": progress, ...extra });
}

/**
 * The full pipeline glue, run as a background job so the request/response
 * cycle isn't blocked on 60-90s+ of crawling + LLM calls. Every stage
 * persists job.status/progress so the poll endpoint reflects real
 * progress; any failure lands the kit in job.status "failed" with a
 * structured {code,message} in job.error instead of throwing into the void.
 */
export async function runGenerationJob(
  kitId: string,
  input: CreateKitInput,
  geminiConfig: GeminiClientConfig,
  urlValidatorOptions: { blockPrivateNetworks: boolean },
): Promise<void> {
  try {
    await setJobStatus(kitId, "researching", 5);

    const initialValidation = await validateUrl(input.companyUrl, urlValidatorOptions);
    if (!initialValidation.ok) {
      throw new AppError("COMPANY_UNREACHABLE", `Company URL rejected: ${initialValidation.reason}`);
    }

    const crawl = await crawlCompanySite(input.companyUrl, { userAgent: USER_AGENT, urlValidatorOptions });
    const companyName = deriveCompanyNameFromUrl(input.companyUrl);
    const discussion = await searchPublicInterviewDiscussion(companyName, { userAgent: USER_AGENT });
    const hiringProcessNotes = discussion.found
      ? discussion.results.map((r) => `${r.title}: ${r.snippet}`).join("\n")
      : discussion.note;

    const researchPages = crawl.pages.map((p) => ({ url: p.finalUrl, text: p.text }));
    const { title, seniority } = deriveRoleBasics(input.jd);

    await setJobStatus(kitId, "generating", 25, {
      research: { pages: researchPages, hiringProcessNotes },
      source: {
        company: companyName,
        company_url: input.companyUrl,
        role: title,
        location: "",
        jd_chars: input.jd.length,
        researched_at: new Date().toISOString(),
        pages_used: crawl.pages.map((p) => p.finalUrl),
      },
      "role.title": title,
      "role.seniority": seniority,
    });

    const requirements = await extractRequirements(input.jd, { geminiConfig });
    const brief = await generateCompanyBrief(companyName, researchPages, geminiConfig);
    const companyContext = `${brief.summary}\n${brief.what_they_do}`;

    const initialQuestions = assignQuestionIds(
      await generateQuestionBank({ requirements, companyContext, hiringProcessNotes, geminiConfig }),
    );

    await setJobStatus(kitId, "checking", 70);

    const coverageResult = await runCoverageLoop({
      requirements,
      initialQuestions,
      companyContext,
      hiringProcessNotes,
      geminiConfig,
    });

    const flashcards = assignFlashcardIds(
      await generateFlashcards({ requirements, questions: coverageResult.questions, geminiConfig }),
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
      throw new AppError("KIT_VALIDATION_FAILED", `Generated kit failed structure validation: ${validation.errors.join("; ")}`);
    }

    await setJobStatus(kitId, "ready", 100, { ...finalKit, "job.error": null });
  } catch (err) {
    const appError = err instanceof AppError ? err : new AppError("INTERNAL_ERROR", (err as Error).message || "unknown error");
    await Kit.findByIdAndUpdate(kitId, { "job.status": "failed", "job.error": appError.toJSON() });
  }
}
