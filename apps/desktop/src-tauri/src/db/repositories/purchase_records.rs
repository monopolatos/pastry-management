//! Purchase record repository — append-only price history (docs/database-schema.md,
//! requirement §8). There is deliberately no `update` or `delete` function here: a mistaken entry
//! is corrected by recording a new purchase, never by editing or removing history. If that turns
//! out to be too rigid in practice (e.g. same-day fat-finger correction), that's a product
//! decision to revisit explicitly — not something to quietly work around in code.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct PurchaseRecord {
    pub id: i64,
    pub raw_material_id: i64,
    /// A purchase may have no recorded supplier (e.g. a cash/market buy) — see
    /// docs/database-schema.md.
    pub supplier_id: Option<i64>,
    pub purchase_date: String,
    pub quantity: f64,
    pub purchase_unit_code: String,
    pub total_price_micros: i64,
    pub cost_per_base_unit_micros: i64,
    pub expiration_date: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub created_by_user_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct PurchaseRecordInput {
    pub raw_material_id: i64,
    pub supplier_id: Option<i64>,
    pub purchase_date: String,
    pub quantity: f64,
    pub purchase_unit_code: String,
    /// Total price paid, in minor currency units × 1,000,000 (see docs/database-schema.md).
    /// The frontend is responsible for converting the user's decimal entry (e.g. "2.50") into
    /// this fixed-point representation before calling the command, using the same decimal.js
    /// convention the costing engine uses.
    pub total_price_micros: i64,
    pub expiration_date: Option<String>,
    pub notes: Option<String>,
}

struct UnitInfo {
    kind: String,
    to_base_factor: f64,
}

fn lookup_unit(conn: &Connection, code: &str) -> AppResult<UnitInfo> {
    conn.query_row(
        "SELECT kind, to_base_factor FROM measurement_units WHERE code = ?1",
        [code],
        |row| {
            Ok(UnitInfo {
                kind: row.get(0)?,
                to_base_factor: row.get(1)?,
            })
        },
    )
    .map_err(|_| {
        AppError::field(
            "purchase_unit_code",
            format!("'{code}' is not a known measurement unit."),
        )
    })
}

fn validate_and_compute_cost(conn: &Connection, input: &PurchaseRecordInput) -> AppResult<i64> {
    if input.quantity <= 0.0 {
        return Err(AppError::field(
            "quantity",
            "Quantity must be greater than zero.",
        ));
    }
    if input.total_price_micros < 0 {
        return Err(AppError::field(
            "total_price_micros",
            "Total price cannot be negative.",
        ));
    }

    let material_base_unit: String = conn
        .query_row(
            "SELECT base_unit_code FROM raw_materials WHERE id = ?1",
            [input.raw_material_id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::field("raw_material_id", "Selected raw material does not exist."))?;

    if let Some(supplier_id) = input.supplier_id {
        let supplier_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM suppliers WHERE id = ?1",
                [supplier_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)?;
        if !supplier_exists {
            return Err(AppError::field(
                "supplier_id",
                "Selected supplier does not exist.",
            ));
        }
    }

    let purchase_unit = lookup_unit(conn, &input.purchase_unit_code)?;
    let material_unit = lookup_unit(conn, &material_base_unit)?;

    // Weight and volume are never interchangeable without an explicit density conversion the
    // application does not yet collect (requirement §7) — reject the mismatch outright rather
    // than silently guessing.
    if purchase_unit.kind != material_unit.kind {
        return Err(AppError::field(
            "purchase_unit_code",
            format!(
                "This raw material is measured in {} units; '{}' is a {} unit and can't be converted automatically.",
                material_unit.kind, input.purchase_unit_code, purchase_unit.kind
            ),
        ));
    }

    let quantity_in_base_units = input.quantity * purchase_unit.to_base_factor;
    let cost_per_base_unit_micros =
        (input.total_price_micros as f64 / quantity_in_base_units).round() as i64;

    Ok(cost_per_base_unit_micros)
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<PurchaseRecord> {
    Ok(PurchaseRecord {
        id: row.get(0)?,
        raw_material_id: row.get(1)?,
        supplier_id: row.get(2)?,
        purchase_date: row.get(3)?,
        quantity: row.get(4)?,
        purchase_unit_code: row.get(5)?,
        total_price_micros: row.get(6)?,
        cost_per_base_unit_micros: row.get(7)?,
        expiration_date: row.get(8)?,
        notes: row.get(9)?,
        created_at: row.get(10)?,
        created_by_user_id: row.get(11)?,
    })
}

const SELECT_COLUMNS: &str = "id, raw_material_id, supplier_id, purchase_date, quantity, purchase_unit_code, \
     total_price_micros, cost_per_base_unit_micros, expiration_date, notes, created_at, created_by_user_id";

pub fn list_for_material(
    conn: &Connection,
    raw_material_id: i64,
) -> AppResult<Vec<PurchaseRecord>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLUMNS} FROM purchase_records
         WHERE raw_material_id = ?1
         ORDER BY purchase_date DESC, id DESC"
    ))?;
    let rows = stmt.query_map([raw_material_id], map_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[derive(Debug, Clone, Serialize)]
pub struct RecentPurchaseRecord {
    pub id: i64,
    pub raw_material_id: i64,
    pub raw_material_name: String,
    pub purchase_date: String,
    pub cost_per_base_unit_micros: i64,
    pub base_unit_code: String,
    pub created_at: String,
}

/// Cross-material recent purchase activity, for the dashboard's "recent price updates" feed —
/// ordered by when the entry was recorded (`created_at`), not the purchase's own date, so a
/// backfilled historical purchase doesn't jump to the top of "recent activity."
pub fn list_recent(conn: &Connection, limit: i64) -> AppResult<Vec<RecentPurchaseRecord>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.raw_material_id, m.name, p.purchase_date, p.cost_per_base_unit_micros,
                m.base_unit_code, p.created_at
         FROM purchase_records p
         JOIN raw_materials m ON m.id = p.raw_material_id
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit], |r| {
        Ok(RecentPurchaseRecord {
            id: r.get(0)?,
            raw_material_id: r.get(1)?,
            raw_material_name: r.get(2)?,
            purchase_date: r.get(3)?,
            cost_per_base_unit_micros: r.get(4)?,
            base_unit_code: r.get(5)?,
            created_at: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn create(
    conn: &Connection,
    input: PurchaseRecordInput,
    created_by_user_id: Option<i64>,
) -> AppResult<PurchaseRecord> {
    let cost_per_base_unit_micros = validate_and_compute_cost(conn, &input)?;

    conn.execute(
        "INSERT INTO purchase_records
            (raw_material_id, supplier_id, purchase_date, quantity, purchase_unit_code,
             total_price_micros, cost_per_base_unit_micros, expiration_date, notes, created_by_user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            input.raw_material_id,
            input.supplier_id,
            input.purchase_date,
            input.quantity,
            input.purchase_unit_code,
            input.total_price_micros,
            cost_per_base_unit_micros,
            input.expiration_date,
            input.notes,
            created_by_user_id,
        ],
    )?;

    let id = conn.last_insert_rowid();
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM purchase_records WHERE id = ?1"),
        [id],
        map_row,
    )
    .map_err(AppError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repositories::{raw_materials, suppliers};

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../../migrations/0001_init.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../migrations/0002_core_data.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../migrations/0007_categories.sql"))
            .unwrap();
        conn
    }

    fn seed_flour_and_supplier(conn: &Connection) -> (i64, i64) {
        let supplier = suppliers::create(
            conn,
            suppliers::SupplierInput {
                name: "Acme".into(),
                contact_person: None,
                phone: None,
                email: None,
                address: None,
                vat_number: None,
                notes: None,
            },
        )
        .unwrap();
        let material = raw_materials::create(
            conn,
            raw_materials::RawMaterialInput {
                name: "Flour".into(),
                description: None,
                category_id: None,
                base_unit_code: "g".into(),
                default_supplier_id: None,
                pricing_strategy: "latest".into(),
                pricing_strategy_config: None,
                notes: None,
            },
        )
        .unwrap();
        (material.id, supplier.id)
    }

    #[test]
    fn one_kg_for_2_50_euro_costs_a_quarter_cent_per_gram() {
        let conn = test_conn();
        let (material_id, supplier_id) = seed_flour_and_supplier(&conn);

        let record = create(
            &conn,
            PurchaseRecordInput {
                raw_material_id: material_id,
                supplier_id: Some(supplier_id),
                purchase_date: "2026-01-15".into(),
                quantity: 1.0,
                purchase_unit_code: "kg".into(),
                total_price_micros: 2_500_000, // €2.50
                expiration_date: None,
                notes: None,
            },
            None,
        )
        .unwrap();

        // €2.50 / 1000g = €0.0025/g = 2500 micros/g
        assert_eq!(record.cost_per_base_unit_micros, 2500);
    }

    #[test]
    fn purchase_can_be_recorded_without_a_supplier() {
        let conn = test_conn();
        let (material_id, _supplier_id) = seed_flour_and_supplier(&conn);

        let record = create(
            &conn,
            PurchaseRecordInput {
                raw_material_id: material_id,
                supplier_id: None,
                purchase_date: "2026-01-15".into(),
                quantity: 1.0,
                purchase_unit_code: "kg".into(),
                total_price_micros: 2_500_000,
                expiration_date: None,
                notes: None,
            },
            None,
        )
        .unwrap();

        assert_eq!(record.supplier_id, None);
        assert_eq!(record.cost_per_base_unit_micros, 2500);
    }

    #[test]
    fn rejects_zero_quantity() {
        let conn = test_conn();
        let (material_id, supplier_id) = seed_flour_and_supplier(&conn);

        let err = create(
            &conn,
            PurchaseRecordInput {
                raw_material_id: material_id,
                supplier_id: Some(supplier_id),
                purchase_date: "2026-01-15".into(),
                quantity: 0.0,
                purchase_unit_code: "kg".into(),
                total_price_micros: 2_500_000,
                expiration_date: None,
                notes: None,
            },
            None,
        )
        .unwrap_err();
        assert_eq!(err.field.as_deref(), Some("quantity"));
    }

    #[test]
    fn rejects_weight_material_purchased_in_volume_unit() {
        let conn = test_conn();
        let (material_id, supplier_id) = seed_flour_and_supplier(&conn);

        let err = create(
            &conn,
            PurchaseRecordInput {
                raw_material_id: material_id,
                supplier_id: Some(supplier_id),
                purchase_date: "2026-01-15".into(),
                quantity: 1.0,
                purchase_unit_code: "l".into(),
                total_price_micros: 2_500_000,
                expiration_date: None,
                notes: None,
            },
            None,
        )
        .unwrap_err();
        assert_eq!(err.field.as_deref(), Some("purchase_unit_code"));
    }

    #[test]
    fn rejects_unknown_raw_material() {
        let conn = test_conn();
        let (_material_id, supplier_id) = seed_flour_and_supplier(&conn);

        let err = create(
            &conn,
            PurchaseRecordInput {
                raw_material_id: 999,
                supplier_id: Some(supplier_id),
                purchase_date: "2026-01-15".into(),
                quantity: 1.0,
                purchase_unit_code: "kg".into(),
                total_price_micros: 2_500_000,
                expiration_date: None,
                notes: None,
            },
            None,
        )
        .unwrap_err();
        assert_eq!(err.field.as_deref(), Some("raw_material_id"));
    }

    #[test]
    fn history_is_append_only_and_ordered_most_recent_first() {
        let conn = test_conn();
        let (material_id, supplier_id) = seed_flour_and_supplier(&conn);

        for (date, price) in [
            ("2026-01-01", 2_000_000),
            ("2026-02-01", 2_200_000),
            ("2026-03-01", 2_500_000),
        ] {
            create(
                &conn,
                PurchaseRecordInput {
                    raw_material_id: material_id,
                    supplier_id: Some(supplier_id),
                    purchase_date: date.into(),
                    quantity: 1.0,
                    purchase_unit_code: "kg".into(),
                    total_price_micros: price,
                    expiration_date: None,
                    notes: None,
                },
                None,
            )
            .unwrap();
        }

        let history = list_for_material(&conn, material_id).unwrap();
        assert_eq!(history.len(), 3);
        assert_eq!(
            history[0].purchase_date, "2026-03-01",
            "most recent purchase should come first"
        );
        assert_eq!(history[2].purchase_date, "2026-01-01");
    }

    #[test]
    fn list_recent_spans_materials_and_respects_limit() {
        let conn = test_conn();
        let (material_id, supplier_id) = seed_flour_and_supplier(&conn);

        for date in ["2026-01-01", "2026-02-01", "2026-03-01"] {
            create(
                &conn,
                PurchaseRecordInput {
                    raw_material_id: material_id,
                    supplier_id: Some(supplier_id),
                    purchase_date: date.into(),
                    quantity: 1.0,
                    purchase_unit_code: "kg".into(),
                    total_price_micros: 2_000_000,
                    expiration_date: None,
                    notes: None,
                },
                None,
            )
            .unwrap();
        }

        let recent = list_recent(&conn, 2).unwrap();
        assert_eq!(recent.len(), 2, "should respect the limit");
        assert_eq!(recent[0].raw_material_name, "Flour");
    }
}
