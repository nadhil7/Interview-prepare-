import { fetchTextCapped } from "./http-safety.js";

export interface RobotsRules {
  disallowedPaths: string[];
}

const MAX_ROBOTS_BYTES = 200_000;

/**
 * a small robots.txt reader. it finds the group that matches our user
 * agent, or falls back to the wildcard group, and collects its disallow
 * paths. allow rules and crawl delay settings are not handled here.
 */
export function parseRobotsTxt(content: string, userAgent: string): RobotsRules {
  const lines = content.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim());

  type Group = { agents: string[]; disallow: string[] };
  const groups: Group[] = [];
  let current: Group | null = null;

  for (const line of lines) {
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      if (!current || current.disallow.length > 0) {
        current = { agents: [value.toLowerCase()], disallow: [] };
        groups.push(current);
      } else {
        current.agents.push(value.toLowerCase());
      }
    } else if (key === "disallow" && current) {
      if (value) current.disallow.push(value);
    }
  }

  const ua = userAgent.toLowerCase();
  const exactMatch = groups.find((g) => g.agents.includes(ua));
  const wildcardMatch = groups.find((g) => g.agents.includes("*"));
  const chosen = exactMatch ?? wildcardMatch;

  return { disallowedPaths: chosen?.disallow ?? [] };
}

export function isPathAllowed(rules: RobotsRules, pathname: string): boolean {
  return !rules.disallowedPaths.some((disallowed) => disallowed !== "" && pathname.startsWith(disallowed));
}

export async function fetchRobotsRules(
  baseUrl: string,
  userAgent: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RobotsRules> {
  const robotsUrl = new URL("/robots.txt", baseUrl).toString();
  const result = await fetchTextCapped(robotsUrl, {
    fetchImpl,
    maxBytes: MAX_ROBOTS_BYTES,
    headers: { "User-Agent": userAgent },
  });

  // if robots.txt can't be reached, is too large, or anything else goes
  // wrong, allow everything by default. that matches how most crawlers
  // behave, since a missing or broken file isn't a rule.
  if (!result.ok) return { disallowedPaths: [] };

  return parseRobotsTxt(result.text, userAgent);
}
