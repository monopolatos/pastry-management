-- Migration 0006: automatic update settings (Phase 9).
--
-- A single row, following the same lazily-created-with-defaults pattern as backup_configs
-- (see src-tauri/src/db/repositories/backup_settings.rs). auto_check_enabled defaults on;
-- auto_download_enabled and auto_install_enabled default off, matching
-- docs/backup-and-updates.md §3's documented defaults. last_checked_at drives the "at most once
-- per launch, at most every 24h thereafter" throttle on the launch-time check.

CREATE TABLE update_settings (
    id                      INTEGER PRIMARY KEY,
    auto_check_enabled      INTEGER NOT NULL DEFAULT 1,
    auto_download_enabled   INTEGER NOT NULL DEFAULT 0,
    auto_install_enabled    INTEGER NOT NULL DEFAULT 0,
    last_checked_at         TEXT,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
