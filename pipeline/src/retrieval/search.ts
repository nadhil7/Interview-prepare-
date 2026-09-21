import * as cheerio from "cheerio";

export interface DiscussionResult {
  title: string;
  url: string;
  snippet: string;
}

export interface DiscussionSearchOutcome {
  found: boolean;
  results: DiscussionResult[];
  /** a plain note for when nothing turned up or the search itself failed, instead of making something up. */
  note?: string;
}

export interface SearchOptions {
  userAgent: string;
  fetchImpl?: typeof fetch;
}

/**
 * searches duckduckgo's plain html page for public discussion of a
 * company's interview process. no api key needed, which fits the free
 * tier the rest of this project runs on. if nothing useful turns up, or
 * the request fails, that gets written into note honestly instead of
 * making something up.
 */
export async function searchPublicInterviewDiscussion(
  companyName: string,
  options: SearchOptions,
): Promise<DiscussionSearchOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const query = `${companyName} interview process experience`;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  let html: string;
  try {
    const res = await fetchImpl(url, { headers: { "User-Agent": options.userAgent } });
    if (!res.ok) {
      return { found: false, results: [], note: `search request failed with status ${res.status}` };
    }
    html = await res.text();
  } catch (err) {
    return { found: false, results: [], note: `search unavailable: ${(err as Error).message}` };
  }

  const results = parseDuckDuckGoHtml(html);
  if (results.length === 0) {
    return { found: false, results: [], note: "no public discussion of the interview process was found" };
  }
  return { found: true, results };
}

export function parseDuckDuckGoHtml(html: string): DiscussionResult[] {
  const $ = cheerio.load(html);
  const results: DiscussionResult[] = [];

  $(".result").each((_, el) => {
    const titleEl = $(el).find(".result__a").first();
    const title = titleEl.text().trim();
    const href = titleEl.attr("href");
    const snippet = $(el).find(".result__snippet").first().text().trim();
    if (title && href) {
      results.push({ title, url: href, snippet });
    }
  });

  return results;
}
