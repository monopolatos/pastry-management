use tauri::State;

use crate::auth::{self, SessionState};
use crate::db::repositories::categories::{self, Category, CategoryInput};
use crate::error::{AppError, AppResult};
use crate::DbState;

#[tauri::command]
pub fn list_categories(db: State<DbState>, include_inactive: bool) -> AppResult<Vec<Category>> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    categories::list(&conn, include_inactive)
}

#[tauri::command]
pub fn create_category(
    db: State<DbState>,
    session: State<SessionState>,
    input: CategoryInput,
) -> AppResult<Category> {
    auth::require_write_access(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    categories::create(&conn, input)
}

#[tauri::command]
pub fn update_category(
    db: State<DbState>,
    session: State<SessionState>,
    id: i64,
    input: CategoryInput,
) -> AppResult<Category> {
    auth::require_write_access(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    categories::update(&conn, id, input)
}

#[tauri::command]
pub fn archive_category(
    db: State<DbState>,
    session: State<SessionState>,
    id: i64,
) -> AppResult<()> {
    auth::require_write_access(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    categories::set_active(&conn, id, false)
}

#[tauri::command]
pub fn reactivate_category(
    db: State<DbState>,
    session: State<SessionState>,
    id: i64,
) -> AppResult<()> {
    auth::require_write_access(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    categories::set_active(&conn, id, true)
}

#[tauri::command]
pub fn delete_category(db: State<DbState>, session: State<SessionState>, id: i64) -> AppResult<()> {
    auth::require_write_access(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    categories::delete(&conn, id)
}
