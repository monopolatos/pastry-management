# Backup, Restore, Cloud Storage & Auto-Update Strategy

Local backup (§1) was a Phase 1 design, **implemented in Phase 6** (`apps/desktop/src-tauri/src/backup/mod.rs`, `db/repositories/backup_settings.rs`, `commands/backup.rs`) — 66 passing Rust tests including an exact "create → mutate → restore → assert identical" round-trip. See §1a for where the implementation differs from or refines this original sketch. Cloud backup (§2) and auto-updates (§3) remain Phase 1 designs, not yet implemented (Phases 7 and 9 respectively).

## 1. Local Backup

**Contents of a backup archive** (`backup-YYYY-MM-DD-HHmmss.zip`):

- The SQLite database file (checkpointed via `PRAGMA wal_checkpoint(TRUNCATE)` first, so the zip contains a consistent snapshot, not a mid-write WAL state).
- `app_settings` is already inside the DB, so it's included automatically.
- `manifest.json`: app version, schema version, checksum (SHA-256) of the DB file, creation timestamp, and a manifest schema version of its own.
- **Explicitly excluded:** OS-keyring-stored cloud OAuth tokens and the session token — these never leave OS secure storage, so a backup file is safe to move between machines/cloud without leaking cloud credentials. (User account password hashes _are_ included, since they live in the SQLite file — documented in the README as the reason a backup file should still be treated as sensitive.)

**Never silently overwrite:** filenames are timestamped to the second; on a same-second collision (manual double-click) a numeric suffix is appended before any write occurs.

**Restore safety sequence** (per requirement §16.2, no step skipped):

1. Unzip to a temp staging directory (never in place).
2. Validate `manifest.json` exists, checksum matches, and schema version is one this app version knows how to open (older schema → run migrations against the _staged_ copy first; newer schema than the app understands → refuse restore with a clear "update the app first" error).
3. Create an automatic **safety backup of the current live database** before touching it (same local backup mechanism, labeled `pre-restore-safety-*`).
4. Only after 1-3 succeed: atomically swap the staged, validated DB file in for the live one (write to a temp path, `fsync`, then rename — rename is atomic on all three target filesystems), inside a file lock that blocks concurrent app operations.
5. On any failure at any step, the live database is untouched and the user gets a specific error identifying which step failed.

## 1a. Implementation Notes (Phase 6)

- **Filename format**: `{prefix}-YYYY-MM-DD-HHMMSS.zip`, where `prefix` is `backup` for ordinary backups or the label (e.g. `pre-restore-safety`) for special-purpose ones — both share the same directory and archive format, distinguished by the `label` field in each archive's own `manifest.json` (surfaced in the UI as a badge) rather than by separate storage.
- **`app_settings`**: the target schema (`docs/database-schema.md`) documents a general key-value `app_settings` table, but it hasn't been created by any migration yet — no feature has needed it so far. The "contents of a backup" list above is accurate for what actually exists today (the whole SQLite file, which is whatever tables exist at backup time); when `app_settings` is eventually added, it's automatically included for free, same as every other table, with no change needed to the backup code.
- **Concurrency / "file lock that blocks concurrent app operations"**: rather than a separate OS-level file lock, the running app is a single process where every database-touching command already serializes through one `Mutex<Connection>` (`DbState`). The `restore_backup` command holds that same mutex for its entire duration, which fully blocks every other command from touching the database mid-restore within this process — an OS-level lock would only matter for multiple _processes_ sharing one database file, which isn't this app's architecture (each installation owns its own local SQLite file).
- **Restore's live-connection swap**: on POSIX filesystems, renaming a file doesn't invalidate a still-open handle to the old inode, so the sequence is: validate → stage → safety-backup → copy the staged file into place at the live path (via a temp file + `fsync` + rename, so the live path never shows a partially-written file) → _only then_ drop and reopen the live `rusqlite::Connection` against the now-updated path. This avoids needing to close the live connection before the filesystem operations, simplifying failure handling (if anything fails before the final reopen, the still-open original connection keeps working against the untouched original data). Documented cross-platform caveat: Windows' mandatory file locking can behave differently here; this hasn't been an issue on the Linux target this project has been developed and tested on, but would need verification before a Windows release.
- **Automatic backups**: implemented as a check performed once at app launch (if enabled and the configured `daily`/`weekly` interval has elapsed since the last automatic run), not a persistent background timer while the app stays open. This was a deliberate scope decision — a launch-time check delivers real "your data gets backed up automatically" value without the complexity (and "don't interrupt the user" concerns) of a long-running in-process scheduler. Runs on a background thread so it never delays startup.
- **Retention**: applied only to ordinary (unlabeled) backups after a successful manual or automatic backup — a `pre-restore-safety` backup taken moments before a restore is never itself the backup that retention prunes away as a side effect of the operation that just created it.

## 2. Cloud Backup Provider Abstraction

```rust
trait BackupStorageProvider {
    fn authenticate(&mut self) -> Result<(), ProviderError>;
    fn test_connection(&self) -> Result<(), ProviderError>;
    fn upload(&self, local_path: &Path, remote_name: &str) -> Result<RemoteBackupHandle, ProviderError>;
    fn list(&self) -> Result<Vec<RemoteBackupHandle>, ProviderError>;
    fn download(&self, handle: &RemoteBackupHandle, dest: &Path) -> Result<(), ProviderError>;
    fn delete(&self, handle: &RemoteBackupHandle) -> Result<(), ProviderError>;
}
```

- **v1 fully-implemented provider: Dropbox.** OAuth2 with PKCE (no client secret needed for a desktop app, avoiding the "don't ship a secret in the binary" problem entirely), refresh token stored in OS keyring, short-lived access token kept in memory. Upload/list/download/delete via Dropbox's HTTP API with exponential-backoff retry on 429/5xx.
- **Google Drive: interface-complete, integration deferred (decided).** Implementing it well requires a verified Google Cloud OAuth consent screen (a manual, account-specific process on Google's side that can't be completed inside this codebase), so shipping a "fake-functional" version would violate the explicit instruction not to pretend a provider works. The trait and UI provider-picker are built to accept it as a drop-in once that registration exists.
- **Distinction maintained per requirement §17:** this is backup (point-in-time upload of a zip a user explicitly or on-schedule triggers), not sync — there is no bidirectional merge, conflict resolution, or multi-device live state sharing in v1.

## 3. Automatic Update Strategy

- **Mechanism:** `tauri-plugin-updater`, checking a `latest.json` manifest published alongside each GitHub Release by the release workflow.
- **Signing:** Tauri's Ed25519 updater signing. Private key generated once via `tauri signer generate`, stored **only** as the `TAURI_SIGNING_PRIVATE_KEY` (+ password) GitHub Actions secret — never committed. Public key is embedded in `tauri.conf.json` (safe to commit; it can only verify, not sign). The updater refuses to install any package whose signature doesn't verify — no unsigned-artifact fallback path exists, satisfying "do not automatically install unsigned or unverifiable production updates."
- **Update settings (Settings → Updates):** "Automatically check for updates" (default on, checks at most once per app launch and at most every 24h thereafter — never on every window focus), "Automatically download," "Automatically install." Each is independently toggleable per requirement §21.1; the three states shown separately in the UI ("Checking… / Update available — Download / Downloading… / Ready to install — Restart").
- **Never forces a restart mid-edit:** the installer prompt is deferred if a recipe/raw-material form has unsaved changes open; the update is downloaded and queued, and the user is asked to restart at a convenient point rather than being interrupted.
- **Failure handling:** network failure → silent retry on next scheduled check, no error dialog spam; signature failure → hard-reject the package and surface a clear security warning (this should never happen against genuine GitHub Releases, so it's treated as a tamper signal, not a transient error); insufficient disk space → checked before download starts; failed install → previous version's files are untouched until the new version's files are verified in place (Tauri's updater replaces the app bundle only after the download is fully verified).
- **OS app-signing vs update-signing are different things:** update-package signing (above) works regardless of OS code-signing certificates. Actual Authenticode/Apple notarization signing of the installer itself requires you to supply paid certificates as additional GitHub secrets; without them, first-run Gatekeeper/SmartScreen warnings will appear. The pipeline is built to consume those secrets if/when provided, but cannot fabricate them.
