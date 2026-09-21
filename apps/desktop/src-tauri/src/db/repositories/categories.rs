//! Raw material category repository: plain CRUD with soft-delete (archive) preferred over hard
//! delete, per docs/database-schema.md's deletion policy — a category referenced by any raw
//! material can only be archived, never destroyed. `name` is `COLLATE NOCASE UNIQUE` (migration
//! 0007) so "Vegan" and "vegan" can't both exist.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CategoryInput {
    pub name: String,
}

fn validate(input: &CategoryInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::field("name", "Category name is required."));
    }
    Ok(())
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<Category> {
    Ok(Category {
        id: row.get(0)?,
        name: row.get(1)?,
        is_active: row.get::<_, i64>(2)? != 0,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

const SELECT_COLUMNS: &str = "id, name, is_active, created_at, updated_at";

pub fn list(conn: &Connection, include_inactive: bool) -> AppResult<Vec<Category>> {
    let sql = if include_inactive {
        format!("SELECT {SELECT_COLUMNS} FROM categories ORDER BY name")
    } else {
        format!("SELECT {SELECT_COLUMNS} FROM categories WHERE is_active = 1 ORDER BY name")
    };
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Category> {
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM categories WHERE id = ?1"),
        [id],
        map_row,
    )
    .optional()?
    .ok_or_else(|| AppError::new(format!("Category {id} was not found.")))
}

/// Looks up a category by name (case-insensitively, matching the column's own collation).
pub fn find_by_name(conn: &Connection, name: &str) -> AppResult<Option<Category>> {
    Ok(conn
        .query_row(
            &format!("SELECT {SELECT_COLUMNS} FROM categories WHERE name = ?1"),
            [name.trim()],
            map_row,
        )
        .optional()?)
}

fn map_unique_violation(err: rusqlite::Error, name: &str) -> AppError {
    if let rusqlite::Error::SqliteFailure(e, _) = &err {
        if e.code == rusqlite::ErrorCode::ConstraintViolation {
            return AppError::field("name", format!("A category named '{name}' already exists."));
        }
    }
    AppError::from(err)
}

pub fn create(conn: &Connection, input: CategoryInput) -> AppResult<Category> {
    validate(&input)?;
    let name = input.name.trim();
    conn.execute("INSERT INTO categories (name) VALUES (?1)", params![name])
        .map_err(|e| map_unique_violation(e, name))?;
    get(conn, conn.last_insert_rowid())
}

/// Creates the category if none exists with this name yet (case-insensitively), otherwise returns
/// the existing one unchanged. Used by the Excel import (`commands::import`) so re-running an
/// import is idempotent for categories rather than erroring on duplicates.
pub fn find_or_create(conn: &Connection, name: &str) -> AppResult<Category> {
    if let Some(existing) = find_by_name(conn, name)? {
        return Ok(existing);
    }
    create(
        conn,
        CategoryInput {
            name: name.to_string(),
        },
    )
}

pub fn update(conn: &Connection, id: i64, input: CategoryInput) -> AppResult<Category> {
    validate(&input)?;
    let name = input.name.trim();
    let affected = conn
        .execute(
            "UPDATE categories SET name = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?2",
            params![name, id],
        )
        .map_err(|e| map_unique_violation(e, name))?;
    if affected == 0 {
        return Err(AppError::new(format!("Category {id} was not found.")));
    }
    get(conn, id)
}

pub fn set_active(conn: &Connection, id: i64, active: bool) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE categories SET is_active = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?2",
        params![active as i64, id],
    )?;
    if affected == 0 {
        return Err(AppError::new(format!("Category {id} was not found.")));
    }
    Ok(())
}

/// Hard delete — only permitted when no raw material references this category. Callers should
/// generally prefer `set_active(id, false)` (archiving).
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let referenced: i64 = conn.query_row(
        "SELECT COUNT(*) FROM raw_materials WHERE category_id = ?1",
        [id],
        |row| row.get(0),
    )?;
    if referenced > 0 {
        return Err(AppError::new(
            "This category is used by one or more raw materials and cannot be deleted. Archive it instead.",
        ));
    }
    let affected = conn.execute("DELETE FROM categories WHERE id = ?1", [id])?;
    if affected == 0 {
        return Err(AppError::new(format!("Category {id} was not found.")));
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
        conn.execute_batch(include_str!("../../../migrations/0007_categories.sql"))
            .unwrap();
        conn
    }

    #[test]
    fn create_requires_a_name() {
        let conn = test_conn();
        let err = create(&conn, CategoryInput { name: "   ".into() }).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("name"));
    }

    #[test]
    fn create_rejects_case_insensitive_duplicate() {
        let conn = test_conn();
        create(
            &conn,
            CategoryInput {
                name: "Vegan".into(),
            },
        )
        .unwrap();

        let err = create(
            &conn,
            CategoryInput {
                name: "vegan".into(),
            },
        )
        .unwrap_err();
        assert_eq!(err.field.as_deref(), Some("name"));
    }

    #[test]
    fn find_or_create_is_idempotent_and_case_insensitive() {
        let conn = test_conn();
        let first = find_or_create(&conn, "Dairy").unwrap();
        let second = find_or_create(&conn, "dairy").unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(list(&conn, true).unwrap().len(), 1);
    }

    #[test]
    fn archiving_hides_from_default_listing_but_not_from_include_inactive() {
        let conn = test_conn();
        let created = create(
            &conn,
            CategoryInput {
                name: "Dry Goods".into(),
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
        let category = create(
            &conn,
            CategoryInput {
                name: "Dry Goods".into(),
            },
        )
        .unwrap();

        conn.execute(
            "INSERT INTO raw_materials (name, base_unit_code, category_id) VALUES ('Flour', 'g', ?1)",
            [category.id],
        )
        .unwrap();

        let err = delete(&conn, category.id).unwrap_err();
        assert!(err.message.contains("cannot be deleted"));
    }

    #[test]
    fn delete_succeeds_when_unreferenced() {
        let conn = test_conn();
        let category = create(
            &conn,
            CategoryInput {
                name: "Dry Goods".into(),
            },
        )
        .unwrap();

        delete(&conn, category.id).unwrap();
        assert_eq!(list(&conn, true).unwrap().len(), 0);
    }
}
