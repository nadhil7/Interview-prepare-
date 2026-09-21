/**
 * `npm run evaluate -- --input <cases.json> --output <kits.json>`
 *
 * Batch-evaluates a list of (jd, company_url, days) cases through the exact
 * same pipeline.generateKit function the backend's background job calls —
 * no parallel implementation of the crawl->extract->generate pipeline.
 * Continues past a failed case (records it, keeps going) rather than
 * aborting the whole run.
 */
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  createConcurrencyLimiter,
  createLimitedFetch,
  DEFAULT_GEMINI_MODEL,
  generateKit,
  PipelineError,
  type Kit,
} from "@aipk/pipeline";
import { z } from "zod";

const CASE_CONCURRENCY_DEFAULT = 3;
const GEMINI_CONCURRENCY = 2;

const caseInputSchema = z.object({
  id: z.string().min(1),
  jd: z.string().min(1),
  company_url: z.string().url(),
  days: z.number().int().min(1).max(60),
});

interface KitResultEntry {
  id: string;
  status: "ok" | "failed";
  kit: Kit | null;
  error: { code: string; message: string } | null;
}

interface OutputFile {
  version: string;
  generated_at: string;
  kits: KitResultEntry[];
}

function parseArgs(argv: string[]): { input?: string; output?: string; concurrency?: number } {
  const args: { input?: string; output?: string; concurrency?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") args.input = argv[++i];
    else if (argv[i] === "--output") args.output = argv[++i];
    else if (argv[i] === "--concurrency") args.concurrency = Number(argv[++i]);
  }
  return args;
}

async function readCases(inputPath: string): Promise<unknown[]> {
  let raw: string;
  try {
    raw = await readFile(inputPath, "utf-8");
  } catch (err) {
    throw new Error(`Could not read input file "${inputPath}": ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Input file "${inputPath}" is not valid JSON: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Input file "${inputPath}" must contain a JSON array of cases.`);
  }

  return parsed;
}

async function runCase(
  rawCase: unknown,
  geminiConfig: Parameters<typeof generateKit>[1]["geminiConfig"],
  urlValidatorOptions: Parameters<typeof generateKit>[1]["urlValidatorOptions"],
): Promise<KitResultEntry> {
  const parsedCase = caseInputSchema.safeParse(rawCase);
  if (!parsedCase.success) {
    const id = typeof (rawCase as { id?: unknown })?.id === "string" ? (rawCase as { id: string }).id : "unknown";
    return {
      id,
      status: "failed",
      kit: null,
      error: { code: "INVALID_INPUT", message: parsedCase.error.issues.map((i) => i.message).join("; ") },
    };
  }

  const input = parsedCase.data;
  try {
    const result = await generateKit(
      { jd: input.jd, companyUrl: input.company_url, days: input.days },
      { geminiConfig, urlValidatorOptions },
    );
    return { id: input.id, status: "ok", kit: result.kit, error: null };
  } catch (err) {
    const pipelineError =
      err instanceof PipelineError ? err : new PipelineError("INTERNAL_ERROR", (err as Error).message || "unknown error");
    console.error(`case "${input.id}" failed: ${pipelineError.code} - ${pipelineError.message}`);
    return { id: input.id, status: "failed", kit: null, error: pipelineError.toJSON() };
  }
}

export async function evaluate(inputPath: string, outputPath: string, concurrency = CASE_CONCURRENCY_DEFAULT): Promise<void> {
  const rawCases = await readCases(inputPath);

  const geminiConfig = {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    fetchImpl: createLimitedFetch(GEMINI_CONCURRENCY),
  };
  // Company sites used with this command may be served from a local
  // address (the grading harness's fixture server) — never assume
  // production-only SSRF protection here.
  const urlValidatorOptions = { blockPrivateNetworks: false };

  const limiter = createConcurrencyLimiter(concurrency);

  const kits = await Promise.all(rawCases.map((c) => limiter(() => runCase(c, geminiConfig, urlValidatorOptions))));

  const output: OutputFile = { version: "1.0", generated_at: new Date().toISOString(), kits };
  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf-8");

  const failedCount = kits.filter((k) => k.status === "failed").length;
  console.log(`Processed ${kits.length} case(s): ${kits.length - failedCount} ok, ${failedCount} failed. Wrote ${outputPath}.`);
}

async function main() {
  const { input, output, concurrency } = parseArgs(process.argv.slice(2));
  if (!input || !output) {
    console.error("Usage: npm run evaluate -- --input <cases.json> --output <kits.json>");
    process.exit(1);
  }

  await evaluate(input, output, concurrency);
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    console.error("evaluate failed:", (err as Error).message);
    process.exit(1);
  });
}
