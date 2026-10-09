import { invoke } from "@tauri-apps/api/core";
import type { Expense, ExpenseInput } from "./types";

/**
 * Typed wrappers around the `commands::expenses` Tauri commands. `list` returns every expense —
 * there's no backend filtering/pagination; the Finance screen filters/aggregates client-side the
 * same way the Raw Materials/Recipes lists and the Analytics screen already do.
 */

export function listExpenses(): Promise<Expense[]> {
  return invoke("list_expenses");
}

export function createExpense(input: ExpenseInput): Promise<Expense> {
  return invoke("create_expense", { input });
}

export function updateExpense(id: number, input: ExpenseInput): Promise<Expense> {
  return invoke("update_expense", { id, input });
}

export function deleteExpense(id: number): Promise<void> {
  return invoke("delete_expense", { id });
}
