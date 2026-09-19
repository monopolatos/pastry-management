use tauri::State;

use crate::db::repositories::measurement_units::{self, MeasurementUnit};
use crate::error::{AppError, AppResult};
use crate::DbState;

#[tauri::command]
pub fn list_measurement_units(db: State<DbState>) -> AppResult<Vec<MeasurementUnit>> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    measurement_units::list(&conn)
}
