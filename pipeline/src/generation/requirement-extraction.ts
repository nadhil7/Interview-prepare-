import { z } from "zod";
import { requirementKindSchema, requirementPrioritySchema, type Requirement } from "../schema/kit.js";
import { generateJson, GeminiUnavailableError, type GeminiClientConfig } from "./gemini-client.js";
import { UNTRUSTED_DATA_WARNING, wrapUntrustedContent } from "./prompt-safety.js";

const extractedRequirementSchema = z.object({
  text: z.string().min(1),
  kind: requirementKindSchema,
  priority: requirementPrioritySchema,
});
const extractionResponseSchema = z.object({ requirements: z.array(extractedRequirementSchema) });

const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    requirements: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING" },
          kind: { type: "STRING", enum: ["technical", "behavioural", "domain"] },
          priority: { type: "STRING", enum: ["must", "nice"] },
        },
        required: ["text", "kind", "priority"],
      },
    },
  },
  required: ["requirements"],
};

const SYSTEM_INSTRUCTION = `You extract job requirements from a job description for interview-prep purposes.
Rules:
- Only extract requirements actually stated in the job description text below. Never invent requirements it doesn't contain.
- priority "must": wording like "required", "must have", "X+ years of experience", "minimum qualifications".
- priority "nice": wording like "nice to have", "bonus", "a plus", "preferred but not required", "bonus points for".
- kind "technical": tools/languages/frameworks/systems skills. "behavioural": soft skills, communication, leadership, teamwork. "domain": industry/business-domain knowledge (e.g. "healthcare experience", "fintech background").
- If the job description is thin, return few or even zero requirements rather than padding the list to look complete.
${UNTRUSTED_DATA_WARNING}
Respond only with JSON matching the schema.`;

export interface ExtractRequirementsOptions {
  geminiConfig: GeminiClientConfig;
}

export async function extractRequirements(
  jobDescription: string,
  options: ExtractRequirementsOptions,
): Promise<Requirement[]> {
  const prompt = `Extract the requirements from the job description below.\n\n${wrapUntrustedContent([
    { label: "job_description", content: jobDescription },
  ])}`;

  try {
    const result = await generateJson(
      options.geminiConfig,
      { systemInstruction: SYSTEM_INSTRUCTION, prompt, responseSchema: GEMINI_RESPONSE_SCHEMA },
      (raw) => extractionResponseSchema.parse(raw),
    );
    return assignRequirementIds(result.requirements);
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      return assignRequirementIds(heuristicExtractRequirements(jobDescription));
    }
    throw err;
  }
}

export function assignRequirementIds(items: Array<Omit<Requirement, "id">>): Requirement[] {
  return items.map((item, i) => ({ id: `r${i + 1}`, ...item }));
}

const NICE_WORDING = [/\bnice to have\b/i, /\bbonus\b/i, /\ba plus\b/i, /\bpreferred\b/i, /\boptional\b/i];
const BEHAVIOURAL_WORDING = [/communicat/i, /leadership/i, /team\s?work/i, /collaborat/i, /stakeholder/i, /mentor/i];
const DOMAIN_WORDING = [/industry/i, /domain knowledge/i, /regulatory/i, /compliance/i, /healthcare/i, /fintech/i];

/**
 * plain fallback used when gemini is unavailable after retries, or no api
 * key is set at all. splits the job description into lines and reuses that
 * text as is instead of making anything up. a thin job description ends up
 * with a thin, honest requirement list. priority defaults to must unless
 * the line has clear nice to have wording, matching how plain bullet
 * points are usually read.
 */
export function heuristicExtractRequirements(jobDescription: string): Array<Omit<Requirement, "id">> {
  const lines = jobDescription
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s\-*•]+/, "").trim())
    .filter((l) => l.length > 12 && l.split(/\s+/).length >= 4);

  return lines.map((text) => ({
    text,
    kind: BEHAVIOURAL_WORDING.some((re) => re.test(text))
      ? "behavioural"
      : DOMAIN_WORDING.some((re) => re.test(text))
        ? "domain"
        : "technical",
    priority: NICE_WORDING.some((re) => re.test(text)) ? "nice" : "must",
  }));
}
