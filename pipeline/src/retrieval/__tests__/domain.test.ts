import { describe, expect, it } from "vitest";
import { getRootDomain, isSiblingOrSameDomain } from "../domain.js";

describe("getRootDomain", () => {
  it("strips subdomains down to the last two labels", () => {
    expect(getRootDomain("www.acme.com")).toBe("acme.com");
    expect(getRootDomain("careers.jobs.acme.com")).toBe("acme.com");
  });

  it("leaves a bare two-label domain unchanged", () => {
    expect(getRootDomain("acme.com")).toBe("acme.com");
  });
});

describe("isSiblingOrSameDomain", () => {
  it("allows the exact same host", () => {
    expect(isSiblingOrSameDomain("acme.com", "acme.com")).toBe(true);
  });

  it("allows a sibling subdomain", () => {
    expect(isSiblingOrSameDomain("acme.com", "careers.acme.com")).toBe(true);
    expect(isSiblingOrSameDomain("acme.com", "jobs.acme.com")).toBe(true);
  });

  it("rejects an unrelated domain", () => {
    expect(isSiblingOrSameDomain("acme.com", "notacme.com")).toBe(false);
    expect(isSiblingOrSameDomain("acme.com", "evil.com")).toBe(false);
  });

  it("rejects a lookalike domain that merely contains the root as a suffix of a longer label", () => {
    expect(isSiblingOrSameDomain("acme.com", "acme.com.evil.com")).toBe(false);
  });
});
