export interface LinkCandidate {
  url: string;
  anchorText: string;
}

export interface ScoredLink extends LinkCandidate {
  score: number;
}

const INTERVIEW_PROCESS_KEYWORDS = [
  "interview",
  "hiring-process",
  "how-we-hire",
  "recruitment-process",
];

const HIRING_KEYWORDS = [
  "career",
  "careers",
  "jobs",
  "job",
  "hiring",
  "join-us",
  "join us",
  "work-with-us",
  "opportunities",
  "openings",
  "positions",
  "vacancies",
];

const ABOUT_KEYWORDS = ["about", "about-us", "team", "company", "mission", "culture", "who-we-are"];

function haystackFor(link: LinkCandidate): string {
  return `${link.url} ${link.anchorText}`.toLowerCase();
}

/**
 * Higher score = stronger signal the link leads to hiring-process or
 * about-the-company content worth crawling. Pure function, no I/O — the
 * crawler is the only thing that decides what to do with the ranking.
 */
export function scoreLink(link: LinkCandidate): number {
  const haystack = haystackFor(link);
  let score = 0;
  if (INTERVIEW_PROCESS_KEYWORDS.some((k) => haystack.includes(k))) score += 5;
  if (HIRING_KEYWORDS.some((k) => haystack.includes(k))) score += 3;
  if (ABOUT_KEYWORDS.some((k) => haystack.includes(k))) score += 1;
  return score;
}

export function rankLinks(links: LinkCandidate[]): ScoredLink[] {
  return links
    .map((link) => ({ ...link, score: scoreLink(link) }))
    .sort((a, b) => b.score - a.score);
}

/** Used by the crawler to decide whether a page is worth a second hop from. */
export function isHiringLikePage(link: LinkCandidate): boolean {
  const haystack = haystackFor(link);
  return (
    INTERVIEW_PROCESS_KEYWORDS.some((k) => haystack.includes(k)) ||
    HIRING_KEYWORDS.some((k) => haystack.includes(k)) ||
    ABOUT_KEYWORDS.some((k) => haystack.includes(k))
  );
}
