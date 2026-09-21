import { describe, expect, it } from "vitest";
import { fetchRobotsRules, isPathAllowed, parseRobotsTxt } from "../robots.js";

function fakeFetch(response: { ok: boolean; text?: string; headers?: Record<string, string> }): typeof fetch {
  return (async () =>
    ({
      ok: response.ok,
      status: response.ok ? 200 : 404,
      headers: { get: (key: string) => response.headers?.[key.toLowerCase()] ?? null },
      text: async () => response.text ?? "",
    }) as unknown as Response) as typeof fetch;
}

describe("parseRobotsTxt", () => {
  it("collects Disallow rules for a wildcard group", () => {
    const content = `
      User-agent: *
      Disallow: /admin
      Disallow: /private
    `;
    const rules = parseRobotsTxt(content, "AIPKBot");
    expect(rules.disallowedPaths).toEqual(["/admin", "/private"]);
  });

  it("prefers an exact user-agent match over the wildcard group", () => {
    const content = `
      User-agent: *
      Disallow: /everything

      User-agent: AIPKBot
      Disallow: /only-this
    `;
    const rules = parseRobotsTxt(content, "AIPKBot");
    expect(rules.disallowedPaths).toEqual(["/only-this"]);
  });

  it("returns no restrictions when nothing matches", () => {
    const content = `User-agent: SomeOtherBot\nDisallow: /x`;
    const rules = parseRobotsTxt(content, "AIPKBot");
    expect(rules.disallowedPaths).toEqual([]);
  });

  it("shares a rule block across multiple listed agents", () => {
    const content = `
      User-agent: BotA
      User-agent: BotB
      Disallow: /shared
    `;
    expect(parseRobotsTxt(content, "BotA").disallowedPaths).toEqual(["/shared"]);
    expect(parseRobotsTxt(content, "BotB").disallowedPaths).toEqual(["/shared"]);
  });

  it("ignores comments", () => {
    const content = `
      # comment line
      User-agent: * # inline comment
      Disallow: /secret # also a comment
    `;
    expect(parseRobotsTxt(content, "AIPKBot").disallowedPaths).toEqual(["/secret"]);
  });
});

describe("fetchRobotsRules", () => {
  it("fetches and parses a reachable robots.txt", async () => {
    const fetchImpl = fakeFetch({ ok: true, text: "User-agent: *\nDisallow: /admin" });
    const rules = await fetchRobotsRules("https://acme.example/", "AIPKBot", fetchImpl);
    expect(rules.disallowedPaths).toEqual(["/admin"]);
  });

  it("allows everything when robots.txt is unreachable", async () => {
    const fetchImpl = fakeFetch({ ok: false });
    const rules = await fetchRobotsRules("https://acme.example/", "AIPKBot", fetchImpl);
    expect(rules.disallowedPaths).toEqual([]);
  });

  it("allows everything rather than reading an oversized robots.txt", async () => {
    const fetchImpl = fakeFetch({ ok: true, text: "User-agent: *\nDisallow: /admin", headers: { "content-length": "99999999" } });
    const rules = await fetchRobotsRules("https://acme.example/", "AIPKBot", fetchImpl);
    expect(rules.disallowedPaths).toEqual([]);
  });
});

describe("isPathAllowed", () => {
  it("blocks a path under a disallowed prefix", () => {
    expect(isPathAllowed({ disallowedPaths: ["/admin"] }, "/admin/settings")).toBe(false);
  });

  it("allows a path outside disallowed prefixes", () => {
    expect(isPathAllowed({ disallowedPaths: ["/admin"] }, "/careers")).toBe(true);
  });

  it("allows everything when there are no rules", () => {
    expect(isPathAllowed({ disallowedPaths: [] }, "/anything")).toBe(true);
  });
});
