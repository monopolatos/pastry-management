import { invoke } from "@tauri-apps/api/core";
import type { IncomeEntry, IncomeEntryInput } from "./types";

/** Typed wrappers around the `commands::income_entries` Tauri commands — mirrors
 * `./expenses.ts` exactly, see that module's doc comment. */

export function listIncomeEntries(): Promise<IncomeEntry[]> {
  return invoke("list_income_entries");
}

export function createIncomeEntry(input: IncomeEntryInput): Promise<IncomeEntry> {
  return invoke("create_income_entry", { input });
}

export function updateIncomeEntry(id: number, input: IncomeEntryInput): Promise<IncomeEntry> {
  return invoke("update_income_entry", { id, input });
}

export function deleteIncomeEntry(id: number): Promise<void> {
  return invoke("delete_income_entry", { id });
}
