import { describe, expect, it } from "vitest";
import { fetchPage } from "../fetch-page.js";

const SAMPLE_HTML = `
<html>
  <head><title>Acme Careers</title></head>
  <body>
    <nav>Nav noise that should be stripped</nav>
    <header>Header noise</header>
    <main>
      <h1>Join Acme</h1>
      <p>We build widgets and hire globally.</p>
      <a href="/about">About us</a>
      <a href="https://acme.example/careers/engineering">Engineering roles</a>
    </main>
    <footer>Footer noise that should be stripped</footer>
    <script>console.log("should be stripped")</script>
  </body>
</html>
`;

function makeResponse(opts: {
  ok: boolean;
  contentType?: string;
  contentLength?: string;
  body: string;
  url?: string;
}): Response {
  const headers = new Map<string, string>();
  if (opts.contentType) headers.set("content-type", opts.contentType);
  if (opts.contentLength) headers.set("content-length", opts.contentLength);

  const encoder = new TextEncoder();
  const bytes = encoder.encode(opts.body);

  return {
    ok: opts.ok,
    url: opts.url ?? "https://acme.example/careers",
    headers: { get: (key: string) => headers.get(key.toLowerCase()) ?? null },
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: bytes };
          },
          async cancel() {},
        };
      },
    },
    text: async () => opts.body,
  } as unknown as Response;
}

describe("fetchPage", () => {
  it("strips nav/header/footer/script and returns clean text plus absolute links", async () => {
    const fetchImpl = (async () =>
      makeResponse({ ok: true, contentType: "text/html; charset=utf-8", body: SAMPLE_HTML })) as typeof fetch;

    const page = await fetchPage("https://acme.example/careers", { userAgent: "AIPKBot", fetchImpl });

    expect(page).not.toBeNull();
    expect(page!.title).toBe("Acme Careers");
    expect(page!.text).not.toMatch(/Nav noise/);
    expect(page!.text).not.toMatch(/Footer noise/);
    expect(page!.text).not.toMatch(/should be stripped/);
    expect(page!.text).toMatch(/We build widgets/);
    expect(page!.links).toContainEqual({ url: "https://acme.example/about", anchorText: "About us" });
    expect(page!.links).toContainEqual({
      url: "https://acme.example/careers/engineering",
      anchorText: "Engineering roles",
    });
  });

  it("returns null for a non-HTML content type", async () => {
    const fetchImpl = (async () =>
      makeResponse({ ok: true, contentType: "application/pdf", body: "%PDF-1.4" })) as typeof fetch;
    const page = await fetchPage("https://acme.example/resume.pdf", { userAgent: "AIPKBot", fetchImpl });
    expect(page).toBeNull();
  });

  it("returns null when the declared content-length exceeds the byte cap", async () => {
    const fetchImpl = (async () =>
      makeResponse({
        ok: true,
        contentType: "text/html",
        contentLength: String(10_000_000),
        body: SAMPLE_HTML,
      })) as typeof fetch;
    const page = await fetchPage("https://acme.example/huge", {
      userAgent: "AIPKBot",
      fetchImpl,
      maxBytes: 2_000_000,
    });
    expect(page).toBeNull();
  });

  it("returns null when the actual body exceeds the byte cap even without a content-length header", async () => {
    const bigBody = `<html><body>${"x".repeat(1000)}</body></html>`;
    const fetchImpl = (async () =>
      makeResponse({ ok: true, contentType: "text/html", body: bigBody })) as typeof fetch;
    const page = await fetchPage("https://acme.example/huge", {
      userAgent: "AIPKBot",
      fetchImpl,
      maxBytes: 100,
    });
    expect(page).toBeNull();
  });

  it("returns null on a non-ok HTTP status", async () => {
    const fetchImpl = (async () =>
      makeResponse({ ok: false, contentType: "text/html", body: "not found" })) as typeof fetch;
    const page = await fetchPage("https://acme.example/missing", { userAgent: "AIPKBot", fetchImpl });
    expect(page).toBeNull();
  });

  it("returns null when the fetch itself throws", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const page = await fetchPage("https://acme.example/careers", { userAgent: "AIPKBot", fetchImpl });
    expect(page).toBeNull();
  });
});
