import { describe, expect, it } from "vitest";
import { isPathAllowed, parseRobotsTxt } from "../robots.js";

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
