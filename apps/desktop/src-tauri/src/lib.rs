mod db;

use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

/// Shared, mutex-guarded connection handle. rusqlite::Connection is not Sync, and a single-user
/// desktop app has no need for a connection pool, so one guarded connection is the simplest
/// correct choice here.
pub struct DbState(pub Mutex<Connection>);

#[tauri::command]
fn db_status(state: tauri::State<DbState>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let schema_version: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |row| {
            row.get(0)
        })
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
            std::fs::create_dir_all(&app_data_dir)
                .expect("app data directory should be creatable");

            let db_path = app_data_dir.join("pastry-management.sqlite");
            let conn = db::open_and_migrate(&db_path)
                .unwrap_or_else(|e| panic!("failed to open/migrate database at {db_path:?}: {e}"));

            app.manage(DbState(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![db_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
