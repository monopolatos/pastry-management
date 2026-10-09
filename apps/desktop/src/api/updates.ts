import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type {
  UpdateCheckResult,
  UpdateProgress,
  UpdateSettings,
  UpdateSettingsInput,
} from "./types";

/**
 * Typed wrappers around the `commands::updates` Tauri commands. This is the only module that
 * should call `invoke()` for update checking/downloading/installing — components call these
 * functions instead.
 *
 * Note: Tauri camelCases top-level command argument names for the JS side, but does NOT rename
 * fields inside a struct argument like `UpdateSettingsInput` — those keep their exact snake_case
 * Rust field names since that struct has no `#[serde(rename_all = ...)]`.
 *
 * These wrap `tauri-plugin-updater`'s Rust API directly (not its own JS bridge package) — see the
 * doc comment on `commands::updates` for why. `check` -> `download` -> `install` -> `restart` are
 * four separate steps; `restart` is never called automatically anywhere in this app, only from an
 * explicit user click, so an update is never applied out from under unsaved work.
 */

/** Reads the current app version directly — no network request, unlike `checkForUpdate`. */
export function getCurrentAppVersion(): Promise<string> {
  return invoke("get_current_app_version");
}

export function getUpdateSettings(): Promise<UpdateSettings> {
  return invoke("get_update_settings");
}

export function updateUpdateSettings(input: UpdateSettingsInput): Promise<UpdateSettings> {
  return invoke("update_update_settings", { input });
}

export function checkForUpdate(): Promise<UpdateCheckResult> {
  return invoke("check_for_update");
}

export function downloadUpdate(): Promise<void> {
  return invoke("download_update");
}

export function installUpdate(): Promise<void> {
  return invoke("install_update");
}

export function restartApp(): Promise<void> {
  return invoke("restart_app");
}

/** Current update progress — cheap, synchronous on the Rust side, no network request. Call once
 * on mount to catch up on a stage change that may have already happened (e.g. the silent
 * launch-time check), then use `onUpdateProgress` for anything that changes afterward. */
export function getUpdateProgress(): Promise<UpdateProgress> {
  return invoke("get_update_progress");
}

/** Subscribes to live update-progress changes (the silent launch-time check finding/downloading/
 * installing an update while this window is already open). Returns the unlisten function — call
 * it on unmount. */
export function onUpdateProgress(handler: (progress: UpdateProgress) => void): Promise<UnlistenFn> {
  return listen<UpdateProgress>("update-progress", (event) => handler(event.payload));
}
