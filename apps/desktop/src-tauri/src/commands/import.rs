//! Bulk import of categories and raw materials ("products") from a two-sheet `.xlsx` workbook.
//! See `crate::import` for the sheet layout contract and parsing logic; this module owns the
//! database side effects and the summary report shown to the user afterward.
//!
//! Import is best-effort, not all-or-nothing: one malformed row is recorded in the summary and
//! skipped rather than aborting the other 90 good ones. Re-running an import on the same file is
//! safe — existing categories (matched case-insensitively) and existing raw materials (matched
//! case-insensitively by name) are left untouched, not duplicated or overwritten.

use std::path::PathBuf;

use serde::Serialize;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::auth::SessionState;
use crate::db::repositories::{categories, purchase_records, raw_materials};
use crate::error::{AppError, AppResult};
use crate::{import, DbState};

/// The workbook's purchase-price column is documented as €/kg, so every imported raw material
/// uses `kg` as its base unit and its initial purchase record's unit — there is no per-row unit
/// column to read instead.
const IMPORT_BASE_UNIT_CODE: &str = "kg";

#[derive(Debug, Default, Serialize)]
pub struct ImportSummary {
    pub categories_created: Vec<String>,
    pub categories_already_existed: Vec<String>,
    pub products_created: Vec<String>,
    pub products_skipped_existing: Vec<String>,
    /// `"<row name>: <reason>"` — a row that couldn't be created at all (e.g. failed validation).
    pub products_skipped_invalid: Vec<String>,
}

/// Resolves a category by name, creating it if it doesn't exist yet, and records which happened
/// in `summary` without double-counting a name the same import run already created.
fn resolve_category(
    conn: &rusqlite::Connection,
    name: &str,
    summary: &mut ImportSummary,
) -> AppResult<i64> {
    let already_existed = categories::find_by_name(conn, name)?.is_some();
    let category = categories::find_or_create(conn, name)?;
    if already_existed {
        if !summary.categories_already_existed.contains(&category.name) {
            summary
                .categories_already_existed
                .push(category.name.clone());
        }
    } else if !summary.categories_created.contains(&category.name) {
        summary.categories_created.push(category.name.clone());
    }
    Ok(category.id)
}

#[tauri::command]
pub async fn choose_excel_file(app: tauri::AppHandle) -> AppResult<Option<String>> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("Excel workbook", &["xlsx"])
        .pick_file(move |file| {
            let _ = tx.send(file);
        });
    let picked = rx
        .recv()
        .map_err(|e| AppError::new(format!("File picker did not respond: {e}")))?;
    Ok(picked.map(|p| p.to_string()))
}

#[tauri::command]
pub fn import_from_excel(
    db: State<DbState>,
    session: State<SessionState>,
    path: String,
) -> AppResult<ImportSummary> {
    let (products_range, categories_range) =
        import::read_workbook(&PathBuf::from(path)).map_err(AppError::new)?;

    let parsed_categories = import::parse_categories(&categories_range);
    let parsed_products = import::parse_products(&products_range);

    let conn = db.0.lock().map_err(|e| AppError::new(e.to_string()))?;
    let created_by_user_id = session
        .0
        .lock()
        .map_err(|e| AppError::new(e.to_string()))?
        .as_ref()
        .map(|s| s.user.id);

    let mut summary = ImportSummary::default();

    // Import every listed category up front, even ones no product row references yet — that's
    // the whole point of a "preselected categories" starting list (see the categories sheet).
    for name in &parsed_categories {
        resolve_category(&conn, name, &mut summary)?;
    }

    for row in parsed_products {
        if raw_materials::find_by_name(&conn, &row.name)?.is_some() {
            summary.products_skipped_existing.push(row.name);
            continue;
        }

        let category_id = match &row.category_name {
            Some(name) => Some(resolve_category(&conn, name, &mut summary)?),
            None => None,
        };

        let material = match raw_materials::create(
            &conn,
            raw_materials::RawMaterialInput {
                name: row.name.clone(),
                description: None,
                category_id,
                base_unit_code: IMPORT_BASE_UNIT_CODE.to_string(),
                default_supplier_id: None,
                pricing_strategy: "latest".to_string(),
                pricing_strategy_config: None,
                notes: row.notes.clone(),
            },
        ) {
            Ok(material) => material,
            Err(e) => {
                summary
                    .products_skipped_invalid
                    .push(format!("{}: {}", row.name, e.message));
                continue;
            }
        };

        summary.products_created.push(row.name.clone());

        // A price is optional in the sheet; when present, record it as the material's first
        // purchase (quantity 1kg, no supplier, dated today) so the costing engine has something
        // to work with immediately — raw materials don't store price directly, see
        // db/repositories/purchase_records.rs.
        if let Some(price_per_kg) = row.price_per_kg.filter(|p| *p >= 0.0) {
            let total_price_micros = (price_per_kg * 1_000_000.0).round() as i64;
            if let Err(e) = purchase_records::create(
                &conn,
                purchase_records::PurchaseRecordInput {
                    raw_material_id: material.id,
                    supplier_id: None,
                    purchase_date: chrono::Utc::now().format("%Y-%m-%d").to_string(),
                    quantity: 1.0,
                    purchase_unit_code: IMPORT_BASE_UNIT_CODE.to_string(),
                    total_price_micros,
                    expiration_date: None,
                    notes: None,
                },
                created_by_user_id,
            ) {
                summary.products_skipped_invalid.push(format!(
                    "{} (material created, but starting price could not be recorded): {}",
                    row.name, e.message
                ));
            }
        }
    }

    Ok(summary)
}
