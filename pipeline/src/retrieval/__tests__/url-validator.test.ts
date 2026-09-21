import { describe, expect, it } from "vitest";
import { isPrivateOrLoopbackIPv4, isPrivateOrLoopbackIPv6, validateUrl } from "../url-validator.js";

/**
 * Every SSRF-relevant case below uses an IP literal (or the "localhost"
 * hostname) as the URL host. Node's dns.lookup() resolves an IP literal
 * immediately without a real network/DNS round trip, so these tests are
 * deterministic and safe to run offline / in CI.
 */
describe("validateUrl — SSRF protection", () => {
  it("allows any host when blockPrivateNetworks is false (dev/CLI-against-local-fixtures mode)", async () => {
    const result = await validateUrl("http://127.0.0.1:8099/acme/", { blockPrivateNetworks: false });
    expect(result.ok).toBe(true);
  });

  it("rejects the loopback hostname 'localhost' without needing DNS", async () => {
    const result = await validateUrl("http://localhost:3000/", { blockPrivateNetworks: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("loopback_hostname");
  });

  it("rejects an IPv4 loopback literal (127.0.0.1)", async () => {
    const result = await validateUrl("http://127.0.0.1/", { blockPrivateNetworks: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("private_or_loopback_address");
  });

  it("rejects an RFC1918 private IPv4 literal (10.x)", async () => {
    const result = await validateUrl("http://10.0.0.5/", { blockPrivateNetworks: true });
    expect(result.ok).toBe(false);
  });

  it("rejects the cloud metadata address (169.254.169.254)", async () => {
    const result = await validateUrl("http://169.254.169.254/latest/meta-data/", {
      blockPrivateNetworks: true,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an IPv6 loopback literal (::1)", async () => {
    const result = await validateUrl("http://[::1]/", { blockPrivateNetworks: true });
    expect(result.ok).toBe(false);
  });

  it("allows a public IP literal", async () => {
    const result = await validateUrl("http://8.8.8.8/", { blockPrivateNetworks: true });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-http(s) protocol", async () => {
    const result = await validateUrl("file:///etc/passwd", { blockPrivateNetworks: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unsupported_protocol");
  });

  it("rejects a malformed URL", async () => {
    const result = await validateUrl("not a url", { blockPrivateNetworks: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_url");
  });
});

describe("isPrivateOrLoopbackIPv4", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.1.2.3", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["192.168.1.1", true],
    ["169.254.169.254", true],
    ["100.64.0.1", true],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["93.184.216.34", false],
  ])("%s -> %s", (ip, expected) => {
    expect(isPrivateOrLoopbackIPv4(ip)).toBe(expected);
  });

  it("does not misclassify 172.15.x/172.32.x as the 172.16/12 private block", () => {
    expect(isPrivateOrLoopbackIPv4("172.15.255.255")).toBe(false);
    expect(isPrivateOrLoopbackIPv4("172.32.0.0")).toBe(false);
  });
});

describe("isPrivateOrLoopbackIPv6", () => {
  it.each([
    ["::1", true],
    ["fe80::1", true],
    ["fc00::1", true],
    ["fd12:3456:789a::1", true],
    ["::ffff:127.0.0.1", true],
    ["::ffff:10.0.0.1", true],
    ["2001:4860:4860::8888", false], // Google public DNS
  ])("%s -> %s", (ip, expected) => {
    expect(isPrivateOrLoopbackIPv6(ip)).toBe(expected);
  });
});
