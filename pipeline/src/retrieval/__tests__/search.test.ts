import { describe, expect, it } from "vitest";
import { parseDuckDuckGoHtml, searchPublicInterviewDiscussion } from "../search.js";

const SAMPLE_RESULTS_HTML = `
<div class="results">
  <div class="result">
    <a class="result__a" href="https://forum.example/thread/1">Acme interview experience</a>
    <a class="result__snippet">Had a take-home and a system design round...</a>
  </div>
  <div class="result">
    <a class="result__a" href="https://forum.example/thread/2">Acme onsite loop notes</a>
    <a class="result__snippet">Three behavioural rounds and one technical...</a>
  </div>
</div>
`;

function fakeFetch(response: { ok: boolean; status?: number; text: string }): typeof fetch {
  return (async () =>
    ({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      text: async () => response.text,
    }) as Response) as typeof fetch;
}

describe("parseDuckDuckGoHtml", () => {
  it("extracts title, url, and snippet from result blocks", () => {
    const results = parseDuckDuckGoHtml(SAMPLE_RESULTS_HTML);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Acme interview experience",
      url: "https://forum.example/thread/1",
      snippet: "Had a take-home and a system design round...",
    });
  });

  it("returns an empty array when there are no result blocks", () => {
    expect(parseDuckDuckGoHtml("<html><body>no results here</body></html>")).toEqual([]);
  });
});

describe("searchPublicInterviewDiscussion", () => {
  it("returns found:true with parsed results when the search succeeds", async () => {
    const outcome = await searchPublicInterviewDiscussion("Acme", {
      userAgent: "AIPKBot",
      fetchImpl: fakeFetch({ ok: true, text: SAMPLE_RESULTS_HTML }),
    });
    expect(outcome.found).toBe(true);
    expect(outcome.results).toHaveLength(2);
  });

  it("honestly reports nothing found rather than fabricating results", async () => {
    const outcome = await searchPublicInterviewDiscussion("ObscureCo", {
      userAgent: "AIPKBot",
      fetchImpl: fakeFetch({ ok: true, text: "<html><body>no results</body></html>" }),
    });
    expect(outcome.found).toBe(false);
    expect(outcome.results).toEqual([]);
    expect(outcome.note).toMatch(/no public discussion/i);
  });

  it("honestly reports a failed request rather than fabricating results", async () => {
    const outcome = await searchPublicInterviewDiscussion("Acme", {
      userAgent: "AIPKBot",
      fetchImpl: fakeFetch({ ok: false, status: 503, text: "" }),
    });
    expect(outcome.found).toBe(false);
    expect(outcome.note).toMatch(/503/);
  });
});
