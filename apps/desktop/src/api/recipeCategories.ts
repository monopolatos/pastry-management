import { invoke } from "@tauri-apps/api/core";
import type { Category, CategoryInput } from "./types";

/**
 * Typed wrappers around the `commands::recipe_categories` Tauri commands. This is the only module
 * that should call `invoke()` for recipe categories — components call these functions instead.
 *
 * Reuses the `Category`/`CategoryInput` types from `./categories` — the Rust `RecipeCategory`
 * struct is structurally identical ({id, name, is_active, created_at, updated_at}), just backed
 * by a separate table (see migration 0010) so raw material and recipe categories have independent
 * name spaces.
 */

export function listRecipeCategories(includeInactive: boolean): Promise<Category[]> {
  return invoke("list_recipe_categories", { includeInactive });
}

export function createRecipeCategory(input: CategoryInput): Promise<Category> {
  return invoke("create_recipe_category", { input });
}

export function updateRecipeCategory(id: number, input: CategoryInput): Promise<Category> {
  return invoke("update_recipe_category", { id, input });
}

export function archiveRecipeCategory(id: number): Promise<void> {
  return invoke("archive_recipe_category", { id });
}

export function reactivateRecipeCategory(id: number): Promise<void> {
  return invoke("reactivate_recipe_category", { id });
}

export function deleteRecipeCategory(id: number): Promise<void> {
  return invoke("delete_recipe_category", { id });
}
