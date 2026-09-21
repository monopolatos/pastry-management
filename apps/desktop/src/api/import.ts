import { invoke } from "@tauri-apps/api/core";
import type { ImportSummary } from "./types";

/**
 * Typed wrappers around the `commands::import` Tauri commands. This is the only module that
 * should call `invoke()` for the Excel import feature — components call these functions instead.
 */

/** Opens a native file picker filtered to `.xlsx`. Resolves to `null` if the user cancels. */
export function chooseExcelFile(): Promise<string | null> {
  return invoke("choose_excel_file");
}

export function importFromExcel(path: string): Promise<ImportSummary> {
  return invoke("import_from_excel", { path });
}
