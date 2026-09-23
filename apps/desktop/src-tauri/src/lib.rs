mod auth;
mod backup;
mod cloud;
mod commands;
mod db;
mod error;
mod import;

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

use auth::SessionState;
use commands::updates::{DownloadedUpdateState, PendingUpdateState};

/// Shared, mutex-guarded connection handle. rusqlite::Connection is not Sync, and a single-user
/// desktop app has no need for a connection pool, so one guarded connection is the simplest
/// correct choice here.
pub struct DbState(pub Mutex<Connection>);

/// The live database file's path, managed separately from `DbState` so commands that need the
/// path (backup/restore) don't have to change `DbState`'s shape or touch its many existing call
/// sites throughout the codebase.
pub struct DbPathState(pub PathBuf);

#[tauri::command]
fn db_status(state: tauri::State<DbState>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let schema_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(format!("ok (schema version {schema_version})"))
}

/// Runs at most once per launch: if automatic backups are enabled and one is actually overdue per
/// the configured frequency, create it in the background so startup is never delayed by backup
/// I/O. There is no persistent timer while the app stays open — see
/// db::repositories::backup_settings::is_auto_backup_due for the rationale.
fn run_startup_auto_backup_check(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let db_state = app.state::<DbState>();
        let db_path_state = app.state::<DbPathState>();

        let conn = match db_state.0.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };

        let default_dir = db_path_state
            .0
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("backups");
        let Ok(settings) =
            db::repositories::backup_settings::get_or_create_default(&conn, &default_dir)
        else {
            return;
        };

        if !db::repositories::backup_settings::is_auto_backup_due(&settings) {
            return;
        }

        let dest_dir = PathBuf::from(&settings.local_path);
        if backup::create_backup(&conn, &db_path_state.0, &dest_dir, None).is_ok() {
            let _ = backup::enforce_retention(&dest_dir, settings.retention_count);
            let _ = db::repositories::backup_settings::mark_auto_backup_run(&conn, settings.id);
        }
    });
}

/// Runs at most once per launch, and at most every 24h thereafter (see
/// db::repositories::update_settings::is_check_due): if enabled, checks for an update and, per
/// the auto-download/auto-install settings, downloads and/or installs it in the background.
/// Never auto-restarts — restarting into the installed update is always an explicit user action
/// (see commands::updates::restart_app for why).
fn run_startup_update_check(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let settings = {
            let db_state = app.state::<DbState>();
            let conn = match db_state.0.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            match db::repositories::update_settings::get_or_create_default(&conn) {
                Ok(settings) => settings,
                Err(_) => return,
            }
        };

        if !db::repositories::update_settings::is_check_due(&settings) {
            return;
        }

        let check_result = {
            let pending = app.state::<PendingUpdateState>();
            let downloaded = app.state::<DownloadedUpdateState>();
            commands::updates::check_now(&app, &pending, &downloaded).await
        };

        {
            let db_state = app.state::<DbState>();
            let lock_result = db_state.0.lock();
            if let Ok(conn) = lock_result {
                let _ = db::repositories::update_settings::mark_checked_now(&conn, settings.id);
            }
        }

        let Ok(result) = check_result else { return };
        if !result.available || !settings.auto_download_enabled {
            return;
        }

        let download_result = commands::updates::download_update(
            app.state::<PendingUpdateState>(),
            app.state::<DownloadedUpdateState>(),
        )
        .await;
        if download_result.is_err() {
            return;
        }

        if settings.auto_install_enabled {
            let _ = commands::updates::install_update(
                app.state::<PendingUpdateState>(),
                app.state::<DownloadedUpdateState>(),
            );
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("app data directory should be resolvable on all supported platforms");
            std::fs::create_dir_all(&app_data_dir).expect("app data directory should be creatable");

            let db_path = app_data_dir.join("pastry-management.sqlite");
            let conn = db::open_and_migrate(&db_path)
                .unwrap_or_else(|e| panic!("failed to open/migrate database at {db_path:?}: {e}"));

            app.manage(DbState(Mutex::new(conn)));
            app.manage(DbPathState(db_path));
            app.manage(SessionState::default());
            app.manage(PendingUpdateState::default());
            app.manage(DownloadedUpdateState::default());

            run_startup_auto_backup_check(app.handle());
            run_startup_update_check(app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_status,
            commands::auth::setup_required,
            commands::auth::create_owner_account,
            commands::auth::create_user,
            commands::auth::login,
            commands::auth::change_password,
            commands::auth::logout,
            commands::auth::current_session,
            commands::suppliers::list_suppliers,
            commands::suppliers::get_supplier,
            commands::suppliers::create_supplier,
            commands::suppliers::update_supplier,
            commands::suppliers::archive_supplier,
            commands::suppliers::reactivate_supplier,
            commands::suppliers::delete_supplier,
            commands::raw_materials::list_raw_materials,
            commands::raw_materials::get_raw_material,
            commands::raw_materials::create_raw_material,
            commands::raw_materials::update_raw_material,
            commands::raw_materials::archive_raw_material,
            commands::raw_materials::reactivate_raw_material,
            commands::raw_materials::delete_raw_material,
            commands::purchase_records::list_purchase_records_for_material,
            commands::purchase_records::create_purchase_record,
            commands::purchase_records::list_recent_purchase_records,
            commands::measurement_units::list_measurement_units,
            commands::recipes::list_recipes,
            commands::recipes::get_recipe,
            commands::recipes::create_recipe,
            commands::recipes::update_recipe,
            commands::recipes::archive_recipe,
            commands::recipes::reactivate_recipe,
            commands::recipes::delete_recipe,
            commands::recipes::duplicate_recipe,
            commands::recipes::get_recipe_costing_graph,
            commands::recipes::list_raw_material_costing,
            commands::recipes::save_recipe_cost_snapshot,
            commands::recipes::list_recipe_cost_snapshots,
            commands::backup::get_backup_settings,
            commands::backup::update_backup_settings,
            commands::backup::choose_backup_directory,
            commands::backup::create_backup,
            commands::backup::list_backups,
            commands::backup::validate_backup_file,
            commands::backup::restore_backup,
            commands::backup::delete_backup,
            commands::cloud_backup::get_dropbox_settings,
            commands::cloud_backup::update_dropbox_settings,
            commands::cloud_backup::dropbox_connect,
            commands::cloud_backup::dropbox_disconnect,
            commands::cloud_backup::dropbox_test_connection,
            commands::cloud_backup::dropbox_upload_backup,
            commands::cloud_backup::dropbox_list_backups,
            commands::cloud_backup::dropbox_delete_backup,
            commands::cloud_backup::dropbox_restore_backup,
            commands::updates::get_current_app_version,
            commands::updates::get_update_settings,
            commands::updates::update_update_settings,
            commands::updates::check_for_update,
            commands::updates::download_update,
            commands::updates::install_update,
            commands::updates::restart_app,
            commands::categories::list_categories,
            commands::categories::create_category,
            commands::categories::update_category,
            commands::categories::archive_category,
            commands::categories::reactivate_category,
            commands::categories::delete_category,
            commands::import::choose_excel_file,
            commands::import::import_from_excel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
