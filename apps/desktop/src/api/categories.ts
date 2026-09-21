import { invoke } from "@tauri-apps/api/core";
import type { Category, CategoryInput } from "./types";

/**
 * Typed wrappers around the `commands::categories` Tauri commands. This is the only module that
 * should call `invoke()` for categories — components call these functions instead.
 */

export function listCategories(includeInactive: boolean): Promise<Category[]> {
  return invoke("list_categories", { includeInactive });
}

export function createCategory(input: CategoryInput): Promise<Category> {
  return invoke("create_category", { input });
}

export function updateCategory(id: number, input: CategoryInput): Promise<Category> {
  return invoke("update_category", { id, input });
}

export function archiveCategory(id: number): Promise<void> {
  return invoke("archive_category", { id });
}

export function reactivateCategory(id: number): Promise<void> {
  return invoke("reactivate_category", { id });
}

export function deleteCategory(id: number): Promise<void> {
  return invoke("delete_category", { id });
}
