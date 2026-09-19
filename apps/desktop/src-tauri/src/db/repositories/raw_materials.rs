//! Raw material repository. Pricing/cost fields are deliberately absent from this module's DTOs —
//! resolving "what does this material currently cost" is the pricing-strategy engine's job
//! (Phase 4, packages/core), not the CRUD layer's. This module only stores and validates the
//! material's own attributes and its chosen strategy *name*.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct RawMaterial {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub base_unit_code: String,
    pub default_supplier_id: Option<i64>,
    pub pricing_strategy: String,
    pub pricing_strategy_config: Option<String>,
    pub notes: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct RawMaterialInput {
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub base_unit_code: String,
    pub default_supplier_id: Option<i64>,
    pub pricing_strategy: String,
    pub pricing_strategy_config: Option<String>,
    pub notes: Option<String>,
}

const VALID_STRATEGIES: [&str; 3] = ["latest", "average_n", "manual"];

fn validate(conn: &Connection, input: &RawMaterialInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::field("name", "Raw material name is required."));
    }

    let unit_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM measurement_units WHERE code = ?1",
            [&input.base_unit_code],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;
    if !unit_exists {
        return Err(AppError::field(
            "base_unit_code",
            format!(
                "'{}' is not a known measurement unit.",
                input.base_unit_code
            ),
        ));
    }

    if !VALID_STRATEGIES.contains(&input.pricing_strategy.as_str()) {
        return Err(AppError::field(
            "pricing_strategy",
            "Pricing strategy must be one of: latest, average_n, manual.",
        ));
    }

    if let Some(supplier_id) = input.default_supplier_id {
        let supplier_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM suppliers WHERE id = ?1",
                [supplier_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)?;
        if !supplier_exists {
            return Err(AppError::field(
                "default_supplier_id",
                "Selected supplier does not exist.",
            ));
        }
    }

    Ok(())
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<RawMaterial> {
    Ok(RawMaterial {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        category: row.get(3)?,
        base_unit_code: row.get(4)?,
        default_supplier_id: row.get(5)?,
        pricing_strategy: row.get(6)?,
        pricing_strategy_config: row.get(7)?,
        notes: row.get(8)?,
        is_active: row.get::<_, i64>(9)? != 0,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

const SELECT_COLUMNS: &str =
    "id, name, description, category, base_unit_code, default_supplier_id, \
     pricing_strategy, pricing_strategy_config, notes, is_active, created_at, updated_at";

pub fn list(conn: &Connection, include_inactive: bool) -> AppResult<Vec<RawMaterial>> {
    let sql = if include_inactive {
        format!("SELECT {SELECT_COLUMNS} FROM raw_materials ORDER BY name")
    } else {
        format!("SELECT {SELECT_COLUMNS} FROM raw_materials WHERE is_active = 1 ORDER BY name")
    };
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<RawMaterial> {
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM raw_materials WHERE id = ?1"),
        [id],
        map_row,
    )
    .optional()?
    .ok_or_else(|| AppError::new(format!("Raw material {id} was not found.")))
}

pub fn create(conn: &Connection, input: RawMaterialInput) -> AppResult<RawMaterial> {
    validate(conn, &input)?;
    conn.execute(
        "INSERT INTO raw_materials
            (name, description, category, base_unit_code, default_supplier_id,
             pricing_strategy, pricing_strategy_config, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            input.name.trim(),
            input.description,
            input.category,
            input.base_unit_code,
            input.default_supplier_id,
            input.pricing_strategy,
            input.pricing_strategy_config,
            input.notes,
        ],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: RawMaterialInput) -> AppResult<RawMaterial> {
    validate(conn, &input)?;
    let affected = conn.execute(
        "UPDATE raw_materials
         SET name = ?1, description = ?2, category = ?3, base_unit_code = ?4, default_supplier_id = ?5,
             pricing_strategy = ?6, pricing_strategy_config = ?7, notes = ?8,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?9",
        params![
            input.name.trim(),
            input.description,
            input.category,
            input.base_unit_code,
            input.default_supplier_id,
            input.pricing_strategy,
            input.pricing_strategy_config,
            input.notes,
            id,
        ],
    )?;
    if affected == 0 {
        return Err(AppError::new(format!("Raw material {id} was not found.")));
    }
    get(conn, id)
}

pub fn set_active(conn: &Connection, id: i64, active: bool) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE raw_materials SET is_active = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?2",
        params![active as i64, id],
    )?;
    if affected == 0 {
        return Err(AppError::new(format!("Raw material {id} was not found.")));
    }
    Ok(())
}

/// Hard delete — only permitted when no purchase history exists yet. Prefer `set_active(id,
/// false)` (archiving) once a material has any real purchase history, per docs/database-schema.md.
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let referenced: i64 = conn.query_row(
        "SELECT COUNT(*) FROM purchase_records WHERE raw_material_id = ?1",
        [id],
        |row| row.get(0),
    )?;
    if referenced > 0 {
        return Err(AppError::new(
            "This raw material has purchase history and cannot be deleted. Archive it instead.",
        ));
    }
    let affected = conn.execute("DELETE FROM raw_materials WHERE id = ?1", [id])?;
    if affected == 0 {
        return Err(AppError::new(format!("Raw material {id} was not found.")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../../migrations/0001_init.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../migrations/0002_core_data.sql"))
            .unwrap();
        conn
    }

    fn valid_input() -> RawMaterialInput {
        RawMaterialInput {
            name: "Flour".into(),
            description: None,
            category: Some("Dry goods".into()),
            base_unit_code: "g".into(),
            default_supplier_id: None,
            pricing_strategy: "latest".into(),
            pricing_strategy_config: None,
            notes: None,
        }
    }

    #[test]
    fn create_requires_a_name() {
        let conn = test_conn();
        let mut input = valid_input();
        input.name = "   ".into();
        let err = create(&conn, input).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("name"));
    }

    #[test]
    fn create_rejects_unknown_measurement_unit() {
        let conn = test_conn();
        let mut input = valid_input();
        input.base_unit_code = "gallon".into();
        let err = create(&conn, input).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("base_unit_code"));
    }

    #[test]
    fn create_rejects_unknown_pricing_strategy() {
        let conn = test_conn();
        let mut input = valid_input();
        input.pricing_strategy = "made_up_strategy".into();
        let err = create(&conn, input).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("pricing_strategy"));
    }

    #[test]
    fn create_rejects_nonexistent_default_supplier() {
        let conn = test_conn();
        let mut input = valid_input();
        input.default_supplier_id = Some(999);
        let err = create(&conn, input).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("default_supplier_id"));
    }

    #[test]
    fn create_and_get_round_trip() {
        let conn = test_conn();
        let created = create(&conn, valid_input()).unwrap();
        assert_eq!(created.name, "Flour");
        assert_eq!(created.base_unit_code, "g");

        let fetched = get(&conn, created.id).unwrap();
        assert_eq!(fetched.id, created.id);
    }

    #[test]
    fn archived_materials_excluded_from_default_listing() {
        let conn = test_conn();
        let created = create(&conn, valid_input()).unwrap();
        set_active(&conn, created.id, false).unwrap();

        assert_eq!(list(&conn, false).unwrap().len(), 0);
        assert_eq!(list(&conn, true).unwrap().len(), 1);
    }

    #[test]
    fn delete_rejected_once_purchase_history_exists() {
        let conn = test_conn();
        let material = create(&conn, valid_input()).unwrap();
        let supplier_id: i64 = {
            conn.execute("INSERT INTO suppliers (name) VALUES ('Acme')", [])
                .unwrap();
            conn.last_insert_rowid()
        };
        conn.execute(
            "INSERT INTO purchase_records
                (raw_material_id, supplier_id, purchase_date, quantity, purchase_unit_code,
                 total_price_micros, cost_per_base_unit_micros)
             VALUES (?1, ?2, '2026-01-01', 1000, 'g', 2500000, 2500)",
            params![material.id, supplier_id],
        )
        .unwrap();

        let err = delete(&conn, material.id).unwrap_err();
        assert!(err.message.contains("cannot be deleted"));
    }
}
