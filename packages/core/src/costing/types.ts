// Data contract for the recipe costing engine.
//
// Field names on the "Costing*" input types are snake_case ON PURPOSE: they mirror,
// field-for-field, the JSON serialized by the Rust `get_recipe_costing_graph` Tauri
// command (see apps/desktop/src-tauri/src/db/repositories/recipes.rs). Do not rename
// them to camelCase — that would require a translation layer at the Tauri boundary
// that the architecture explicitly avoids.
//
// Output types (CostBreakdown, CostLine, ...) use camelCase because they are this
// package's own public API, not a mirror of a wire format.

export type IngredientType = "raw_material" | "recipe";
export type PricingStrategy = "latest" | "average_n" | "manual";
export type UnitKind = "weight" | "volume" | "count";

export interface CostingIngredient {
  ingredient_type: IngredientType;
  raw_material_id: number | null; // set iff ingredient_type === "raw_material"
  sub_recipe_id: number | null; // set iff ingredient_type === "recipe"
  quantity: number;
  unit_code: string; // e.g. "g", "kg", "ml", "l", "piece" — NOT necessarily the material's base unit
}

export interface CostingRecipeNode {
  id: number;
  name: string;
  status: "active" | "archived";
  yield_quantity: number;
  yield_unit_code: string;
  ingredients: CostingIngredient[];
}

export interface CostingPurchaseRecord {
  purchase_date: string; // ISO date "YYYY-MM-DD"
  cost_per_base_unit_micros: number; // integer
  supplier_name: string | null; // null if that purchase had no recorded supplier
}

export interface CostingRawMaterial {
  id: number;
  name: string;
  base_unit_code: string;
  pricing_strategy: PricingStrategy;
  pricing_strategy_config: string | null; // JSON string, e.g. '{"n":5}' or '{"manual_price_micros":2500}'. null for "latest".
  purchase_history: CostingPurchaseRecord[]; // sorted most-recent-first by the backend, but sort defensively anyway
}

export interface CostingUnit {
  code: string;
  kind: UnitKind;
  to_base_factor: number; // multiply a quantity of this unit by this to get the quantity in its kind's base unit
}

export interface RecipeCostingGraph {
  target_recipe_id: number;
  recipes: CostingRecipeNode[]; // target recipe + every transitively-reachable sub-recipe, each exactly once
  raw_materials: CostingRawMaterial[]; // every raw material referenced anywhere in the graph, each exactly once
  units: CostingUnit[]; // all known measurement units
}

export interface CalculateCostOptions {
  asOfDate?: string; // ISO date "YYYY-MM-DD". Omit = latest overall.
  maxDepth?: number; // default 10
}

export interface CostLine {
  ingredientType: IngredientType;
  ingredientId: number; // raw_material_id or sub_recipe_id
  name: string;
  quantity: number; // exactly as entered on the recipe, in `unit`
  unit: string; // the unit_code as entered on the recipe (NOT necessarily the base unit)
  unitCostMicros: number; // cost per ONE unit of `unit` — rounded to the nearest whole integer micro
  lineCostMicros: number; // quantity * unitCostMicros conceptually — rounded to the nearest whole integer micro
  percentOfTotal: number; // 0-100, this line's share of the CostBreakdown it belongs to. Full precision, no forced rounding.
  subBreakdown?: CostBreakdown; // present iff ingredientType === "recipe"
}

export interface PricingStrategyUsedEntry {
  rawMaterialId: number;
  rawMaterialName: string;
  strategy: PricingStrategy;
  costPerBaseUnitMicros: number; // rounded to nearest whole integer micro
  sourceDescription: string; // human-readable, e.g. "latest purchase, 2026-09-10, Acme Supplies"
}

export interface CostBreakdown {
  recipeId: number;
  recipeName: string;
  calculatedAt: string; // new Date().toISOString()
  totalCostMicros: number; // rounded to nearest whole integer micro
  yieldQuantity: number;
  yieldUnit: string;
  costPerYieldUnitMicros: number; // rounded to nearest whole integer micro
  lines: CostLine[]; // one per ingredient of the recipe's current version, in the same order they were given
  pricingStrategyUsed: PricingStrategyUsedEntry[]; // one entry per distinct raw material resolved while computing this node's own subtree
}
