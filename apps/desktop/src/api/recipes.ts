import { invoke } from "@tauri-apps/api/core";
import type { RecipeCostingGraph } from "@pastry-management/core";
import type { CostSnapshotSummary, RecipeDetail, RecipeInput, RecipeSummary } from "./types";

/**
 * Typed wrappers around the `commands::recipes` Tauri commands. This is the only module that
 * should call `invoke()` for recipes — components call these functions instead.
 *
 * Note: Tauri camelCases top-level command argument names for the JS side (e.g. Rust's
 * `include_archived` becomes `includeArchived` here), but does NOT rename fields inside a struct
 * argument like `RecipeInput` — those keep their exact snake_case Rust field names since that
 * struct has no `#[serde(rename_all = ...)]`.
 */

export function listRecipes(includeArchived: boolean): Promise<RecipeSummary[]> {
  return invoke("list_recipes", { includeArchived });
}

export function getRecipe(id: number): Promise<RecipeDetail> {
  return invoke("get_recipe", { id });
}

export function createRecipe(input: RecipeInput): Promise<RecipeDetail> {
  return invoke("create_recipe", { input });
}

export function updateRecipe(id: number, input: RecipeInput): Promise<RecipeDetail> {
  return invoke("update_recipe", { id, input });
}

export function archiveRecipe(id: number): Promise<void> {
  return invoke("archive_recipe", { id });
}

export function reactivateRecipe(id: number): Promise<void> {
  return invoke("reactivate_recipe", { id });
}

export function deleteRecipe(id: number): Promise<void> {
  return invoke("delete_recipe", { id });
}

/** Pass `newName: null` to get the backend's default "{name} (Copy)" behavior. */
export function duplicateRecipe(id: number, newName: string | null): Promise<RecipeDetail> {
  return invoke("duplicate_recipe", { id, newName });
}

export function getRecipeCostingGraph(id: number): Promise<RecipeCostingGraph> {
  return invoke("get_recipe_costing_graph", { id });
}

/**
 * Records an audit-trail snapshot of a cost calculation the user explicitly chose to save. Pass
 * `JSON.stringify(breakdown.pricingStrategyUsed)` and `JSON.stringify(breakdown)` for the last two
 * string arguments; the two money arguments must be whole integers (the costing engine's output is
 * already rounded to whole micros).
 */
export function saveRecipeCostSnapshot(
  recipeId: number,
  pricingStrategySummary: string,
  totalCostMicros: number,
  costPerYieldUnitMicros: number,
  breakdownJson: string,
): Promise<number> {
  return invoke("save_recipe_cost_snapshot", {
    recipeId,
    pricingStrategySummary,
    totalCostMicros,
    costPerYieldUnitMicros,
    breakdownJson,
  });
}

export function listRecipeCostSnapshots(recipeId: number): Promise<CostSnapshotSummary[]> {
  return invoke("list_recipe_cost_snapshots", { recipeId });
}
