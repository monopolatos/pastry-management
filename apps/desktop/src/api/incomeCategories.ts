import { invoke } from "@tauri-apps/api/core";
import type { Category, CategoryInput } from "./types";

/**
 * Typed wrappers around the `commands::income_categories` Tauri commands. Reuses the
 * `Category`/`CategoryInput` types from `./categories` — see `./expenseCategories.ts` for why.
 */

export function listIncomeCategories(includeInactive: boolean): Promise<Category[]> {
  return invoke("list_income_categories", { includeInactive });
}

export function createIncomeCategory(input: CategoryInput): Promise<Category> {
  return invoke("create_income_category", { input });
}

export function updateIncomeCategory(id: number, input: CategoryInput): Promise<Category> {
  return invoke("update_income_category", { id, input });
}

export function archiveIncomeCategory(id: number): Promise<void> {
  return invoke("archive_income_category", { id });
}

export function reactivateIncomeCategory(id: number): Promise<void> {
  return invoke("reactivate_income_category", { id });
}

export function deleteIncomeCategory(id: number): Promise<void> {
  return invoke("delete_income_category", { id });
}
