use tauri::State;

use crate::db::repositories::raw_materials::{self, RawMaterial, RawMaterialInput};
use crate::error::{AppError, AppResult};
use crate::DbState;

#[tauri::command]
pub fn list_raw_materials(
    db: State<DbState>,
    include_inactive: bool,
) -> AppResult<Vec<RawMaterial>> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    raw_materials::list(&conn, include_inactive)
}

#[tauri::command]
pub fn get_raw_material(db: State<DbState>, id: i64) -> AppResult<RawMaterial> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    raw_materials::get(&conn, id)
}

#[tauri::command]
pub fn create_raw_material(db: State<DbState>, input: RawMaterialInput) -> AppResult<RawMaterial> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    raw_materials::create(&conn, input)
}

#[tauri::command]
pub fn update_raw_material(
    db: State<DbState>,
    id: i64,
    input: RawMaterialInput,
) -> AppResult<RawMaterial> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    raw_materials::update(&conn, id, input)
}

#[tauri::command]
pub fn archive_raw_material(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    raw_materials::set_active(&conn, id, false)
}

#[tauri::command]
pub fn reactivate_raw_material(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    raw_materials::set_active(&conn, id, true)
}

#[tauri::command]
pub fn delete_raw_material(db: State<DbState>, id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    raw_materials::delete(&conn, id)
}
