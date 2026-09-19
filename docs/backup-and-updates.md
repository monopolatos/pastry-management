# Backup, Restore, Cloud Storage & Auto-Update Strategy (Phase 1 Design)

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
