use tauri::State;

use crate::db::repositories::suppliers::{self, Supplier, SupplierInput};
use crate::error::{AppError, AppResult};
use crate::DbState;

#[tauri::command]
pub fn list_suppliers(db: State<DbState>, include_inactive: bool) -> AppResult<Vec<Supplier>> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    suppliers::list(&conn, include_inactive)
}

#[tauri::command]
pub fn get_supplier(db: State<DbState>, id: i64) -> AppResult<Supplier> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    suppliers::get(&conn, id)
}

#[tauri::command]
pub fn create_supplier(db: State<DbState>, input: SupplierInput) -> AppResult<Supplier> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    suppliers::create(&conn, input)
}

#[tauri::command]
pub fn update_supplier(db: State<DbState>, id: i64, input: SupplierInput) -> AppResult<Supplier> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    suppliers::update(&conn, id, input)
}

#[tauri::command]
pub fn archive_supplier(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    suppliers::set_active(&conn, id, false)
}

#[tauri::command]
pub fn reactivate_supplier(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    suppliers::set_active(&conn, id, true)
}

#[tauri::command]
pub fn delete_supplier(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    suppliers::delete(&conn, id)
}
