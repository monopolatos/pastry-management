-- Migration 0005: Dropbox cloud backup settings (Phase 7).
--
-- A second backup_configs row, destination_type = 'dropbox', mirroring the 'local' row's
-- auto-backup/retention columns but with Dropbox-specific fields instead of local_path. The
-- refresh token itself is NEVER stored here (or anywhere in this database) — it lives only in the
-- OS keyring, per docs/backup-and-updates.md and docs/architecture.md's security section.

ALTER TABLE backup_configs ADD COLUMN dropbox_app_key TEXT;
