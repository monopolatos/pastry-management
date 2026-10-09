//! Expense entry repository — a plain ledger, not append-only like `purchase_records`: a
//! mistyped amount or wrong date on a manually-logged expense is a data-entry slip to fix in
//! place or remove, not a historical fact worth preserving forever. See migration 0011.
//!
//! No monthly/yearly aggregation here — `list` returns every expense and the frontend groups by
//! month/year and computes totals client-side, the same division of labor the costing engine
//! already uses (Rust stores/retrieves, TypeScript does the math) — see packages/core.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct Expense {
    pub id: i64,
    pub expense_date: String,
    pub category_id: Option<i64>,
    /// Denormalized for display convenience — the category's current name.
    pub category_name: Option<String>,
    pub amount_micros: i64,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct ExpenseInput {
    pub expense_date: String,
    pub category_id: Option<i64>,
    pub amount_micros: i64,
    pub description: Option<String>,
}

fn validate(conn: &Connection, input: &ExpenseInput) -> AppResult<()> {
    if input.expense_date.trim().is_empty() {
        return Err(AppError::field("expense_date", "Date is required."));
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
                "SELECT COUNT(*) FROM expense_categories WHERE id = ?1",
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

const SELECT_COLUMNS: &str = "e.id, e.expense_date, e.category_id, c.name, e.amount_micros, e.description, e.created_at, e.updated_at";

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<Expense> {
    Ok(Expense {
        id: row.get(0)?,
        expense_date: row.get(1)?,
        category_id: row.get(2)?,
        category_name: row.get(3)?,
        amount_micros: row.get(4)?,
        description: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Expense>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLUMNS} FROM expenses e
         LEFT JOIN expense_categories c ON c.id = e.category_id
         ORDER BY e.expense_date DESC, e.id DESC"
    ))?;
    let rows = stmt.query_map([], map_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Expense> {
    conn.query_row(
        &format!(
            "SELECT {SELECT_COLUMNS} FROM expenses e
             LEFT JOIN expense_categories c ON c.id = e.category_id
             WHERE e.id = ?1"
        ),
        [id],
        map_row,
    )
    .optional()?
    .ok_or_else(|| AppError::new(format!("Expense {id} was not found.")))
}

pub fn create(
    conn: &Connection,
    input: ExpenseInput,
    created_by_user_id: Option<i64>,
) -> AppResult<Expense> {
    validate(conn, &input)?;
    conn.execute(
        "INSERT INTO expenses (expense_date, category_id, amount_micros, description, created_by_user_id)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            input.expense_date,
            input.category_id,
            input.amount_micros,
            input.description,
            created_by_user_id,
        ],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: ExpenseInput) -> AppResult<Expense> {
    validate(conn, &input)?;
    let affected = conn.execute(
        "UPDATE expenses
         SET expense_date = ?1, category_id = ?2, amount_micros = ?3, description = ?4,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?5",
        params![
            input.expense_date,
            input.category_id,
            input.amount_micros,
            input.description,
            id,
        ],
    )?;
    if affected == 0 {
        return Err(AppError::new(format!("Expense {id} was not found.")));
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let affected = conn.execute("DELETE FROM expenses WHERE id = ?1", [id])?;
    if affected == 0 {
        return Err(AppError::new(format!("Expense {id} was not found.")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repositories::expense_categories::{self, ExpenseCategoryInput};

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

    fn simple_input(category_id: Option<i64>) -> ExpenseInput {
        ExpenseInput {
            expense_date: "2026-01-15".into(),
            category_id,
            amount_micros: 50_000_000,
            description: Some("January rent".into()),
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
        let category = expense_categories::create(
            &conn,
            ExpenseCategoryInput {
                name: "Rent".into(),
            },
        )
        .unwrap();

        let created = create(&conn, simple_input(Some(category.id)), None).unwrap();
        assert_eq!(created.category_name.as_deref(), Some("Rent"));
        assert_eq!(created.amount_micros, 50_000_000);

        let fetched = get(&conn, created.id).unwrap();
        assert_eq!(fetched.id, created.id);
    }

    #[test]
    fn update_changes_fields_in_place() {
        let conn = test_conn();
        let created = create(&conn, simple_input(None), None).unwrap();

        let mut updated_input = simple_input(None);
        updated_input.amount_micros = 75_000_000;
        updated_input.description = Some("Revised".into());
        let updated = update(&conn, created.id, updated_input).unwrap();

        assert_eq!(updated.amount_micros, 75_000_000);
        assert_eq!(updated.description.as_deref(), Some("Revised"));

        // No new row was created — still exactly one expense.
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn delete_removes_the_row() {
        let conn = test_conn();
        let created = create(&conn, simple_input(None), None).unwrap();
        delete(&conn, created.id).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 0);
    }

    #[test]
    fn list_orders_most_recent_first() {
        let conn = test_conn();
        let mut older = simple_input(None);
        older.expense_date = "2026-01-01".into();
        create(&conn, older, None).unwrap();

        let mut newer = simple_input(None);
        newer.expense_date = "2026-02-01".into();
        create(&conn, newer, None).unwrap();

        let all = list(&conn).unwrap();
        assert_eq!(all[0].expense_date, "2026-02-01");
        assert_eq!(all[1].expense_date, "2026-01-01");
    }
}
