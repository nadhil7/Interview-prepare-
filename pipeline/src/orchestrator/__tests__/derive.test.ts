import { describe, expect, it } from "vitest";
import { deriveCompanyNameFromUrl, deriveRoleBasics } from "../derive.js";

describe("deriveCompanyNameFromUrl", () => {
  it("capitalizes the first label of the hostname, stripping www", () => {
    expect(deriveCompanyNameFromUrl("https://www.acme.com/careers")).toBe("Acme");
    expect(deriveCompanyNameFromUrl("https://acme.io")).toBe("Acme");
  });

  it("returns an empty string for a malformed URL rather than throwing", () => {
    expect(deriveCompanyNameFromUrl("not a url")).toBe("");
  });
});

describe("deriveRoleBasics", () => {
  it("uses the first non-empty line as the title", () => {
    expect(deriveRoleBasics("Senior Backend Engineer\n\nWe are looking for...").title).toBe("Senior Backend Engineer");
  });

  it("detects seniority keywords", () => {
    expect(deriveRoleBasics("Senior Backend Engineer").seniority).toBe("senior");
    expect(deriveRoleBasics("Staff Engineer").seniority).toBe("staff/principal");
    expect(deriveRoleBasics("Junior Developer").seniority).toBe("junior");
  });

  it("defaults to 'unspecified' when no seniority keyword is present", () => {
    expect(deriveRoleBasics("Backend Engineer").seniority).toBe("unspecified");
  });
});
