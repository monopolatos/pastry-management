use tauri::State;

use crate::auth::{self, SessionState};
use crate::db::repositories::income_categories::{self, IncomeCategory, IncomeCategoryInput};
use crate::error::{AppError, AppResult};
use crate::DbState;

#[tauri::command]
pub fn list_income_categories(
    db: State<DbState>,
    session: State<SessionState>,
    include_inactive: bool,
) -> AppResult<Vec<IncomeCategory>> {
    auth::require_finance_access(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    income_categories::list(&conn, include_inactive)
}

#[tauri::command]
pub fn create_income_category(
    db: State<DbState>,
    session: State<SessionState>,
    input: IncomeCategoryInput,
) -> AppResult<IncomeCategory> {
    auth::require_finance_access(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    income_categories::create(&conn, input)
}

#[tauri::command]
pub fn update_income_category(
    db: State<DbState>,
    session: State<SessionState>,
    id: i64,
    input: IncomeCategoryInput,
) -> AppResult<IncomeCategory> {
    auth::require_finance_access(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    income_categories::update(&conn, id, input)
}

#[tauri::command]
pub fn archive_income_category(
    db: State<DbState>,
    session: State<SessionState>,
    id: i64,
) -> AppResult<()> {
    auth::require_finance_access(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    income_categories::set_active(&conn, id, false)
}

#[tauri::command]
pub fn reactivate_income_category(
    db: State<DbState>,
    session: State<SessionState>,
    id: i64,
) -> AppResult<()> {
    auth::require_finance_access(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    income_categories::set_active(&conn, id, true)
}

#[tauri::command]
pub fn delete_income_category(
    db: State<DbState>,
    session: State<SessionState>,
    id: i64,
) -> AppResult<()> {
    auth::require_finance_access(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    income_categories::delete(&conn, id)
}
