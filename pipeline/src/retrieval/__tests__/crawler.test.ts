import { describe, expect, it } from "vitest";
import { crawlCompanySite } from "../crawler.js";

/**
 * fake site graph:
 *   / (home)   goes to /pricing (generic), /careers (looks like hiring), /about (looks like hiring)
 *   /careers   goes to /careers/interview-process, only reachable through a second hop
 *   /about     goes to /about/team, only reachable through a second hop
 *   /pricing   goes to /pricing/details, which should not be reached since pricing does not look like hiring
 * checks that the homepage always expands to the first hop, only pages
 * that look like hiring or about content expand to the second hop, and a
 * page from the first hop that does not look like hiring does not expand.
 */
const PAGES: Record<string, string> = {
  "https://acme.example/": html("Acme", [
    ["/pricing", "Pricing"],
    ["/careers", "Careers"],
    ["/about", "About us"],
  ]),
  "https://acme.example/careers": html("Careers", [["/careers/interview-process", "Our interview process"]]),
  "https://acme.example/about": html("About", [["/about/team", "Meet the team"]]),
  "https://acme.example/pricing": html("Pricing", [["/pricing/details", "Plan details"]]),
  "https://acme.example/careers/interview-process": html("Interview Process", []),
  "https://acme.example/about/team": html("Team", []),
  "https://acme.example/pricing/details": html("Pricing Details", []),
};

function html(title: string, links: [string, string][]): string {
  const anchors = links.map(([href, text]) => `<a href="${href}">${text}</a>`).join("\n");
  return `<html><head><title>${title}</title></head><body>${anchors}</body></html>`;
}

function makeFakeFetch(pages: Record<string, string>, extra: Record<string, string> = {}): typeof fetch {
  return (async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/robots.txt")) {
      return { ok: false, url, headers: { get: () => null }, text: async () => "" } as unknown as Response;
    }
    const body = pages[url] ?? extra[url];
    if (body === undefined) {
      return { ok: false, url, headers: { get: () => null }, text: async () => "not found" } as unknown as Response;
    }
    return {
      ok: true,
      url,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/html" : null) },
      body: {
        getReader() {
          let sent = false;
          return {
            async read() {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: new TextEncoder().encode(body) };
            },
            async cancel() {},
          };
        },
      },
      text: async () => body,
    } as unknown as Response;
  }) as typeof fetch;
}

describe("crawlCompanySite", () => {
  it("reaches hiring content buried a second hop deep via careers/about pages, but not via pricing", async () => {
    const result = await crawlCompanySite("https://acme.example/", {
      userAgent: "AIPKBot",
      urlValidatorOptions: { blockPrivateNetworks: false },
      fetchImpl: makeFakeFetch(PAGES),
      maxPages: 20,
      concurrency: 2,
      retries: 0,
    });

    const fetchedUrls = result.pages.map((p) => p.finalUrl);
    expect(fetchedUrls).toContain("https://acme.example/careers/interview-process");
    expect(fetchedUrls).toContain("https://acme.example/about/team");
    expect(fetchedUrls).not.toContain("https://acme.example/pricing/details");
  });

  it("caps total pages fetched at maxPages", async () => {
    const result = await crawlCompanySite("https://acme.example/", {
      userAgent: "AIPKBot",
      urlValidatorOptions: { blockPrivateNetworks: false },
      fetchImpl: makeFakeFetch(PAGES),
      maxPages: 2,
      concurrency: 2,
      retries: 0,
    });

    expect(result.pages.length).toBeLessThanOrEqual(2);
  });

  it("does not follow a link that points off the company's domain", async () => {
    const pagesWithExternalLink: Record<string, string> = {
      ...PAGES,
      "https://acme.example/": html("Acme", [
        ["/careers", "Careers"],
        ["https://evil.example/phish", "Totally legit external careers link"],
      ]),
    };

    const result = await crawlCompanySite("https://acme.example/", {
      userAgent: "AIPKBot",
      urlValidatorOptions: { blockPrivateNetworks: false },
      fetchImpl: makeFakeFetch(pagesWithExternalLink, { "https://evil.example/phish": html("Phish", []) }),
      maxPages: 20,
      concurrency: 2,
      retries: 0,
    });

    expect(result.pages.map((p) => p.finalUrl)).not.toContain("https://evil.example/phish");
  });

  it("skips and records the start URL when the SSRF guard rejects it, instead of throwing", async () => {
    const result = await crawlCompanySite("http://127.0.0.1/", {
      userAgent: "AIPKBot",
      urlValidatorOptions: { blockPrivateNetworks: true },
      fetchImpl: makeFakeFetch({ "http://127.0.0.1/": html("Internal", []) }),
      maxPages: 20,
      concurrency: 2,
      retries: 0,
    });

    expect(result.pages).toHaveLength(0);
    expect(result.skipped).toContainEqual({ url: "http://127.0.0.1/", reason: "private_or_loopback_address" });
  });
});
