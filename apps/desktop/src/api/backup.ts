import { invoke } from "@tauri-apps/api/core";
import type { BackupInfo, BackupSettings, BackupSettingsInput, ValidatedBackup } from "./types";

/**
 * Typed wrappers around the `commands::backup` Tauri commands. This is the only module that
 * should call `invoke()` for backup/restore — components call these functions instead.
 *
 * Note: Tauri camelCases top-level command argument names for the JS side, but does NOT rename
 * fields inside a struct argument like `BackupSettingsInput` — those keep their exact snake_case
 * Rust field names since that struct has no `#[serde(rename_all = ...)]`.
 */

export function getBackupSettings(): Promise<BackupSettings> {
  return invoke("get_backup_settings");
}

export function updateBackupSettings(input: BackupSettingsInput): Promise<BackupSettings> {
  return invoke("update_backup_settings", { input });
}

/** Opens a native folder picker. Resolves to `null` if the user cancels. */
export function chooseBackupDirectory(): Promise<string | null> {
  return invoke("choose_backup_directory");
}

/** Pass `null` for an ordinary user-initiated backup; `label` is for internal use only. */
export function createBackup(label: string | null): Promise<BackupInfo> {
  return invoke("create_backup", { label });
}

export function listBackups(): Promise<BackupInfo[]> {
  return invoke("list_backups");
}

export function validateBackupFile(path: string): Promise<ValidatedBackup> {
  return invoke("validate_backup_file", { path });
}

export function restoreBackup(path: string): Promise<void> {
  return invoke("restore_backup", { path });
}

export function deleteBackup(path: string): Promise<void> {
  return invoke("delete_backup", { path });
}
