import * as cheerio from "cheerio";
import { fetchTextCapped } from "./http-safety.js";

export interface FetchedPage {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  text: string;
  links: { url: string; anchorText: string }[];
}

export interface FetchPageOptions {
  userAgent: string;
  maxBytes?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * fetches one page, checks the content type is html and stays under the
 * size cap, then strips the nav, header, footer, script and style tags
 * before returning clean text and the outbound links for the crawler to
 * follow. returns null on any failure instead of throwing, so the caller
 * can just record it and move on.
 */
export async function fetchPage(url: string, options: FetchPageOptions): Promise<FetchedPage | null> {
  const result = await fetchTextCapped(url, {
    fetchImpl: options.fetchImpl,
    maxBytes: options.maxBytes,
    timeoutMs: options.timeoutMs,
    headers: { "User-Agent": options.userAgent, Accept: "text/html" },
    requireContentTypeIncludes: "text/html",
  });
  if (!result.ok) return null;

  const { res, text: html } = result;
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, noscript, svg, iframe, template").remove();

  const title = $("title").first().text().trim();
  const text = $("body").text().replace(/\s+/g, " ").trim();

  const links: { url: string; anchorText: string }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let absolute: string;
    try {
      absolute = new URL(href, res.url || url).toString();
    } catch {
      return;
    }
    if (!absolute.startsWith("http")) return;
    links.push({ url: absolute, anchorText: $(el).text().trim() });
  });

  return { requestedUrl: url, finalUrl: res.url || url, title, text, links };
}
