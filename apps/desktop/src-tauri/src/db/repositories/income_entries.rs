//! Income entry repository — mirrors `db::repositories::expenses` exactly, see that module's doc
//! comment for the rationale (a plain, editable ledger, not append-only; aggregation lives in the
//! frontend, not here). See migration 0011.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct IncomeEntry {
    pub id: i64,
    pub income_date: String,
    pub category_id: Option<i64>,
    /// Denormalized for display convenience — the category's current name.
    pub category_name: Option<String>,
    pub amount_micros: i64,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct IncomeEntryInput {
    pub income_date: String,
    pub category_id: Option<i64>,
    pub amount_micros: i64,
    pub description: Option<String>,
}

fn validate(conn: &Connection, input: &IncomeEntryInput) -> AppResult<()> {
    if input.income_date.trim().is_empty() {
        return Err(AppError::field("income_date", "Date is required."));
    }
    if input.amount_micros <= 0 {
        return Err(AppError::field(
            "amount_micros",
            "Amount must be greater than zero.",
        ));
    }
    if let Some(id) = input.category_id {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM income_categories WHERE id = ?1",
                [id],
                |r| r.get::<_, i64>(0),
            )
            .map(|c| c > 0)?;
        if !exists {
            return Err(AppError::field(
                "category_id",
                "Selected category does not exist.",
            ));
        }
    }
    Ok(())
}

const SELECT_COLUMNS: &str = "e.id, e.income_date, e.category_id, c.name, e.amount_micros, e.description, e.created_at, e.updated_at";

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<IncomeEntry> {
    Ok(IncomeEntry {
        id: row.get(0)?,
        income_date: row.get(1)?,
        category_id: row.get(2)?,
        category_name: row.get(3)?,
        amount_micros: row.get(4)?,
        description: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<IncomeEntry>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLUMNS} FROM income_entries e
         LEFT JOIN income_categories c ON c.id = e.category_id
         ORDER BY e.income_date DESC, e.id DESC"
    ))?;
    let rows = stmt.query_map([], map_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<IncomeEntry> {
    conn.query_row(
        &format!(
            "SELECT {SELECT_COLUMNS} FROM income_entries e
             LEFT JOIN income_categories c ON c.id = e.category_id
             WHERE e.id = ?1"
        ),
        [id],
        map_row,
    )
    .optional()?
    .ok_or_else(|| AppError::new(format!("Income entry {id} was not found.")))
}

pub fn create(
    conn: &Connection,
    input: IncomeEntryInput,
    created_by_user_id: Option<i64>,
) -> AppResult<IncomeEntry> {
    validate(conn, &input)?;
    conn.execute(
        "INSERT INTO income_entries (income_date, category_id, amount_micros, description, created_by_user_id)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            input.income_date,
            input.category_id,
            input.amount_micros,
            input.description,
            created_by_user_id,
        ],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: IncomeEntryInput) -> AppResult<IncomeEntry> {
    validate(conn, &input)?;
    let affected = conn.execute(
        "UPDATE income_entries
         SET income_date = ?1, category_id = ?2, amount_micros = ?3, description = ?4,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?5",
        params![
            input.income_date,
            input.category_id,
            input.amount_micros,
            input.description,
            id,
        ],
    )?;
    if affected == 0 {
        return Err(AppError::new(format!("Income entry {id} was not found.")));
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let affected = conn.execute("DELETE FROM income_entries WHERE id = ?1", [id])?;
    if affected == 0 {
        return Err(AppError::new(format!("Income entry {id} was not found.")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repositories::income_categories::{self, IncomeCategoryInput};

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../../migrations/0001_init.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../migrations/0002_core_data.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../migrations/0011_finance.sql"))
            .unwrap();
        conn
    }

    fn simple_input(category_id: Option<i64>) -> IncomeEntryInput {
        IncomeEntryInput {
            income_date: "2026-01-15".into(),
            category_id,
            amount_micros: 200_000_000,
            description: Some("Wedding cake order".into()),
        }
    }

    #[test]
    fn create_rejects_zero_amount() {
        let conn = test_conn();
        let mut input = simple_input(None);
        input.amount_micros = 0;
        let err = create(&conn, input, None).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("amount_micros"));
    }

    #[test]
    fn create_rejects_unknown_category() {
        let conn = test_conn();
        let err = create(&conn, simple_input(Some(999)), None).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("category_id"));
    }

    #[test]
    fn create_and_get_round_trip_resolves_category_name() {
        let conn = test_conn();
        let category = income_categories::create(
            &conn,
            IncomeCategoryInput {
                name: "Sales".into(),
            },
        )
        .unwrap();

        let created = create(&conn, simple_input(Some(category.id)), None).unwrap();
        assert_eq!(created.category_name.as_deref(), Some("Sales"));
        assert_eq!(created.amount_micros, 200_000_000);

        let fetched = get(&conn, created.id).unwrap();
        assert_eq!(fetched.id, created.id);
    }

    #[test]
    fn update_changes_fields_in_place() {
        let conn = test_conn();
        let created = create(&conn, simple_input(None), None).unwrap();

        let mut updated_input = simple_input(None);
        updated_input.amount_micros = 150_000_000;
        let updated = update(&conn, created.id, updated_input).unwrap();

        assert_eq!(updated.amount_micros, 150_000_000);
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn delete_removes_the_row() {
        let conn = test_conn();
        let created = create(&conn, simple_input(None), None).unwrap();
        delete(&conn, created.id).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 0);
    }
}
