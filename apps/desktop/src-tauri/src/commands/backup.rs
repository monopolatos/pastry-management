use std::path::{Path, PathBuf};

use tauri::State;
use tauri_plugin_dialog::DialogExt;

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
) -> AppResult<BackupSettings> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    backup_settings::get_or_create_default(&conn, &default_backups_dir(&db_path.0))
}

#[tauri::command]
pub fn update_backup_settings(
    db: State<DbState>,
    db_path: State<DbPathState>,
    input: BackupSettingsInput,
) -> AppResult<BackupSettings> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    backup_settings::update(&conn, &default_backups_dir(&db_path.0), input)
}

#[tauri::command]
pub async fn choose_backup_directory(app: tauri::AppHandle) -> AppResult<Option<String>> {
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
    label: Option<String>,
) -> AppResult<BackupInfo> {
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
pub fn list_backups(db: State<DbState>, db_path: State<DbPathState>) -> AppResult<Vec<BackupInfo>> {
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

#[tauri::command]
pub fn validate_backup_file(path: String) -> AppResult<ValidatedBackupDto> {
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
    path: String,
) -> AppResult<()> {
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
pub fn delete_backup(path: String) -> AppResult<()> {
    std::fs::remove_file(&path)
        .map_err(|e| AppError::new(format!("Could not delete backup file: {e}")))
}
