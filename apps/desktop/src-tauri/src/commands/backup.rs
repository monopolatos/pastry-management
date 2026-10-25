use std::path::{Path, PathBuf};

use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::auth::{self, SessionState};
use crate::backup::{self, BackupInfo};
use crate::db::repositories::backup_settings::{self, BackupSettings, BackupSettingsInput};
use crate::error::{AppError, AppResult};
use crate::{DbPathState, DbState};

fn default_backups_dir(db_path: &Path) -> PathBuf {
    db_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("backups")
}

#[tauri::command]
pub fn get_backup_settings(
    db: State<DbState>,
    db_path: State<DbPathState>,
    session: State<SessionState>,
) -> AppResult<BackupSettings> {
    auth::require_backup_access(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    backup_settings::get_or_create_default(&conn, &default_backups_dir(&db_path.0))
}

#[tauri::command]
pub fn update_backup_settings(
    db: State<DbState>,
    db_path: State<DbPathState>,
    session: State<SessionState>,
    input: BackupSettingsInput,
) -> AppResult<BackupSettings> {
    auth::require_backup_access(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    backup_settings::update(&conn, &default_backups_dir(&db_path.0), input)
}

#[tauri::command]
pub async fn choose_backup_directory(
    app: tauri::AppHandle,
    session: State<'_, SessionState>,
) -> AppResult<Option<String>> {
    auth::require_backup_access(&session)?;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    let folder = rx
        .recv()
        .map_err(|e| AppError::new(format!("Folder picker did not respond: {e}")))?;
    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
pub fn create_backup(
    db: State<DbState>,
    db_path: State<DbPathState>,
    session: State<SessionState>,
    label: Option<String>,
) -> AppResult<BackupInfo> {
    auth::require_backup_access(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    let settings = backup_settings::get_or_create_default(&conn, &default_backups_dir(&db_path.0))?;
    let dest_dir = PathBuf::from(&settings.local_path);

    let info = backup::create_backup(&conn, &db_path.0, &dest_dir, label.as_deref())?;

    // Only ordinary (unlabeled) backups count against retention — a safety backup taken moments
    // before a restore shouldn't be the thing that gets pruned away by the very operation that
    // created it.
    if label.is_none() {
        let _ = backup::enforce_retention(&dest_dir, settings.retention_count);
    }

    Ok(info)
}

#[tauri::command]
pub fn list_backups(
    db: State<DbState>,
    db_path: State<DbPathState>,
    session: State<SessionState>,
) -> AppResult<Vec<BackupInfo>> {
    auth::require_backup_access(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    let settings = backup_settings::get_or_create_default(&conn, &default_backups_dir(&db_path.0))?;
    Ok(backup::list_backups(&PathBuf::from(&settings.local_path))?)
}

#[derive(Debug, serde::Serialize)]
pub struct ValidatedBackupDto {
    pub app_version: String,
    pub schema_version: i64,
    pub created_at: String,
}

/// Lets the user pick any `.zip` backup file from disk to import — not just one already sitting in
/// the managed local backups folder (e.g. one copied in from a USB drive, another machine, or an
/// email attachment). The picked path still has to pass `validate_backup_file`/`restore_backup`'s
/// own checks before anything is touched.
#[tauri::command]
pub async fn choose_backup_file(
    app: tauri::AppHandle,
    session: State<'_, SessionState>,
) -> AppResult<Option<String>> {
    auth::require_backup_access(&session)?;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("Backup archive", &["zip"])
        .pick_file(move |file| {
            let _ = tx.send(file);
        });
    let picked = rx
        .recv()
        .map_err(|e| AppError::new(format!("File picker did not respond: {e}")))?;
    Ok(picked.map(|p| p.to_string()))
}

#[tauri::command]
pub fn validate_backup_file(
    session: State<SessionState>,
    path: String,
) -> AppResult<ValidatedBackupDto> {
    auth::require_backup_access(&session)?;
    let validated = backup::validate_backup_file(&PathBuf::from(path))?;
    Ok(ValidatedBackupDto {
        app_version: validated.app_version,
        schema_version: validated.schema_version,
        created_at: validated.created_at,
    })
}

#[tauri::command]
pub fn restore_backup(
    db: State<DbState>,
    db_path: State<DbPathState>,
    session: State<SessionState>,
    path: String,
) -> AppResult<()> {
    auth::require_backup_access(&session)?;
    let mut conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    let settings = backup_settings::get_or_create_default(&conn, &default_backups_dir(&db_path.0))?;
    backup::restore_backup(
        &PathBuf::from(path),
        &db_path.0,
        &PathBuf::from(&settings.local_path),
        &mut conn,
    )?;
    Ok(())
}

#[tauri::command]
pub fn delete_backup(session: State<SessionState>, path: String) -> AppResult<()> {
    auth::require_backup_access(&session)?;
    std::fs::remove_file(&path)
        .map_err(|e| AppError::new(format!("Could not delete backup file: {e}")))
}
