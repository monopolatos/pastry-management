/**
 * Shared comparator for the Raw Materials and Recipes list screens' sort controls. `null` always
 * sorts last regardless of direction (e.g. a material with no resolvable price, or a recipe with
 * no category) — pushing "unknown" values to the end reads better than letting them land
 * unpredictably in the middle of an alphabetical/numeric order.
 */
export function compareNullable(
  a: string | number | null,
  b: string | number | null,
  direction: "asc" | "desc",
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  const cmp =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), undefined, { sensitivity: "base" });

  return direction === "asc" ? cmp : -cmp;
}
