// Public entry point for @pastry-management/core.
// Domain logic (units, pricing strategy, costing engine) — Phase 4.

export const CORE_PACKAGE_VERSION = "0.1.0";

// --- Recipe costing engine (Phase 4) --------------------------------------

export { calculateRecipeCost } from "./costing/engine.js";

export type {
  CalculateCostOptions,
  CostBreakdown,
  CostingIngredient,
  CostingPurchaseRecord,
  CostingRawMaterial,
  CostingRecipeNode,
  CostingUnit,
  CostLine,
  IngredientType,
  PricingStrategy,
  PricingStrategyUsedEntry,
  RecipeCostingGraph,
  UnitKind,
} from "./costing/types.js";

export {
  ArchivedReferenceError,
  CircularDependencyError,
  ExcessiveNestingError,
  IncompatibleUnitError,
  InvalidYieldError,
  MissingIngredientCostError,
  UnknownUnitError,
} from "./costing/errors.js";
export type { CostingErrorCode } from "./costing/errors.js";

// --- Unit conversion (used internally by the costing engine; exported for
//     standalone use/testing by other packages, e.g. UI unit pickers) -------

export { buildUnitsByCode, convertQuantity } from "./units/convert.js";

// --- Pricing strategy resolution (used internally by the costing engine) --

export { resolveRawMaterialPrice } from "./pricing/resolve.js";
export type { ResolvedRawMaterialPrice } from "./pricing/resolve.js";
