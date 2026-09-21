/**
 * checks if two hosts belong to the same company by comparing the last two
 * parts of the hostname, so "www.acme.com" and "acme.com" both become
 * "acme.com". this is a simple guess, not a full lookup table, so it gets
 * things like "acme.co.uk" wrong. good enough for this project's scope.
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
