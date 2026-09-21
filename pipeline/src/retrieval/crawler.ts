import { getRootDomain, isSiblingOrSameDomain } from "./domain.js";
import { fetchPage, type FetchedPage } from "./fetch-page.js";
import { isHiringLikePage, rankLinks, type LinkCandidate } from "./link-scoring.js";
import { createConcurrencyLimiter, withRetry } from "./rate-limit.js";
import { fetchRobotsRules, isPathAllowed } from "./robots.js";
import { validateUrl, type UrlValidatorOptions } from "./url-validator.js";

export interface CrawlOptions {
  userAgent: string;
  urlValidatorOptions: UrlValidatorOptions;
  maxPages?: number;
  concurrency?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

export interface SkippedSource {
  url: string;
  reason: string;
}

export interface CrawlResult {
  pages: FetchedPage[];
  skipped: SkippedSource[];
}

const DEFAULT_MAX_PAGES = 15;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RETRIES = 2;
const MAX_HOP_DEPTH = 2;

function normalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * BFS from the company's homepage, following links (not a fixed path list).
 * The homepage always expands to hop 1. Beyond that, only pages that look
 * like hiring/about content (per `isHiringLikePage`) expand further, so a
 * homepage can still reach hiring content buried a second hop deep without
 * the crawler wandering into unrelated site sections. Capped at `maxPages`
 * total fetches and `MAX_HOP_DEPTH` hops.
 */
export async function crawlCompanySite(startUrl: string, options: CrawlOptions): Promise<CrawlResult> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const retries = options.retries ?? DEFAULT_RETRIES;

  const startHost = safeHostname(startUrl);
  if (!startHost) {
    return { pages: [], skipped: [{ url: startUrl, reason: "invalid_url" }] };
  }
  const rootDomain = getRootDomain(startHost);

  const robots = await fetchRobotsRules(startUrl, options.userAgent, options.fetchImpl);
  const limiter = createConcurrencyLimiter(concurrency);
  const visited = new Set<string>([normalize(startUrl)]);
  const pages: FetchedPage[] = [];
  const skipped: SkippedSource[] = [];

  async function fetchOne(url: string): Promise<FetchedPage | null> {
    const validation = await validateUrl(url, options.urlValidatorOptions);
    if (!validation.ok) {
      skipped.push({ url, reason: validation.reason ?? "blocked" });
      return null;
    }

    let pathname: string;
    try {
      pathname = new URL(url).pathname;
    } catch {
      skipped.push({ url, reason: "invalid_url" });
      return null;
    }
    if (!isPathAllowed(robots, pathname)) {
      skipped.push({ url, reason: "robots_disallowed" });
      return null;
    }

    try {
      return await withRetry(
        () => limiter(() => fetchPage(url, { userAgent: options.userAgent, fetchImpl: options.fetchImpl })),
        { retries },
      );
    } catch {
      skipped.push({ url, reason: "fetch_failed" });
      return null;
    }
  }

  let frontier: LinkCandidate[] = [{ url: startUrl, anchorText: "" }];
  let depth = 0;

  while (frontier.length > 0 && pages.length < maxPages && depth <= MAX_HOP_DEPTH) {
    const budget = maxPages - pages.length;
    const toFetch = frontier.slice(0, budget);

    const results = await Promise.all(
      toFetch.map(async (candidate) => ({ candidate, page: await fetchOne(candidate.url) })),
    );

    const nextFrontier = new Map<string, LinkCandidate>();

    for (const { candidate, page } of results) {
      if (!page) continue;
      pages.push(page);

      const shouldExpand = depth === 0 || isHiringLikePage(candidate);
      if (!shouldExpand || depth >= MAX_HOP_DEPTH) continue;

      const sameCompanyLinks = page.links.filter((link) => {
        const host = safeHostname(link.url);
        return host !== null && isSiblingOrSameDomain(rootDomain, host);
      });

      for (const link of rankLinks(sameCompanyLinks)) {
        const norm = normalize(link.url);
        if (visited.has(norm)) continue;
        visited.add(norm);
        if (!nextFrontier.has(norm)) nextFrontier.set(norm, link);
      }
    }

    frontier = Array.from(nextFrontier.values());
    depth++;
  }

  return { pages, skipped };
}
