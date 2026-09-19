// Typed errors thrown by the recipe costing engine. Each has a distinguishing
// `code` string property so callers (e.g. the Tauri command layer / UI) can
// branch on error kind without parsing message text.

export type CostingErrorCode =
  | "CIRCULAR_DEPENDENCY"
  | "MISSING_INGREDIENT_COST"
  | "ARCHIVED_REFERENCE"
  | "EXCESSIVE_NESTING"
  | "INVALID_YIELD"
  | "INCOMPATIBLE_UNIT"
  | "UNKNOWN_UNIT";

/** A recipe reappeared in its own ancestry while walking sub-recipes. */
export class CircularDependencyError extends Error {
  readonly code: CostingErrorCode = "CIRCULAR_DEPENDENCY";

  constructor(cyclePath: string) {
    super(`Circular dependency detected in recipe graph: ${cyclePath}`);
    this.name = "CircularDependencyError";
  }
}

/**
 * A raw material has no purchase from which a price can be resolved — either
 * its purchase_history is empty, or (with asOfDate set) no purchase exists
 * on or before that date, or a "manual" strategy has no usable config.
 */
export class MissingIngredientCostError extends Error {
  readonly code: CostingErrorCode = "MISSING_INGREDIENT_COST";

  constructor(materialName: string, detail?: string) {
    super(
      `No purchase price could be resolved for raw material "${materialName}"${
        detail ? ` (${detail})` : ""
      }.`,
    );
    this.name = "MissingIngredientCostError";
  }
}

/**
 * A sub-recipe ingredient points at a recipe node whose status is "archived",
 * or (by deliberate reuse, see costing engine README notes) at a sub-recipe
 * id / target recipe id that does not exist in the costing graph at all —
 * both are "this reference cannot be used as a live ingredient" failures.
 */
export class ArchivedReferenceError extends Error {
  readonly code: CostingErrorCode = "ARCHIVED_REFERENCE";

  constructor(message: string) {
    super(message);
    this.name = "ArchivedReferenceError";
  }
}

/** Nesting depth exceeded the configured (or default) maxDepth. */
export class ExcessiveNestingError extends Error {
  readonly code: CostingErrorCode = "EXCESSIVE_NESTING";

  constructor(maxDepth: number) {
    super(`Recipe nesting exceeds the maximum allowed depth of ${maxDepth}.`);
    this.name = "ExcessiveNestingError";
  }
}

/** A recipe's yield_quantity is <= 0. */
export class InvalidYieldError extends Error {
  readonly code: CostingErrorCode = "INVALID_YIELD";

  constructor(recipeName: string, yieldQuantity: number) {
    super(
      `Recipe "${recipeName}" has an invalid yield quantity of ${yieldQuantity}; yield must be greater than 0.`,
    );
    this.name = "InvalidYieldError";
  }
}

/** Converting between two units would require crossing UnitKind (weight <-> volume). */
export class IncompatibleUnitError extends Error {
  readonly code: CostingErrorCode = "INCOMPATIBLE_UNIT";

  constructor(fromUnitCode: string, toUnitCode: string, fromKind: string, toKind: string) {
    super(
      `Cannot convert unit "${fromUnitCode}" (${fromKind}) to unit "${toUnitCode}" (${toKind}): ` +
        "units of different kinds are never auto-converted.",
    );
    this.name = "IncompatibleUnitError";
  }
}

/** An ingredient or yield references a unit_code absent from graph.units. */
export class UnknownUnitError extends Error {
  readonly code: CostingErrorCode = "UNKNOWN_UNIT";

  constructor(unitCode: string) {
    super(`Unknown unit code "${unitCode}": not present in the costing graph's unit list.`);
    this.name = "UnknownUnitError";
  }
}
