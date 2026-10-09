use tauri::State;

use crate::db::repositories::income_categories::{self, IncomeCategory, IncomeCategoryInput};
use crate::error::{AppError, AppResult};
use crate::DbState;

#[tauri::command]
pub fn list_income_categories(
    db: State<DbState>,
    include_inactive: bool,
) -> AppResult<Vec<IncomeCategory>> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    income_categories::list(&conn, include_inactive)
}

#[tauri::command]
pub fn create_income_category(
    db: State<DbState>,
    input: IncomeCategoryInput,
) -> AppResult<IncomeCategory> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    income_categories::create(&conn, input)
}

#[tauri::command]
pub fn update_income_category(
    db: State<DbState>,
    id: i64,
    input: IncomeCategoryInput,
) -> AppResult<IncomeCategory> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    income_categories::update(&conn, id, input)
}

#[tauri::command]
pub fn archive_income_category(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    income_categories::set_active(&conn, id, false)
}

#[tauri::command]
pub fn reactivate_income_category(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    income_categories::set_active(&conn, id, true)
}

#[tauri::command]
pub fn delete_income_category(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    income_categories::delete(&conn, id)
}
