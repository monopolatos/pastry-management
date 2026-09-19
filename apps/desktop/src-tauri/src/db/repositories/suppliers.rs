//! Supplier repository: plain CRUD with soft-delete (archive) preferred over hard delete, per
//! docs/database-schema.md's deletion policy — a supplier referenced by any raw material or
//! purchase record can only be archived, never destroyed.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct Supplier {
    pub id: i64,
    pub name: String,
    pub contact_person: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub vat_number: Option<String>,
    pub notes: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct SupplierInput {
    pub name: String,
    pub contact_person: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub vat_number: Option<String>,
    pub notes: Option<String>,
}

fn validate(input: &SupplierInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::field("name", "Supplier name is required."));
    }
    if let Some(email) = input.email.as_deref().filter(|e| !e.is_empty()) {
        if !email.contains('@') {
            return Err(AppError::field("email", "Enter a valid email address."));
        }
    }
    Ok(())
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<Supplier> {
    Ok(Supplier {
        id: row.get(0)?,
        name: row.get(1)?,
        contact_person: row.get(2)?,
        phone: row.get(3)?,
        email: row.get(4)?,
        address: row.get(5)?,
        vat_number: row.get(6)?,
        notes: row.get(7)?,
        is_active: row.get::<_, i64>(8)? != 0,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

const SELECT_COLUMNS: &str =
    "id, name, contact_person, phone, email, address, vat_number, notes, is_active, created_at, updated_at";

pub fn list(conn: &Connection, include_inactive: bool) -> AppResult<Vec<Supplier>> {
    let sql = if include_inactive {
        format!("SELECT {SELECT_COLUMNS} FROM suppliers ORDER BY name")
    } else {
        format!("SELECT {SELECT_COLUMNS} FROM suppliers WHERE is_active = 1 ORDER BY name")
    };
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Supplier> {
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM suppliers WHERE id = ?1"),
        [id],
        map_row,
    )
    .optional()?
    .ok_or_else(|| AppError::new(format!("Supplier {id} was not found.")))
}

pub fn create(conn: &Connection, input: SupplierInput) -> AppResult<Supplier> {
    validate(&input)?;
    conn.execute(
        "INSERT INTO suppliers (name, contact_person, phone, email, address, vat_number, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            input.name.trim(),
            input.contact_person,
            input.phone,
            input.email,
            input.address,
            input.vat_number,
            input.notes,
        ],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: SupplierInput) -> AppResult<Supplier> {
    validate(&input)?;
    let affected = conn.execute(
        "UPDATE suppliers
         SET name = ?1, contact_person = ?2, phone = ?3, email = ?4, address = ?5,
             vat_number = ?6, notes = ?7, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?8",
        params![
            input.name.trim(),
            input.contact_person,
            input.phone,
            input.email,
            input.address,
            input.vat_number,
            input.notes,
            id,
        ],
    )?;
    if affected == 0 {
        return Err(AppError::new(format!("Supplier {id} was not found.")));
    }
    get(conn, id)
}

pub fn set_active(conn: &Connection, id: i64, active: bool) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE suppliers SET is_active = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?2",
        params![active as i64, id],
    )?;
    if affected == 0 {
        return Err(AppError::new(format!("Supplier {id} was not found.")));
    }
    Ok(())
}

/// Hard delete — only permitted when nothing references this supplier. Callers should generally
/// prefer `set_active(id, false)` (archiving); this exists for cleaning up a genuine data-entry
/// mistake with no history attached yet.
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let referenced: i64 = conn.query_row(
        "SELECT
            (SELECT COUNT(*) FROM raw_materials WHERE default_supplier_id = ?1) +
            (SELECT COUNT(*) FROM purchase_records WHERE supplier_id = ?1)",
        [id],
        |row| row.get(0),
    )?;
    if referenced > 0 {
        return Err(AppError::new(
            "This supplier has purchase history or linked raw materials and cannot be deleted. Archive it instead.",
        ));
    }
    let affected = conn.execute("DELETE FROM suppliers WHERE id = ?1", [id])?;
    if affected == 0 {
        return Err(AppError::new(format!("Supplier {id} was not found.")));
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

    #[test]
    fn create_requires_a_name() {
        let conn = test_conn();
        let err = create(
            &conn,
            SupplierInput {
                name: "  ".into(),
                contact_person: None,
                phone: None,
                email: None,
                address: None,
                vat_number: None,
                notes: None,
            },
        )
        .unwrap_err();
        assert_eq!(err.field.as_deref(), Some("name"));
    }

    #[test]
    fn create_rejects_malformed_email() {
        let conn = test_conn();
        let err = create(
            &conn,
            SupplierInput {
                name: "Acme Flour Co".into(),
                contact_person: None,
                phone: None,
                email: Some("not-an-email".into()),
                address: None,
                vat_number: None,
                notes: None,
            },
        )
        .unwrap_err();
        assert_eq!(err.field.as_deref(), Some("email"));
    }

    #[test]
    fn create_list_update_round_trip() {
        let conn = test_conn();
        let created = create(
            &conn,
            SupplierInput {
                name: "Acme Flour Co".into(),
                contact_person: Some("Jane".into()),
                phone: None,
                email: Some("jane@acme.test".into()),
                address: None,
                vat_number: None,
                notes: None,
            },
        )
        .unwrap();
        assert_eq!(created.name, "Acme Flour Co");

        let updated = update(
            &conn,
            created.id,
            SupplierInput {
                name: "Acme Flour Company".into(),
                contact_person: Some("Jane".into()),
                phone: None,
                email: None,
                address: None,
                vat_number: None,
                notes: None,
            },
        )
        .unwrap();
        assert_eq!(updated.name, "Acme Flour Company");
        assert_eq!(updated.email, None);

        let all = list(&conn, false).unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn archiving_hides_from_default_listing_but_not_from_include_inactive() {
        let conn = test_conn();
        let created = create(
            &conn,
            SupplierInput {
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

        set_active(&conn, created.id, false).unwrap();

        assert_eq!(list(&conn, false).unwrap().len(), 0);
        assert_eq!(list(&conn, true).unwrap().len(), 1);
    }

    #[test]
    fn delete_is_rejected_when_referenced_by_a_raw_material() {
        let conn = test_conn();
        let supplier = create(
            &conn,
            SupplierInput {
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

        conn.execute(
            "INSERT INTO raw_materials (name, base_unit_code, default_supplier_id) VALUES ('Flour', 'g', ?1)",
            [supplier.id],
        )
        .unwrap();

        let err = delete(&conn, supplier.id).unwrap_err();
        assert!(err.message.contains("cannot be deleted"));
    }

    #[test]
    fn delete_succeeds_when_unreferenced() {
        let conn = test_conn();
        let supplier = create(
            &conn,
            SupplierInput {
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

        delete(&conn, supplier.id).unwrap();
        assert_eq!(list(&conn, true).unwrap().len(), 0);
    }
}
