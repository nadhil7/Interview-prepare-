/** finds the next number to use for ids like q3 or f3, so new items from a regeneration never collide with the existing ones. */
export function nextIndexFor(ids: string[], prefix: string): number {
  const numbers = ids
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length)))
    .filter((n) => Number.isInteger(n));
  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}
