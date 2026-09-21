import { z } from "zod";
import { generateJson, GeminiUnavailableError, type GeminiClientConfig } from "./gemini-client.js";
import { UNTRUSTED_DATA_WARNING, wrapUntrustedContent } from "./prompt-safety.js";

export interface RetrievedPage {
  url: string;
  text: string;
}

export interface CompanyBriefResult {
  summary: string;
  what_they_do: string;
  sources: string[];
}

const briefResponseSchema = z.object({ summary: z.string(), what_they_do: z.string() });

const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: { summary: { type: "STRING" }, what_they_do: { type: "STRING" } },
  required: ["summary", "what_they_do"],
};

const SYSTEM_INSTRUCTION = `You write a short company brief for someone preparing for a job interview.
Base your answer ONLY on the retrieved page text provided below. Do not use outside knowledge about
the company, and do not invent facts that aren't in the provided text. If the provided text is thin,
say plainly that research turned up limited information rather than padding the brief with guesses.
${UNTRUSTED_DATA_WARNING}
Respond only with JSON matching the schema.`;

const MAX_CHARS_PER_PAGE = 6000;

/**
 * bases the brief only on the retrieved page text. with zero pages, it
 * skips the llm call entirely and returns an honest, thin brief, since
 * there is nothing to base a summary on and generating one anyway would
 * just be guessing.
 */
export async function generateCompanyBrief(
  companyName: string,
  pages: RetrievedPage[],
  geminiConfig: GeminiClientConfig,
): Promise<CompanyBriefResult> {
  const sources = pages.map((p) => p.url);

  if (pages.length === 0) {
    return heuristicCompanyBrief(companyName, pages);
  }

  const prompt = `Company name: ${companyName || "(unknown)"}\n\n${wrapUntrustedContent(
    pages.map((p, i) => ({ label: `page_${i + 1}`, content: `URL: ${p.url}\n${p.text.slice(0, MAX_CHARS_PER_PAGE)}` })),
  )}`;

  try {
    const result = await generateJson(
      geminiConfig,
      { systemInstruction: SYSTEM_INSTRUCTION, prompt, responseSchema: GEMINI_RESPONSE_SCHEMA },
      (raw) => briefResponseSchema.parse(raw),
    );
    return { ...result, sources };
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      return heuristicCompanyBrief(companyName, pages);
    }
    throw err;
  }
}

/** plain fallback, reuses the first retrieved page's own text instead of writing new prose. */
export function heuristicCompanyBrief(companyName: string, pages: RetrievedPage[]): CompanyBriefResult {
  const sources = pages.map((p) => p.url);
  const firstPageText = pages[0]?.text.slice(0, 500).trim() ?? "";

  return {
    summary: firstPageText || `Research did not find usable page content for ${companyName || "this company"}.`,
    what_they_do: firstPageText || "Unknown — no company pages could be retrieved.",
    sources,
  };
}
