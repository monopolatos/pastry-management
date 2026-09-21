//! Local backup configuration — a single `destination_type = 'local'` row, created lazily with
//! sensible defaults on first access. See migration 0004 and docs/backup-and-updates.md.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct BackupSettings {
    pub id: i64,
    pub local_path: String,
    pub auto_backup_enabled: bool,
    pub auto_backup_frequency: Option<String>,
    pub retention_count: i64,
    pub last_auto_backup_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BackupSettingsInput {
    pub local_path: Option<String>,
    pub auto_backup_enabled: bool,
    pub auto_backup_frequency: Option<String>,
    pub retention_count: i64,
}

fn validate(input: &BackupSettingsInput) -> AppResult<()> {
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

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<BackupSettings> {
    Ok(BackupSettings {
        id: row.get(0)?,
        local_path: row.get(1)?,
        auto_backup_enabled: row.get::<_, i64>(2)? != 0,
        auto_backup_frequency: row.get(3)?,
        retention_count: row.get(4)?,
        last_auto_backup_at: row.get(5)?,
    })
}

const SELECT_COLUMNS: &str =
    "id, local_path, auto_backup_enabled, auto_backup_frequency, retention_count, last_auto_backup_at";

/// Returns the single local backup settings row, creating it with `default_local_path` if it
/// doesn't exist yet. Safe to call on every command that needs settings — it's idempotent.
pub fn get_or_create_default(
    conn: &Connection,
    default_local_path: &Path,
) -> AppResult<BackupSettings> {
    let existing = conn
        .query_row(
            &format!("SELECT {SELECT_COLUMNS} FROM backup_configs WHERE destination_type = 'local' LIMIT 1"),
            [],
            map_row,
        )
        .optional()?;

    if let Some(settings) = existing {
        return Ok(settings);
    }

    conn.execute(
        "INSERT INTO backup_configs (destination_type, local_path, auto_backup_enabled, retention_count)
         VALUES ('local', ?1, 0, 10)",
        params![default_local_path.to_string_lossy()],
    )?;

    let id = conn.last_insert_rowid();
    Ok(conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM backup_configs WHERE id = ?1"),
        [id],
        map_row,
    )?)
}

pub fn update(
    conn: &Connection,
    default_local_path: &Path,
    input: BackupSettingsInput,
) -> AppResult<BackupSettings> {
    validate(&input)?;
    let current = get_or_create_default(conn, default_local_path)?;
    let local_path = input.local_path.unwrap_or(current.local_path);

    conn.execute(
        "UPDATE backup_configs
         SET local_path = ?1, auto_backup_enabled = ?2, auto_backup_frequency = ?3, retention_count = ?4,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?5",
        params![
            local_path,
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

/// Records that an automatic backup just ran, so the next app-launch check knows one isn't due
/// again until `auto_backup_frequency` has elapsed.
pub fn mark_auto_backup_run(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE backup_configs SET last_auto_backup_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

/// Whether an automatic backup is due right now, per `auto_backup_enabled`/`auto_backup_frequency`
/// and how long it's been since `last_auto_backup_at`. Checked once at app launch (see lib.rs) —
/// there is no persistent background timer; a backup fires at most once per launch, only if one
/// is actually overdue, keeping this simple and never surprising the user mid-session.
pub fn is_auto_backup_due(settings: &BackupSettings) -> bool {
    if !settings.auto_backup_enabled {
        return false;
    }
    let Some(last) = &settings.last_auto_backup_at else {
        return true; // never run before
    };
    let Ok(last_at) = chrono::DateTime::parse_from_rfc3339(last) else {
        return true; // unparseable timestamp — treat as "due" rather than silently never backing up
    };

    let interval = match settings.auto_backup_frequency.as_deref() {
        Some("daily") => chrono::Duration::days(1),
        Some("weekly") => chrono::Duration::days(7),
        _ => return false, // enabled but no frequency configured — nothing to compare against
    };

    chrono::Utc::now().signed_duration_since(last_at) >= interval
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

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
        conn
    }

    #[test]
    fn creates_default_settings_on_first_access() {
        let conn = test_conn();
        let default_path = PathBuf::from("/tmp/backups-default");
        let settings = get_or_create_default(&conn, &default_path).unwrap();
        assert_eq!(settings.local_path, "/tmp/backups-default");
        assert_eq!(settings.retention_count, 10);
        assert!(!settings.auto_backup_enabled);
    }

    #[test]
    fn second_access_returns_the_same_row_not_a_new_one() {
        let conn = test_conn();
        let default_path = PathBuf::from("/tmp/backups-default");
        let first = get_or_create_default(&conn, &default_path).unwrap();
        let second = get_or_create_default(&conn, &default_path).unwrap();
        assert_eq!(first.id, second.id);
    }

    #[test]
    fn update_persists_changes() {
        let conn = test_conn();
        let default_path = PathBuf::from("/tmp/backups-default");
        get_or_create_default(&conn, &default_path).unwrap();

        let updated = update(
            &conn,
            &default_path,
            BackupSettingsInput {
                local_path: Some("/tmp/custom-backups".into()),
                auto_backup_enabled: true,
                auto_backup_frequency: Some("daily".into()),
                retention_count: 5,
            },
        )
        .unwrap();

        assert_eq!(updated.local_path, "/tmp/custom-backups");
        assert!(updated.auto_backup_enabled);
        assert_eq!(updated.auto_backup_frequency.as_deref(), Some("daily"));
        assert_eq!(updated.retention_count, 5);
    }

    #[test]
    fn rejects_zero_retention_count() {
        let conn = test_conn();
        let default_path = PathBuf::from("/tmp/backups-default");
        let err = update(
            &conn,
            &default_path,
            BackupSettingsInput {
                local_path: None,
                auto_backup_enabled: false,
                auto_backup_frequency: None,
                retention_count: 0,
            },
        )
        .unwrap_err();
        assert_eq!(err.field.as_deref(), Some("retention_count"));
    }

    #[test]
    fn rejects_invalid_frequency() {
        let conn = test_conn();
        let default_path = PathBuf::from("/tmp/backups-default");
        let err = update(
            &conn,
            &default_path,
            BackupSettingsInput {
                local_path: None,
                auto_backup_enabled: true,
                auto_backup_frequency: Some("hourly".into()),
                retention_count: 5,
            },
        )
        .unwrap_err();
        assert_eq!(err.field.as_deref(), Some("auto_backup_frequency"));
    }

    fn settings_with(
        auto_backup_enabled: bool,
        auto_backup_frequency: Option<&str>,
        last_auto_backup_at: Option<String>,
    ) -> BackupSettings {
        BackupSettings {
            id: 1,
            local_path: "/tmp/backups".into(),
            auto_backup_enabled,
            auto_backup_frequency: auto_backup_frequency.map(String::from),
            retention_count: 10,
            last_auto_backup_at,
        }
    }

    #[test]
    fn auto_backup_not_due_when_disabled() {
        let settings = settings_with(false, Some("daily"), None);
        assert!(!is_auto_backup_due(&settings));
    }

    #[test]
    fn auto_backup_due_when_enabled_and_never_run() {
        let settings = settings_with(true, Some("daily"), None);
        assert!(is_auto_backup_due(&settings));
    }

    #[test]
    fn auto_backup_not_due_when_run_recently() {
        let settings = settings_with(true, Some("daily"), Some(chrono::Utc::now().to_rfc3339()));
        assert!(!is_auto_backup_due(&settings));
    }

    #[test]
    fn auto_backup_due_when_daily_interval_elapsed() {
        let two_days_ago = chrono::Utc::now() - chrono::Duration::days(2);
        let settings = settings_with(true, Some("daily"), Some(two_days_ago.to_rfc3339()));
        assert!(is_auto_backup_due(&settings));
    }

    #[test]
    fn auto_backup_not_due_when_weekly_interval_has_not_elapsed() {
        let two_days_ago = chrono::Utc::now() - chrono::Duration::days(2);
        let settings = settings_with(true, Some("weekly"), Some(two_days_ago.to_rfc3339()));
        assert!(!is_auto_backup_due(&settings));
    }
}
