import { promises as dns } from "node:dns";
import { isIPv4, isIPv6 } from "node:net";

/**
 * guards against requests to internal or private addresses.
 * blockPrivateNetworks is a plain boolean the caller decides, not something
 * this module reads from env itself, so it stays simple to test.
 * backend defaults it to true in production, the cli defaults it to false
 * so batch runs can target a local test site.
 */
export interface UrlValidatorOptions {
  blockPrivateNetworks: boolean;
}

export interface UrlValidationResult {
  ok: boolean;
  reason?: string;
  hostname?: string;
  resolvedAddresses?: string[];
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function inRange(intIp: number, base: string, prefixLength: number): boolean {
  const baseInt = ipv4ToInt(base);
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (intIp & mask) === (baseInt & mask);
}

const PRIVATE_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // shared address space for carrier networks
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link local, also covers the cloud metadata address 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // reserved for protocol assignments
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // reserved for benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

export function isPrivateOrLoopbackIPv4(ip: string): boolean {
  if (!isIPv4(ip)) return false;
  const intIp = ipv4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some(([base, prefix]) => inRange(intIp, base, prefix));
}

export function isPrivateOrLoopbackIPv6(ip: string): boolean {
  if (!isIPv6(ip)) return false;
  const normalized = ip.toLowerCase();

  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true; // link local range
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local range

  // an ipv4 address mapped into ipv6 form, so check the embedded address instead
  const mappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedMatch) return isPrivateOrLoopbackIPv4(mappedMatch[1]!);

  return false;
}

function isBlockedIp(ip: string): boolean {
  return isPrivateOrLoopbackIPv4(ip) || isPrivateOrLoopbackIPv6(ip);
}

export async function validateUrl(
  urlString: string,
  options: UrlValidatorOptions,
): Promise<UrlValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "unsupported_protocol" };
  }

  // the url's hostname keeps brackets for ipv6 addresses like "[::1]", so
  // strip them before checking the address
  const hostname = parsed.hostname.toLowerCase().replace(/^\[(.+)\]$/, "$1");

  if (!options.blockPrivateNetworks) {
    return { ok: true, hostname };
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { ok: false, reason: "loopback_hostname", hostname };
  }

  let addresses: string[];
  try {
    const records = await dns.lookup(hostname, { all: true });
    addresses = records.map((r) => r.address);
  } catch {
    return { ok: false, reason: "dns_resolution_failed", hostname };
  }

  const blocked = addresses.find(isBlockedIp);
  if (blocked) {
    return { ok: false, reason: "private_or_loopback_address", hostname, resolvedAddresses: addresses };
  }

  return { ok: true, hostname, resolvedAddresses: addresses };
}
