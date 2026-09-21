mod auth;
mod backup;
mod commands;
mod db;
mod error;

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

use auth::SessionState;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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

            run_startup_auto_backup_check(app.handle());

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
