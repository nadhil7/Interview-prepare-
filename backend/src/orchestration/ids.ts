/** Next sequential numeric suffix for ids like "q3"/"f3", so freshly generated items during a regeneration never collide with existing ones. */
export function nextIndexFor(ids: string[], prefix: string): number {
  const numbers = ids
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length)))
    .filter((n) => Number.isInteger(n));
  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}
