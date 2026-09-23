//! SQLite connection management and migration runner.
//!
//! This is the only module in the application allowed to open a connection to the database file.
//! The frontend never gets raw SQL access — it only ever calls typed Tauri commands defined in
//! `crate::commands`, which in turn call into repository functions that use this module's
//! connection. See docs/architecture.md and docs/database-schema.md for the rationale.

pub mod repositories;

use std::path::Path;

use rusqlite::Connection;
use thiserror::Error;

/// One migration file embedded at compile time, applied in ascending `version` order.
/// Each `(version, name, sql)` tuple corresponds to a file in `migrations/`.
const MIGRATIONS: &[(i64, &str, &str)] = &[
    (1, "init", include_str!("../../migrations/0001_init.sql")),
    (
        2,
        "core_data",
        include_str!("../../migrations/0002_core_data.sql"),
    ),
    (
        3,
        "recipes",
        include_str!("../../migrations/0003_recipes.sql"),
    ),
    (
        4,
        "backup_settings",
        include_str!("../../migrations/0004_backup_settings.sql"),
    ),
    (
        5,
        "dropbox_settings",
        include_str!("../../migrations/0005_dropbox_settings.sql"),
    ),
    (
        6,
        "update_settings",
        include_str!("../../migrations/0006_update_settings.sql"),
    ),
    (
        7,
        "categories",
        include_str!("../../migrations/0007_categories.sql"),
    ),
    (
        8,
        "recipe_portions",
        include_str!("../../migrations/0008_recipe_portions.sql"),
    ),
];

#[derive(Debug, Error)]
pub enum DbError {
    #[error("failed to open database at {path}: {source}")]
    Open {
        path: String,
        #[source]
        source: rusqlite::Error,
    },
    #[error("migration {version} ({name}) failed: {source}")]
    Migration {
        version: i64,
        name: String,
        #[source]
        source: rusqlite::Error,
    },
    #[error(
        "database schema version {db_version} is newer than this application understands \
         (highest known migration is {app_version}); refusing to start to avoid data corruption. \
         Update the application before opening this database."
    )]
    SchemaTooNew { db_version: i64, app_version: i64 },
}

/// The highest migration version this build of the app knows how to apply — used outside this
/// module (e.g. by the backup engine) to decide whether a given database/backup's schema is one
/// this app version can safely open.
pub fn max_known_migration_version() -> i64 {
    MIGRATIONS.iter().map(|(v, _, _)| *v).max().unwrap_or(0)
}

/// Opens (creating if necessary) the SQLite database at `path`, applies any pending migrations in
/// a transaction per migration, and refuses to proceed if the on-disk schema is newer than this
/// build knows about.
pub fn open_and_migrate(path: &Path) -> Result<Connection, DbError> {
    let conn = Connection::open(path).map_err(|source| DbError::Open {
        path: path.display().to_string(),
        source,
    })?;

    // WAL mode gives better concurrent-read behavior and is what the backup engine's checkpoint
    // step (docs/backup-and-updates.md) assumes is in use.
    conn.pragma_update(None, "journal_mode", "WAL").ok();
    conn.pragma_update(None, "foreign_keys", true).ok();

    ensure_migrations_table(&conn)?;
    check_not_ahead_of_app(&conn)?;
    apply_pending_migrations(&conn)?;

    Ok(conn)
}

fn ensure_migrations_table(conn: &Connection) -> Result<(), DbError> {
    let table_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .map_err(|source| DbError::Open {
            path: "<schema check>".to_string(),
            source,
        })?;

    // The very first migration creates schema_migrations itself, so on a brand-new database this
    // check is expected to report "doesn't exist yet" and fall through to apply_pending_migrations.
    let _ = table_exists;
    Ok(())
}

fn check_not_ahead_of_app(conn: &Connection) -> Result<(), DbError> {
    let table_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    if !table_exists {
        return Ok(());
    }

    let db_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let app_version = MIGRATIONS.iter().map(|(v, _, _)| *v).max().unwrap_or(0);

    if db_version > app_version {
        return Err(DbError::SchemaTooNew {
            db_version,
            app_version,
        });
    }

    Ok(())
}

fn apply_pending_migrations(conn: &Connection) -> Result<(), DbError> {
    let table_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    let applied_max: i64 = if table_exists {
        conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0)
    } else {
        0
    };

    for (version, name, sql) in MIGRATIONS {
        if *version <= applied_max {
            continue;
        }

        conn.execute_batch(&format!("BEGIN; {sql}\nCOMMIT;"))
            .map_err(|source| {
                // BEGIN without a matching COMMIT on failure could leave a transaction open;
                // rusqlite's execute_batch runs statements sequentially, so on error the connection's
                // implicit rollback-on-drop-of-uncommitted-transaction does not apply here — issue an
                // explicit rollback to guarantee the partially-applied migration is undone.
                let _ = conn.execute_batch("ROLLBACK;");
                DbError::Migration {
                    version: *version,
                    name: name.to_string(),
                    source,
                }
            })?;

        // The migration itself doesn't insert its own bookkeeping row (it may be creating the
        // schema_migrations table for the first time), so record it here, in the same logical
        // step, immediately after a successful apply.
        conn.execute(
            "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
            rusqlite::params![version, name],
        )
        .map_err(|source| DbError::Migration {
            version: *version,
            name: name.to_string(),
            source,
        })?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_db_path(name: &str) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "pastry_management_test_{name}_{}.sqlite",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);
        path
    }

    #[test]
    fn fresh_database_applies_all_migrations_and_seeds_units() {
        let path = temp_db_path("fresh");
        let conn = open_and_migrate(&path).expect("migration should succeed");

        let unit_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM measurement_units", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(unit_count, 5);

        let applied: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(applied, 8);

        drop(conn);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn reopening_an_up_to_date_database_is_a_no_op() {
        let path = temp_db_path("reopen");
        {
            let _conn = open_and_migrate(&path).expect("first open should succeed");
        }
        let conn =
            open_and_migrate(&path).expect("second open should also succeed, applying nothing new");

        let applied: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(applied, 8, "migrations should not be re-applied");

        drop(conn);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn refuses_to_open_a_database_from_a_newer_app_version() {
        let path = temp_db_path("too_new");
        {
            let conn = open_and_migrate(&path).expect("first open should succeed");
            conn.execute(
                "INSERT INTO schema_migrations (version, name) VALUES (999, 'from_the_future')",
                [],
            )
            .unwrap();
        }

        let result = open_and_migrate(&path);
        assert!(matches!(result, Err(DbError::SchemaTooNew { .. })));

        let _ = fs::remove_file(&path);
    }
}
