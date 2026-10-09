import { invoke } from "@tauri-apps/api/core";
import type { Category, CategoryInput } from "./types";

/**
 * Typed wrappers around the `commands::expense_categories` Tauri commands. Reuses the
 * `Category`/`CategoryInput` types from `./categories` — the Rust `ExpenseCategory` struct is
 * structurally identical, just backed by its own table (see migration 0011) so expense categories
 * have an independent name space from raw material/recipe/income categories.
 */

export function listExpenseCategories(includeInactive: boolean): Promise<Category[]> {
  return invoke("list_expense_categories", { includeInactive });
}

export function createExpenseCategory(input: CategoryInput): Promise<Category> {
  return invoke("create_expense_category", { input });
}

export function updateExpenseCategory(id: number, input: CategoryInput): Promise<Category> {
  return invoke("update_expense_category", { id, input });
}

export function archiveExpenseCategory(id: number): Promise<void> {
  return invoke("archive_expense_category", { id });
}

export function reactivateExpenseCategory(id: number): Promise<void> {
  return invoke("reactivate_expense_category", { id });
}

export function deleteExpenseCategory(id: number): Promise<void> {
  return invoke("delete_expense_category", { id });
}
