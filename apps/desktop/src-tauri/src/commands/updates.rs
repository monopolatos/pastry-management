//! Automatic update checking/download/install, wrapping `tauri-plugin-updater`'s Rust API in
//! typed commands — same convention as `commands::cloud_backup` wrapping Dropbox and
//! `commands::backup::choose_backup_directory` wrapping `tauri-plugin-dialog`: the frontend never
//! talks to a plugin's own generic JS bridge directly, only to this crate's typed commands.
//!
//! Three independently toggleable settings (see docs/backup-and-updates.md §3) map onto three
//! real, separately-triggerable stages here rather than one bundled `download_and_install` call:
//! `check_for_update` -> `download_update` (fetches + signature-verifies the bytes) ->
//! `install_update` (writes them to disk) -> `restart_app` (relaunches into the new version).
//! `restart_app` is deliberately never called automatically by this module, regardless of the
//! auto-install setting — only an explicit user click restarts the app, which is what guarantees
//! "never forces a restart mid-edit" without needing separate unsaved-changes tracking.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::db::repositories::update_settings::{self, UpdateSettings, UpdateSettingsInput};
use crate::error::{AppError, AppResult};
use crate::DbState;

/// The update found by the most recent check, kept around so `download_update` can act on it
/// without re-checking. Replaced (or cleared to `None`) by every new check.
#[derive(Default)]
pub struct PendingUpdateState(pub Mutex<Option<Update>>);

/// The bytes downloaded (and signature-verified) for the pending update, kept around so
/// `install_update` can act on them without re-downloading. Cleared by every new check.
#[derive(Default)]
pub struct DownloadedUpdateState(pub Mutex<Option<Vec<u8>>>);

#[derive(Debug, Serialize)]
pub struct UpdateCheckResult {
    pub available: bool,
    pub current_version: Option<String>,
    pub version: Option<String>,
    pub notes: Option<String>,
}

/// Runs an actual check against the configured updater endpoint and stashes the result (if any)
/// in `pending` for a later `download_update` call. Shared by the manual `check_for_update`
/// command and the launch-time auto-check in lib.rs, so both go through the exact same logic.
pub async fn check_now(
    app: &AppHandle,
    pending: &PendingUpdateState,
    downloaded: &DownloadedUpdateState,
) -> AppResult<UpdateCheckResult> {
    let updater = app
        .updater()
        .map_err(|e| AppError::new(format!("Updater is not available: {e}")))?;

    let update = updater
        .check()
        .await
        .map_err(|e| AppError::new(format!("Update check failed: {e}")))?;

    // Populated from the app's own package info rather than only from `update.current_version`
    // (which tauri-plugin-updater only sets on the `Update` struct when a newer version was
    // actually found) so the UI can always show "you're on vX.Y.Z", not just when out of date.
    let current_version = app.package_info().version.to_string();

    let result = match &update {
        Some(u) => UpdateCheckResult {
            available: true,
            current_version: Some(current_version),
            version: Some(u.version.clone()),
            notes: u.body.clone(),
        },
        None => UpdateCheckResult {
            available: false,
            current_version: Some(current_version),
            version: None,
            notes: None,
        },
    };

    // A fresh check invalidates any previously downloaded bytes — they were for whatever update
    // (or lack thereof) the *last* check found, not necessarily this one.
    *downloaded
        .0
        .lock()
        .map_err(|e| AppError::new(e.to_string()))? = None;
    *pending.0.lock().map_err(|e| AppError::new(e.to_string()))? = update;

    Ok(result)
}

/// Cheap, network-free way to display "you're on vX.Y.Z" without triggering an actual update
/// check (and its network request) just to render a version number.
#[tauri::command]
pub fn get_current_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn get_update_settings(db: State<DbState>) -> AppResult<UpdateSettings> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    update_settings::get_or_create_default(&conn)
}

#[tauri::command]
pub fn update_update_settings(
    db: State<DbState>,
    input: UpdateSettingsInput,
) -> AppResult<UpdateSettings> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    update_settings::update(&conn, input)
}

#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    db: State<'_, DbState>,
    pending: State<'_, PendingUpdateState>,
    downloaded: State<'_, DownloadedUpdateState>,
) -> AppResult<UpdateCheckResult> {
    let result = check_now(&app, &pending, &downloaded).await?;

    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    let settings = update_settings::get_or_create_default(&conn)?;
    update_settings::mark_checked_now(&conn, settings.id)?;

    Ok(result)
}

#[tauri::command]
pub async fn download_update(
    pending: State<'_, PendingUpdateState>,
    downloaded: State<'_, DownloadedUpdateState>,
) -> AppResult<()> {
    let update = {
        let guard = pending.0.lock().map_err(|e| AppError::new(e.to_string()))?;
        guard.clone().ok_or_else(|| {
            AppError::new("No update available to download — check for updates first.")
        })?
    };

    let bytes = update
        .download(|_chunk_len, _total_len| {}, || {})
        .await
        .map_err(|e| AppError::new(format!("Download failed: {e}")))?;

    *downloaded
        .0
        .lock()
        .map_err(|e| AppError::new(e.to_string()))? = Some(bytes);

    Ok(())
}

#[tauri::command]
pub fn install_update(
    pending: State<'_, PendingUpdateState>,
    downloaded: State<'_, DownloadedUpdateState>,
) -> AppResult<()> {
    let update = {
        let guard = pending.0.lock().map_err(|e| AppError::new(e.to_string()))?;
        guard
            .clone()
            .ok_or_else(|| AppError::new("No update to install — check for updates first."))?
    };

    let bytes = {
        let guard = downloaded
            .0
            .lock()
            .map_err(|e| AppError::new(e.to_string()))?;
        guard
            .clone()
            .ok_or_else(|| AppError::new("Update has not been downloaded yet."))?
    };

    update
        .install(bytes)
        .map_err(|e| AppError::new(format!("Install failed: {e}")))
}

/// Relaunches the app into the newly installed version. Always an explicit user action (the
/// "Restart" button) — never called automatically by this module. On Windows, `install_update`
/// already exits the app after launching the platform installer, so this command's effect is
/// only observable on macOS/Linux; see `tauri_plugin_updater::Update::install`'s docs.
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.request_restart();
}
