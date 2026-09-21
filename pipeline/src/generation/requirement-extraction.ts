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
 * Deterministic fallback used when Gemini is unavailable after retries (or
 * no API key is configured): splits the JD into lines and reuses that text
 * verbatim rather than inventing anything. A thin JD produces a thin,
 * honestly-labeled requirement set — priority defaults to "must" absent
 * explicit "nice to have"-style wording, matching how plain JD bullets are
 * conventionally read.
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
