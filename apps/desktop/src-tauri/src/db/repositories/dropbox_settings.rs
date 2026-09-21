//! Dropbox cloud backup configuration — a single `destination_type = 'dropbox'` row, created
//! lazily on first access, mirroring `backup_settings` (local) but for Dropbox-specific fields.
//! The refresh token is never stored here — see migration 0005 and docs/backup-and-updates.md.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct DropboxSettings {
    pub id: i64,
    pub app_key: Option<String>,
    pub cloud_account_label: Option<String>,
    pub auto_backup_enabled: bool,
    pub auto_backup_frequency: Option<String>,
    pub retention_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct DropboxSettingsInput {
    pub app_key: Option<String>,
    pub auto_backup_enabled: bool,
    pub auto_backup_frequency: Option<String>,
    pub retention_count: i64,
}

fn validate(input: &DropboxSettingsInput) -> AppResult<()> {
    if input.retention_count <= 0 {
        return Err(AppError::field(
            "retention_count",
            "Retention count must be at least 1.",
        ));
    }
    if let Some(freq) = &input.auto_backup_frequency {
        if freq != "daily" && freq != "weekly" {
            return Err(AppError::field(
                "auto_backup_frequency",
                "Frequency must be 'daily' or 'weekly'.",
            ));
        }
    }
    Ok(())
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<DropboxSettings> {
    Ok(DropboxSettings {
        id: row.get(0)?,
        app_key: row.get(1)?,
        cloud_account_label: row.get(2)?,
        auto_backup_enabled: row.get::<_, i64>(3)? != 0,
        auto_backup_frequency: row.get(4)?,
        retention_count: row.get(5)?,
    })
}

const SELECT_COLUMNS: &str =
    "id, dropbox_app_key, cloud_account_label, auto_backup_enabled, auto_backup_frequency, retention_count";

/// Returns the single Dropbox settings row, creating an empty one (no app key configured yet, no
/// account connected) if it doesn't exist. Safe to call on every command that needs settings.
pub fn get_or_create_default(conn: &Connection) -> AppResult<DropboxSettings> {
    let existing = conn
        .query_row(
            &format!("SELECT {SELECT_COLUMNS} FROM backup_configs WHERE destination_type = 'dropbox' LIMIT 1"),
            [],
            map_row,
        )
        .optional()?;

    if let Some(settings) = existing {
        return Ok(settings);
    }

    conn.execute(
        "INSERT INTO backup_configs (destination_type, auto_backup_enabled, retention_count) VALUES ('dropbox', 0, 10)",
        [],
    )?;

    let id = conn.last_insert_rowid();
    Ok(conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM backup_configs WHERE id = ?1"),
        [id],
        map_row,
    )?)
}

pub fn update(conn: &Connection, input: DropboxSettingsInput) -> AppResult<DropboxSettings> {
    validate(&input)?;
    let current = get_or_create_default(conn)?;
    let app_key = input.app_key.or(current.app_key);

    conn.execute(
        "UPDATE backup_configs
         SET dropbox_app_key = ?1, auto_backup_enabled = ?2, auto_backup_frequency = ?3, retention_count = ?4,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?5",
        params![
            app_key,
            input.auto_backup_enabled as i64,
            input.auto_backup_frequency,
            input.retention_count,
            current.id,
        ],
    )?;

    Ok(conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM backup_configs WHERE id = ?1"),
        [current.id],
        map_row,
    )?)
}

/// Records the connected account's display email (or clears it, on disconnect, with `None`).
pub fn set_account_label(conn: &Connection, label: Option<&str>) -> AppResult<()> {
    let current = get_or_create_default(conn)?;
    conn.execute(
        "UPDATE backup_configs SET cloud_account_label = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?2",
        params![label, current.id],
    )?;
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
        conn.execute_batch(include_str!("../../../migrations/0004_backup_settings.sql"))
            .unwrap();
        conn.execute_batch(include_str!(
            "../../../migrations/0005_dropbox_settings.sql"
        ))
        .unwrap();
        conn
    }

    #[test]
    fn creates_default_settings_with_no_app_key() {
        let conn = test_conn();
        let settings = get_or_create_default(&conn).unwrap();
        assert_eq!(settings.app_key, None);
        assert_eq!(settings.cloud_account_label, None);
        assert!(!settings.auto_backup_enabled);
    }

    #[test]
    fn update_sets_the_app_key() {
        let conn = test_conn();
        get_or_create_default(&conn).unwrap();

        let updated = update(
            &conn,
            DropboxSettingsInput {
                app_key: Some("test-app-key".into()),
                auto_backup_enabled: false,
                auto_backup_frequency: None,
                retention_count: 5,
            },
        )
        .unwrap();

        assert_eq!(updated.app_key.as_deref(), Some("test-app-key"));
    }

    #[test]
    fn update_with_no_app_key_preserves_the_existing_one() {
        let conn = test_conn();
        update(
            &conn,
            DropboxSettingsInput {
                app_key: Some("test-app-key".into()),
                auto_backup_enabled: false,
                auto_backup_frequency: None,
                retention_count: 5,
            },
        )
        .unwrap();

        let updated = update(
            &conn,
            DropboxSettingsInput {
                app_key: None,
                auto_backup_enabled: true,
                auto_backup_frequency: Some("weekly".into()),
                retention_count: 3,
            },
        )
        .unwrap();

        assert_eq!(updated.app_key.as_deref(), Some("test-app-key"));
        assert!(updated.auto_backup_enabled);
    }

    #[test]
    fn set_account_label_persists_and_clears() {
        let conn = test_conn();
        get_or_create_default(&conn).unwrap();

        set_account_label(&conn, Some("baker@example.com")).unwrap();
        assert_eq!(
            get_or_create_default(&conn)
                .unwrap()
                .cloud_account_label
                .as_deref(),
            Some("baker@example.com")
        );

        set_account_label(&conn, None).unwrap();
        assert_eq!(
            get_or_create_default(&conn).unwrap().cloud_account_label,
            None
        );
    }

    #[test]
    fn rejects_zero_retention_count() {
        let conn = test_conn();
        let err = update(
            &conn,
            DropboxSettingsInput {
                app_key: None,
                auto_backup_enabled: false,
                auto_backup_frequency: None,
                retention_count: 0,
            },
        )
        .unwrap_err();
        assert_eq!(err.field.as_deref(), Some("retention_count"));
    }
}
