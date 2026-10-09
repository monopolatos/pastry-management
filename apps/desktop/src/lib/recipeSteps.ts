/**
 * Recipe instructions are stored as a single `instructions TEXT` column (see migration
 * 0003_recipes.sql) — no schema change for this — but authored/displayed as a numbered list of
 * steps rather than one free-text blob, since "how do I make this" is naturally a sequence of
 * steps, not a paragraph. The column holds a JSON array of step strings, e.g.
 * `["Preheat oven to 180°C", "Cream butter and sugar", ...]`.
 *
 * Older recipes saved before this existed have plain free text in that column, not JSON — parsing
 * falls back to treating the whole thing as a single step, so nothing is lost; the user can split
 * it into real steps next time they edit.
 */

export function parseInstructionSteps(raw: string | null): string[] {
  if (!raw || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed;
    }
  } catch {
    // Not JSON — a legacy free-text value, handled by the fallback below.
  }
  return [raw];
}

/** Drops empty/whitespace-only steps and returns `null` (not `[]`/`"[]"`) when nothing is left, so
 * an all-empty instructions list round-trips to the same "no instructions" state a blank textarea
 * used to. */
export function serializeInstructionSteps(steps: string[]): string | null {
  const trimmed = steps.map((s) => s.trim()).filter((s) => s !== "");
  if (trimmed.length === 0) return null;
  return JSON.stringify(trimmed);
}
