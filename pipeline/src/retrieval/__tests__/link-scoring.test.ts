import { describe, expect, it } from "vitest";
import { isHiringLikePage, rankLinks, scoreLink } from "../link-scoring.js";

describe("scoreLink", () => {
  it("scores an interview-process link highest", () => {
    const score = scoreLink({ url: "https://acme.example/careers/interview-process", anchorText: "Our interview process" });
    expect(score).toBeGreaterThan(scoreLink({ url: "https://acme.example/careers", anchorText: "Careers" }));
  });

  it("scores a careers/jobs link above an about page", () => {
    const jobs = scoreLink({ url: "https://acme.example/jobs", anchorText: "Jobs" });
    const about = scoreLink({ url: "https://acme.example/about", anchorText: "About us" });
    expect(jobs).toBeGreaterThan(about);
  });

  it("scores an unrelated page (e.g. pricing) as zero", () => {
    expect(scoreLink({ url: "https://acme.example/pricing", anchorText: "Pricing" })).toBe(0);
  });

  it("picks up signal from anchor text even when the URL path is generic", () => {
    const score = scoreLink({ url: "https://acme.example/page?id=42", anchorText: "We're hiring!" });
    expect(score).toBeGreaterThan(0);
  });
});

describe("rankLinks", () => {
  it("sorts links descending by score", () => {
    const links = [
      { url: "https://acme.example/pricing", anchorText: "Pricing" },
      { url: "https://acme.example/careers/interview-process", anchorText: "Interview process" },
      { url: "https://acme.example/about", anchorText: "About" },
      { url: "https://acme.example/careers", anchorText: "Careers" },
    ];

    const ranked = rankLinks(links);

    expect(ranked.map((l) => l.url)).toEqual([
      "https://acme.example/careers/interview-process",
      "https://acme.example/careers",
      "https://acme.example/about",
      "https://acme.example/pricing",
    ]);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[ranked.length - 1]!.score);
  });

  it("returns an empty array for an empty input", () => {
    expect(rankLinks([])).toEqual([]);
  });
});

describe("isHiringLikePage", () => {
  it("treats a careers link as hiring-like", () => {
    expect(isHiringLikePage({ url: "https://acme.example/careers", anchorText: "Careers" })).toBe(true);
  });

  it("treats an about link as hiring-like (worth a second hop for company info)", () => {
    expect(isHiringLikePage({ url: "https://acme.example/about-us", anchorText: "About" })).toBe(true);
  });

  it("does not treat an unrelated page as hiring-like", () => {
    expect(isHiringLikePage({ url: "https://acme.example/pricing", anchorText: "Pricing" })).toBe(false);
  });
});
