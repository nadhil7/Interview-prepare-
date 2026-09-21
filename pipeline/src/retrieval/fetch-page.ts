import * as cheerio from "cheerio";

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

const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * fetches one page, checks the content type is html and stays under the
 * size cap, then strips the nav, header, footer, script and style tags
 * before returning clean text and the outbound links for the crawler to
 * follow. returns null on any failure instead of throwing, so the caller
 * can just record it and move on.
 */
export async function fetchPage(url: string, options: FetchPageOptions): Promise<FetchedPage | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { "User-Agent": options.userAgent, Accept: "text/html" },
      redirect: "follow",
    });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    const declaredLength = Number(res.headers.get("content-length") ?? "0");
    if (declaredLength && declaredLength > maxBytes) return null;

    const html = await readBodyCapped(res, maxBytes);
    if (html === null) return null;

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
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function readBodyCapped(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return res.text();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}
