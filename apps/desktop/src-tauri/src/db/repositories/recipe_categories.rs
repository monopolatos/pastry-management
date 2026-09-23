//! Recipe category repository: plain CRUD with soft-delete (archive) preferred over hard delete,
//! mirroring `db::repositories::categories` (raw material categories) exactly — see that module
//! and migration 0007 for the full rationale. Kept as a separate table/repository rather than
//! merged with raw material categories since the two are conceptually distinct groupings with
//! independent name spaces (see migration 0010).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct RecipeCategory {
    pub id: i64,
    pub name: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct RecipeCategoryInput {
    pub name: String,
}

fn validate(input: &RecipeCategoryInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::field("name", "Category name is required."));
    }
    Ok(())
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<RecipeCategory> {
    Ok(RecipeCategory {
        id: row.get(0)?,
        name: row.get(1)?,
        is_active: row.get::<_, i64>(2)? != 0,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

const SELECT_COLUMNS: &str = "id, name, is_active, created_at, updated_at";

pub fn list(conn: &Connection, include_inactive: bool) -> AppResult<Vec<RecipeCategory>> {
    let sql = if include_inactive {
        format!("SELECT {SELECT_COLUMNS} FROM recipe_categories ORDER BY name")
    } else {
        format!("SELECT {SELECT_COLUMNS} FROM recipe_categories WHERE is_active = 1 ORDER BY name")
    };
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<RecipeCategory> {
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM recipe_categories WHERE id = ?1"),
        [id],
        map_row,
    )
    .optional()?
    .ok_or_else(|| AppError::new(format!("Recipe category {id} was not found.")))
}

fn map_unique_violation(err: rusqlite::Error, name: &str) -> AppError {
    if let rusqlite::Error::SqliteFailure(e, _) = &err {
        if e.code == rusqlite::ErrorCode::ConstraintViolation {
            return AppError::field("name", format!("A category named '{name}' already exists."));
        }
    }
    AppError::from(err)
}

pub fn create(conn: &Connection, input: RecipeCategoryInput) -> AppResult<RecipeCategory> {
    validate(&input)?;
    let name = input.name.trim();
    conn.execute(
        "INSERT INTO recipe_categories (name) VALUES (?1)",
        params![name],
    )
    .map_err(|e| map_unique_violation(e, name))?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: RecipeCategoryInput) -> AppResult<RecipeCategory> {
    validate(&input)?;
    let name = input.name.trim();
    let affected = conn
        .execute(
            "UPDATE recipe_categories SET name = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?2",
            params![name, id],
        )
        .map_err(|e| map_unique_violation(e, name))?;
    if affected == 0 {
        return Err(AppError::new(format!("Recipe category {id} was not found.")));
    }
    get(conn, id)
}

pub fn set_active(conn: &Connection, id: i64, active: bool) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE recipe_categories SET is_active = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?2",
        params![active as i64, id],
    )?;
    if affected == 0 {
        return Err(AppError::new(format!("Recipe category {id} was not found.")));
    }
    Ok(())
}

/// Hard delete — only permitted when no recipe references this category. Callers should generally
/// prefer `set_active(id, false)` (archiving).
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let referenced: i64 = conn.query_row(
        "SELECT COUNT(*) FROM recipes WHERE category_id = ?1",
        [id],
        |row| row.get(0),
    )?;
    if referenced > 0 {
        return Err(AppError::new(
            "This category is used by one or more recipes and cannot be deleted. Archive it instead.",
        ));
    }
    let affected = conn.execute("DELETE FROM recipe_categories WHERE id = ?1", [id])?;
    if affected == 0 {
        return Err(AppError::new(format!("Recipe category {id} was not found.")));
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
        conn.execute_batch(include_str!("../../../migrations/0003_recipes.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../migrations/0007_categories.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../../migrations/0010_recipe_categories.sql"))
            .unwrap();
        conn
    }

    #[test]
    fn create_requires_a_name() {
        let conn = test_conn();
        let err = create(&conn, RecipeCategoryInput { name: "   ".into() }).unwrap_err();
        assert_eq!(err.field.as_deref(), Some("name"));
    }

    #[test]
    fn create_rejects_case_insensitive_duplicate() {
        let conn = test_conn();
        create(
            &conn,
            RecipeCategoryInput {
                name: "Cakes".into(),
            },
        )
        .unwrap();

        let err = create(
            &conn,
            RecipeCategoryInput {
                name: "cakes".into(),
            },
        )
        .unwrap_err();
        assert_eq!(err.field.as_deref(), Some("name"));
    }

    #[test]
    fn archiving_hides_from_default_listing_but_not_from_include_inactive() {
        let conn = test_conn();
        let created = create(
            &conn,
            RecipeCategoryInput {
                name: "Pastries".into(),
            },
        )
        .unwrap();

        set_active(&conn, created.id, false).unwrap();

        assert_eq!(list(&conn, false).unwrap().len(), 0);
        assert_eq!(list(&conn, true).unwrap().len(), 1);
    }

    #[test]
    fn delete_is_rejected_when_referenced_by_a_recipe() {
        let conn = test_conn();
        let category = create(
            &conn,
            RecipeCategoryInput {
                name: "Cakes".into(),
            },
        )
        .unwrap();

        conn.execute(
            "INSERT INTO recipes (name, category_id, current_version_id) VALUES ('Sponge Cake', ?1, NULL)",
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
            RecipeCategoryInput {
                name: "Cakes".into(),
            },
        )
        .unwrap();

        delete(&conn, category.id).unwrap();
        assert_eq!(list(&conn, true).unwrap().len(), 0);
    }
}
