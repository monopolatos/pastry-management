use tauri::State;

use crate::auth::SessionState;
use crate::db::repositories::income_entries::{self, IncomeEntry, IncomeEntryInput};
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
pub fn list_income_entries(db: State<DbState>) -> AppResult<Vec<IncomeEntry>> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    income_entries::list(&conn)
}

#[tauri::command]
pub fn create_income_entry(
    db: State<DbState>,
    session: State<SessionState>,
    input: IncomeEntryInput,
) -> AppResult<IncomeEntry> {
    let user_id = current_user_id(&session)?;
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    income_entries::create(&conn, input, user_id)
}

#[tauri::command]
pub fn update_income_entry(
    db: State<DbState>,
    id: i64,
    input: IncomeEntryInput,
) -> AppResult<IncomeEntry> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    income_entries::update(&conn, id, input)
}

#[tauri::command]
pub fn delete_income_entry(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    income_entries::delete(&conn, id)
}
