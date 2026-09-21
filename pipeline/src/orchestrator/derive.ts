/**
 * cheap, plain guesses that are not worth a gemini call. if they guess
 * wrong the user, or whoever is reviewing a batch case, can just edit the
 * field. this only gives a reasonable starting point.
 */
export function deriveCompanyNameFromUrl(companyUrl: string): string {
  try {
    const hostname = new URL(companyUrl).hostname.replace(/^www\./, "");
    const label = hostname.split(".")[0] ?? hostname;
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return "";
  }
}

const SENIORITY_KEYWORDS: Array<[RegExp, string]> = [
  [/\b(staff|principal)\b/i, "staff/principal"],
  [/\b(senior|sr\.?)\b/i, "senior"],
  [/\b(lead)\b/i, "lead"],
  [/\b(junior|jr\.?|entry.level)\b/i, "junior"],
  [/\b(intern)\b/i, "intern"],
];

export function deriveRoleBasics(jobDescription: string): { title: string; seniority: string } {
  const firstLine = jobDescription
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);

  const title = firstLine?.slice(0, 200) ?? "";
  const seniority = SENIORITY_KEYWORDS.find(([re]) => re.test(jobDescription))?.[1] ?? "unspecified";

  return { title, seniority };
}
