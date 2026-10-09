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

/// A row with no price in any of the three columns gets this as its base unit — an arbitrary but
/// harmless default, since there's no price to attach to it either way; the user can change it
/// from the raw material's own edit screen once they know what it actually is.
const DEFAULT_BASE_UNIT_CODE: &str = "kg";

/// Decides which of the sheet's three price columns applies to this row, and therefore which base
/// unit the imported material gets — `raw_materials` has exactly one base unit per material, not
/// one per price column, so at most one of `price_per_kg` / `price_per_piece` / `price_per_liter`
/// is expected to be filled in. If a row has more than one (a likely copy-paste slip in an
/// otherwise-good spreadsheet), kg wins, then liter, then piece, rather than dropping the row —
/// picking one deterministically is more useful than discarding otherwise-good data over it.
fn resolve_unit_and_price(row: &import::ParsedProductRow) -> (&'static str, Option<f64>) {
    if let Some(price) = row.price_per_kg.filter(|p| *p >= 0.0) {
        return ("kg", Some(price));
    }
    if let Some(price) = row.price_per_liter.filter(|p| *p >= 0.0) {
        return ("l", Some(price));
    }
    if let Some(price) = row.price_per_piece.filter(|p| *p >= 0.0) {
        return ("piece", Some(price));
    }
    (DEFAULT_BASE_UNIT_CODE, None)
}

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

        let (base_unit_code, price) = resolve_unit_and_price(&row);

        let material = match raw_materials::create(
            &conn,
            raw_materials::RawMaterialInput {
                name: row.name.clone(),
                description: None,
                category_id,
                base_unit_code: base_unit_code.to_string(),
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
        // purchase (quantity 1 of its base unit, no supplier, dated today) so the costing engine
        // has something to work with immediately — raw materials don't store price directly, see
        // db/repositories/purchase_records.rs.
        if let Some(price) = price {
            let total_price_micros = (price * 1_000_000.0).round() as i64;
            if let Err(e) = purchase_records::create(
                &conn,
                purchase_records::PurchaseRecordInput {
                    raw_material_id: material.id,
                    supplier_id: None,
                    purchase_date: chrono::Utc::now().format("%Y-%m-%d").to_string(),
                    quantity: 1.0,
                    purchase_unit_code: base_unit_code.to_string(),
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
