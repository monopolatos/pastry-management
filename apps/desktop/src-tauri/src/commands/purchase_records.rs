use tauri::State;

use crate::auth::SessionState;
use crate::db::repositories::purchase_records::{
    self, PurchaseRecord, PurchaseRecordInput, RecentPurchaseRecord,
};
use crate::error::{AppError, AppResult};
use crate::DbState;

#[tauri::command]
pub fn list_purchase_records_for_material(
    db: State<DbState>,
    raw_material_id: i64,
) -> AppResult<Vec<PurchaseRecord>> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    purchase_records::list_for_material(&conn, raw_material_id)
}

#[tauri::command]
pub fn create_purchase_record(
    db: State<DbState>,
    session: State<SessionState>,
    input: PurchaseRecordInput,
) -> AppResult<PurchaseRecord> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    let created_by_user_id = session
        .0
        .lock()
        .map_err(|e| AppError::new(e.to_string()))?
        .as_ref()
        .map(|s| s.user.id);
    purchase_records::create(&conn, input, created_by_user_id)
}

#[tauri::command]
pub fn list_recent_purchase_records(
    db: State<DbState>,
    limit: i64,
) -> AppResult<Vec<RecentPurchaseRecord>> {
    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    purchase_records::list_recent(&conn, limit)
}
