use std::path::PathBuf;

use serde::Serialize;
use tauri::State;

use crate::backup;
use crate::cloud::dropbox::DropboxProvider;
use crate::cloud::{self, BackupStorageProvider, RemoteBackupHandle};
use crate::db::repositories::backup_settings;
use crate::db::repositories::dropbox_settings::{self, DropboxSettings, DropboxSettingsInput};
use crate::error::{AppError, AppResult};
use crate::{DbPathState, DbState};

const DROPBOX_REFRESH_TOKEN_ACCOUNT: &str = "dropbox-refresh-token";

#[derive(Debug, Serialize)]
pub struct DropboxStatus {
    pub settings: DropboxSettings,
    pub is_connected: bool,
}

fn status(conn: &rusqlite::Connection) -> AppResult<DropboxStatus> {
    let settings = dropbox_settings::get_or_create_default(conn)?;
    let is_connected = cloud::load_secret(DROPBOX_REFRESH_TOKEN_ACCOUNT)?.is_some();
    Ok(DropboxStatus {
        settings,
        is_connected,
    })
}

fn build_provider(conn: &rusqlite::Connection) -> AppResult<DropboxProvider> {
    let settings = dropbox_settings::get_or_create_default(conn)?;
    let app_key = settings
        .app_key
        .ok_or_else(|| AppError::new("Set your Dropbox App Key in Settings before connecting."))?;
    let refresh_token = cloud::load_secret(DROPBOX_REFRESH_TOKEN_ACCOUNT)?
        .ok_or_else(|| AppError::new("Not connected — connect your Dropbox account first."))?;
    Ok(DropboxProvider::new(app_key, refresh_token))
}

#[tauri::command]
pub fn get_dropbox_settings(db: State<DbState>) -> AppResult<DropboxStatus> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    status(&conn)
}

#[tauri::command]
pub fn update_dropbox_settings(
    db: State<DbState>,
    input: DropboxSettingsInput,
) -> AppResult<DropboxStatus> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    dropbox_settings::update(&conn, input)?;
    status(&conn)
}

#[tauri::command]
pub async fn dropbox_connect(
    app: tauri::AppHandle,
    db: State<'_, DbState>,
) -> AppResult<DropboxStatus> {
    let app_key = {
        let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
        dropbox_settings::get_or_create_default(&conn)?
            .app_key
            .ok_or_else(|| {
                AppError::new("Set your Dropbox App Key in Settings before connecting.")
            })?
    };

    let account = cloud::dropbox::connect(&app, &app_key)
        .await
        .map_err(AppError::from)?;

    cloud::store_secret(DROPBOX_REFRESH_TOKEN_ACCOUNT, &account.refresh_token)?;

    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    dropbox_settings::set_account_label(&conn, account.account_email.as_deref())?;
    status(&conn)
}

#[tauri::command]
pub fn dropbox_disconnect(db: State<DbState>) -> AppResult<DropboxStatus> {
    cloud::delete_secret(DROPBOX_REFRESH_TOKEN_ACCOUNT)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    dropbox_settings::set_account_label(&conn, None)?;
    status(&conn)
}

#[tauri::command]
pub async fn dropbox_test_connection(db: State<'_, DbState>) -> AppResult<()> {
    let provider = {
        let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
        build_provider(&conn)?
    };
    provider.test_connection().await.map_err(AppError::from)
}

#[tauri::command]
pub async fn dropbox_upload_backup(
    db: State<'_, DbState>,
    local_path: String,
) -> AppResult<RemoteBackupHandle> {
    let provider = {
        let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
        build_provider(&conn)?
    };
    let path = PathBuf::from(&local_path);
    let remote_name = path
        .file_name()
        .ok_or_else(|| AppError::new("Invalid backup file path."))?
        .to_string_lossy()
        .to_string();
    provider
        .upload(&path, &remote_name)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn dropbox_list_backups(db: State<'_, DbState>) -> AppResult<Vec<RemoteBackupHandle>> {
    let provider = {
        let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
        build_provider(&conn)?
    };
    provider.list().await.map_err(AppError::from)
}

#[tauri::command]
pub async fn dropbox_delete_backup(db: State<'_, DbState>, remote_id: String) -> AppResult<()> {
    let provider = {
        let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
        build_provider(&conn)?
    };
    let handle = RemoteBackupHandle {
        id: remote_id,
        name: String::new(),
        size_bytes: 0,
        modified_at: String::new(),
    };
    provider.delete(&handle).await.map_err(AppError::from)
}

/// Downloads a Dropbox backup to a temp file, then hands it to the exact same
/// [`backup::restore_backup`] used for local restores — full validation, automatic pre-restore
/// safety backup, and atomic swap, with zero duplicated restore logic between "local" and "cloud."
#[tauri::command]
pub async fn dropbox_restore_backup(
    db: State<'_, DbState>,
    db_path: State<'_, DbPathState>,
    remote_id: String,
    remote_name: String,
) -> AppResult<()> {
    let provider = {
        let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
        build_provider(&conn)?
    };

    let temp_dir = std::env::temp_dir().join(format!(
        "pastry-mgmt-dropbox-restore-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir).map_err(|e| AppError::new(e.to_string()))?;
    let local_path = temp_dir.join(&remote_name);

    let handle = RemoteBackupHandle {
        id: remote_id,
        name: remote_name,
        size_bytes: 0,
        modified_at: String::new(),
    };
    provider
        .download(&handle, &local_path)
        .await
        .map_err(AppError::from)?;

    let mut conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    let settings = backup_settings::get_or_create_default(
        &conn,
        &db_path
            .0
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("backups"),
    )?;
    let result = backup::restore_backup(
        &local_path,
        &db_path.0,
        &PathBuf::from(&settings.local_path),
        &mut conn,
    );

    let _ = std::fs::remove_dir_all(&temp_dir);

    result.map_err(AppError::from)
}
