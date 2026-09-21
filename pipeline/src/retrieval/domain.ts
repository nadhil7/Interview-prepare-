/**
 * Heuristic "same company" domain check: last two labels of the hostname
 * (e.g. "acme.com" from "www.acme.com"). Not a full public-suffix-list
 * implementation (misses cases like "acme.co.uk"), which is a known
 * limitation acceptable for this scope — documented here rather than
 * silently wrong.
 */
export function getRootDomain(hostname: string): string {
  const labels = hostname.toLowerCase().split(".");
  if (labels.length <= 2) return labels.join(".");
  return labels.slice(-2).join(".");
}

export function isSiblingOrSameDomain(rootDomain: string, candidateHostname: string): boolean {
  const candidateRoot = getRootDomain(candidateHostname);
  return candidateRoot === rootDomain;
}
