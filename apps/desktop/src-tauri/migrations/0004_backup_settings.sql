-- Migration 0004: local backup configuration (Phase 6).
--
-- A single active row represents "the current backup destination and preferences" — this table
-- is designed to eventually hold one row per destination (see docs/database-schema.md's
-- destination_type covering 'local' | 'dropbox' | 'google_drive' for Phase 7), but Phase 6 only
-- ever creates/uses a single 'local' row, resolved lazily with sensible defaults on first access
-- (see src-tauri/src/backup/mod.rs).

CREATE TABLE backup_configs (
    id                      INTEGER PRIMARY KEY,
    destination_type        TEXT NOT NULL DEFAULT 'local' CHECK (destination_type IN ('local', 'dropbox', 'google_drive')),
    local_path               TEXT,
    cloud_account_label      TEXT,
    auto_backup_enabled      INTEGER NOT NULL DEFAULT 0,
    auto_backup_frequency    TEXT CHECK (auto_backup_frequency IS NULL OR auto_backup_frequency IN ('daily', 'weekly')),
    retention_count          INTEGER NOT NULL DEFAULT 10 CHECK (retention_count > 0),
    -- When the last automatic (not manual) backup ran, so the app-launch check in lib.rs knows
    -- whether one is due per auto_backup_frequency.
    last_auto_backup_at      TEXT,
    created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
