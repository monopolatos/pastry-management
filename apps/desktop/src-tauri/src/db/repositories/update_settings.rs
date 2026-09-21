//! Automatic update settings — a single row, created lazily with sensible defaults on first
//! access. See migration 0006 and docs/backup-and-updates.md §3.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
pub struct UpdateSettings {
    pub id: i64,
    pub auto_check_enabled: bool,
    pub auto_download_enabled: bool,
    pub auto_install_enabled: bool,
    pub last_checked_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSettingsInput {
    pub auto_check_enabled: bool,
    pub auto_download_enabled: bool,
    pub auto_install_enabled: bool,
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<UpdateSettings> {
    Ok(UpdateSettings {
        id: row.get(0)?,
        auto_check_enabled: row.get::<_, i64>(1)? != 0,
        auto_download_enabled: row.get::<_, i64>(2)? != 0,
        auto_install_enabled: row.get::<_, i64>(3)? != 0,
        last_checked_at: row.get(4)?,
    })
}

const SELECT_COLUMNS: &str =
    "id, auto_check_enabled, auto_download_enabled, auto_install_enabled, last_checked_at";

/// Returns the single update settings row, creating it with the documented defaults (auto-check
/// on, auto-download/auto-install off) if it doesn't exist yet. Safe to call on every command
/// that needs settings — it's idempotent.
pub fn get_or_create_default(conn: &Connection) -> AppResult<UpdateSettings> {
    let existing = conn
        .query_row(
            &format!("SELECT {SELECT_COLUMNS} FROM update_settings LIMIT 1"),
            [],
            map_row,
        )
        .optional()?;

    if let Some(settings) = existing {
        return Ok(settings);
    }

    conn.execute(
        "INSERT INTO update_settings (auto_check_enabled, auto_download_enabled, auto_install_enabled)
         VALUES (1, 0, 0)",
        [],
    )?;

    let id = conn.last_insert_rowid();
    Ok(conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM update_settings WHERE id = ?1"),
        [id],
        map_row,
    )?)
}

pub fn update(conn: &Connection, input: UpdateSettingsInput) -> AppResult<UpdateSettings> {
    let current = get_or_create_default(conn)?;

    conn.execute(
        "UPDATE update_settings
         SET auto_check_enabled = ?1, auto_download_enabled = ?2, auto_install_enabled = ?3,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?4",
        params![
            input.auto_check_enabled as i64,
            input.auto_download_enabled as i64,
            input.auto_install_enabled as i64,
            current.id,
        ],
    )?;

    Ok(conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM update_settings WHERE id = ?1"),
        [current.id],
        map_row,
    )?)
}

/// Records that an update check just ran, so the next app-launch check knows one isn't due again
/// until 24h have elapsed (see `is_check_due`).
pub fn mark_checked_now(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE update_settings SET last_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

/// Whether a launch-time check is due right now, per `auto_check_enabled` and how long it's been
/// since `last_checked_at`. Checked once at app launch (see lib.rs) — at most once per launch, and
/// at most every 24h thereafter, never on every window focus, per docs/backup-and-updates.md §3.
pub fn is_check_due(settings: &UpdateSettings) -> bool {
    if !settings.auto_check_enabled {
        return false;
    }
    let Some(last) = &settings.last_checked_at else {
        return true; // never checked before
    };
    let Ok(last_at) = chrono::DateTime::parse_from_rfc3339(last) else {
        return true; // unparseable timestamp — treat as "due" rather than silently never checking
    };

    chrono::Utc::now().signed_duration_since(last_at) >= chrono::Duration::hours(24)
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
        conn.execute_batch(include_str!("../../../migrations/0006_update_settings.sql"))
            .unwrap();
        conn
    }

    #[test]
    fn creates_default_settings_on_first_access() {
        let conn = test_conn();
        let settings = get_or_create_default(&conn).unwrap();
        assert!(settings.auto_check_enabled);
        assert!(!settings.auto_download_enabled);
        assert!(!settings.auto_install_enabled);
        assert!(settings.last_checked_at.is_none());
    }

    #[test]
    fn second_access_returns_the_same_row_not_a_new_one() {
        let conn = test_conn();
        let first = get_or_create_default(&conn).unwrap();
        let second = get_or_create_default(&conn).unwrap();
        assert_eq!(first.id, second.id);
    }

    #[test]
    fn update_persists_changes() {
        let conn = test_conn();
        get_or_create_default(&conn).unwrap();

        let updated = update(
            &conn,
            UpdateSettingsInput {
                auto_check_enabled: false,
                auto_download_enabled: true,
                auto_install_enabled: true,
            },
        )
        .unwrap();

        assert!(!updated.auto_check_enabled);
        assert!(updated.auto_download_enabled);
        assert!(updated.auto_install_enabled);
    }

    #[test]
    fn mark_checked_now_sets_last_checked_at() {
        let conn = test_conn();
        let settings = get_or_create_default(&conn).unwrap();
        assert!(settings.last_checked_at.is_none());

        mark_checked_now(&conn, settings.id).unwrap();
        let refreshed = get_or_create_default(&conn).unwrap();
        assert!(refreshed.last_checked_at.is_some());
    }

    #[test]
    fn check_not_due_when_auto_check_disabled() {
        let settings = UpdateSettings {
            id: 1,
            auto_check_enabled: false,
            auto_download_enabled: false,
            auto_install_enabled: false,
            last_checked_at: None,
        };
        assert!(!is_check_due(&settings));
    }

    #[test]
    fn check_due_when_enabled_and_never_checked() {
        let settings = UpdateSettings {
            id: 1,
            auto_check_enabled: true,
            auto_download_enabled: false,
            auto_install_enabled: false,
            last_checked_at: None,
        };
        assert!(is_check_due(&settings));
    }

    #[test]
    fn check_not_due_when_checked_recently() {
        let settings = UpdateSettings {
            id: 1,
            auto_check_enabled: true,
            auto_download_enabled: false,
            auto_install_enabled: false,
            last_checked_at: Some(chrono::Utc::now().to_rfc3339()),
        };
        assert!(!is_check_due(&settings));
    }

    #[test]
    fn check_due_when_more_than_24h_elapsed() {
        let two_days_ago = chrono::Utc::now() - chrono::Duration::days(2);
        let settings = UpdateSettings {
            id: 1,
            auto_check_enabled: true,
            auto_download_enabled: false,
            auto_install_enabled: false,
            last_checked_at: Some(two_days_ago.to_rfc3339()),
        };
        assert!(is_check_due(&settings));
    }
}
