use tauri::State;

use crate::db::repositories::expense_categories::{self, ExpenseCategory, ExpenseCategoryInput};
use crate::error::{AppError, AppResult};
use crate::DbState;

#[tauri::command]
pub fn list_expense_categories(
    db: State<DbState>,
    include_inactive: bool,
) -> AppResult<Vec<ExpenseCategory>> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    expense_categories::list(&conn, include_inactive)
}

#[tauri::command]
pub fn create_expense_category(
    db: State<DbState>,
    input: ExpenseCategoryInput,
) -> AppResult<ExpenseCategory> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    expense_categories::create(&conn, input)
}

#[tauri::command]
pub fn update_expense_category(
    db: State<DbState>,
    id: i64,
    input: ExpenseCategoryInput,
) -> AppResult<ExpenseCategory> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    expense_categories::update(&conn, id, input)
}

#[tauri::command]
pub fn archive_expense_category(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    expense_categories::set_active(&conn, id, false)
}

#[tauri::command]
pub fn reactivate_expense_category(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    expense_categories::set_active(&conn, id, true)
}

#[tauri::command]
pub fn delete_expense_category(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    expense_categories::delete(&conn, id)
}
