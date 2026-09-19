mod auth;
mod commands;
mod db;
mod error;

use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

use auth::SessionState;

/// Shared, mutex-guarded connection handle. rusqlite::Connection is not Sync, and a single-user
/// desktop app has no need for a connection pool, so one guarded connection is the simplest
/// correct choice here.
pub struct DbState(pub Mutex<Connection>);

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            app.manage(SessionState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_status,
            commands::auth::setup_required,
            commands::auth::create_owner_account,
            commands::auth::create_user,
            commands::auth::login,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
