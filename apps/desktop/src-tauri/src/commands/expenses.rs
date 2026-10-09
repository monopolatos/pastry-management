use tauri::State;

use crate::auth::SessionState;
use crate::db::repositories::expenses::{self, Expense, ExpenseInput};
use crate::error::{AppError, AppResult};
use crate::DbState;

fn current_user_id(session: &State<SessionState>) -> AppResult<Option<i64>> {
    Ok(session
        .0
        .lock()
        .map_err(|e| AppError::new(e.to_string()))?
        .as_ref()
        .map(|s| s.user.id))
}

#[tauri::command]
pub fn list_expenses(db: State<DbState>) -> AppResult<Vec<Expense>> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    expenses::list(&conn)
}

#[tauri::command]
pub fn create_expense(
    db: State<DbState>,
    session: State<SessionState>,
    input: ExpenseInput,
) -> AppResult<Expense> {
    let user_id = current_user_id(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    expenses::create(&conn, input, user_id)
}

#[tauri::command]
pub fn update_expense(db: State<DbState>, id: i64, input: ExpenseInput) -> AppResult<Expense> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    expenses::update(&conn, id, input)
}

#[tauri::command]
pub fn delete_expense(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    expenses::delete(&conn, id)
}
