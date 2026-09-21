import { invoke } from "@tauri-apps/api/core";
import type { DropboxSettingsInput, DropboxStatus, RemoteBackupHandle } from "./types";

/**
 * Typed wrappers around the `commands::cloud_backup` Tauri commands (Dropbox). This is the only
 * module that should call `invoke()` for cloud backup/restore — components call these functions
 * instead.
 *
 * Note: Tauri camelCases top-level command argument names for the JS side (e.g. Rust's
 * `local_path` parameter becomes `{ localPath }` below), but does NOT rename fields inside a
 * struct argument like `DropboxSettingsInput` — those keep their exact snake_case Rust field
 * names since that struct has no `#[serde(rename_all = ...)]`. Same convention as `./backup.ts`.
 */

export function getDropboxSettings(): Promise<DropboxStatus> {
  return invoke("get_dropbox_settings");
}

export function updateDropboxSettings(input: DropboxSettingsInput): Promise<DropboxStatus> {
  return invoke("update_dropbox_settings", { input });
}

/**
 * Opens the system browser and waits (up to ~2 minutes server-side) for the user to approve
 * access there before resolving. Rejects with a clear error if no App Key is set yet, or if the
 * user doesn't complete the browser step (timeout, closed tab, or declined access).
 */
export function dropboxConnect(): Promise<DropboxStatus> {
  return invoke("dropbox_connect");
}

export function dropboxDisconnect(): Promise<DropboxStatus> {
  return invoke("dropbox_disconnect");
}

/** Throws if not connected or the stored token is invalid; resolves silently otherwise. */
export function dropboxTestConnection(): Promise<void> {
  return invoke("dropbox_test_connection");
}

/** Uploads an existing local backup file (by its local path) to Dropbox. */
export function dropboxUploadBackup(localPath: string): Promise<RemoteBackupHandle> {
  return invoke("dropbox_upload_backup", { localPath });
}

export function dropboxListBackups(): Promise<RemoteBackupHandle[]> {
  return invoke("dropbox_list_backups");
}

export function dropboxDeleteBackup(remoteId: string): Promise<void> {
  return invoke("dropbox_delete_backup", { remoteId });
}

/**
 * Downloads the archive from Dropbox and restores it via the exact same safety sequence local
 * restore uses (automatic pre-restore safety backup, validation, atomic swap).
 */
export function dropboxRestoreBackup(remoteId: string, remoteName: string): Promise<void> {
  return invoke("dropbox_restore_backup", { remoteId, remoteName });
}
