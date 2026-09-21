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

### 2a. Implementation Notes (Phase 7)

Implemented in `apps/desktop/src-tauri/src/cloud/` (`mod.rs` for the trait + OS keyring helpers, `dropbox.rs` for the PKCE flow and API client) — 16 passing Rust tests, including a known-good RFC 7636 PKCE test vector and mocked-HTTP-server tests (via `mockito`) exercising the real upload/list/download/delete/retry/auth-failure request-and-response handling without needing live Dropbox credentials in CI.

- **`authenticate` is not a trait method.** The original sketch above put it on `BackupStorageProvider`, but constructing a working provider instance already requires a valid token — "authenticate" necessarily happens _before_ a provider exists, not as an operation _on_ one. The one-time interactive OAuth flow is a standalone function, `dropbox::connect(app_handle, app_key) -> DropboxAccountInfo`, called once from the "Connect to Dropbox" UI action; the trait itself only covers the four data operations.
- **Loopback OAuth redirect, no client secret.** `connect` opens the system browser to Dropbox's authorize page with a PKCE challenge, binds a `TcpListener` on an OS-assigned free `127.0.0.1` port as the redirect URI, and parses the one resulting browser request directly (no general-purpose HTTP server dependency) for `?code=...&state=...`, verifying `state` to guard against a forged callback.
- **Access tokens are never cached.** Every operation exchanges the stored refresh token for a fresh access token first. Backups are infrequent, so the extra round trip per operation is a fine trade for not tracking token expiry.
- **Cloud restore reuses local restore exactly.** `dropbox_restore_backup` downloads the archive to a temp file and hands it to the same `backup::restore_backup` local restores use — full checksum/schema validation, an automatic pre-restore safety backup, and the atomic live-database swap, with zero duplicated restore logic between "local" and "cloud."
- **Setup required before this does anything real** — see §2b. Without a registered Dropbox app, `dropbox_connect` fails with a clear "set your App Key first" error; nothing pretends to work without configuration.

### 2b. Setting Up Your Own Dropbox App (required before connecting)

Dropbox cloud backup needs an app registered under **your own** Dropbox account — there's no shared/default app key baked into this project, since anyone self-hosting this app should control their own Dropbox app registration and permissions.

1. Go to <https://www.dropbox.com/developers/apps> and click **Create app**.
2. Choose **Scoped access**, then **App folder** access (recommended — the app can only ever see one dedicated folder, e.g. "Apps/Pastry Management," never the rest of your Dropbox). Name the app anything you like.
3. Under the app's **Permissions** tab, enable at minimum: `files.content.write`, `files.content.read`, and `account_info.read`. Save changes.
4. Under the **Settings** tab, find **OAuth 2** → **Redirect URIs** and add `http://127.0.0.1/callback` (the app negotiates the actual loopback port at connect time, but Dropbox only lets you whitelist the host+path, not a specific port — this is expected and works with Dropbox's loopback-redirect support for installed apps).
5. Copy the **App key** shown at the top of the Settings tab (not the App secret — this app never uses or needs it, since PKCE is specifically designed so installed apps don't ship a client secret).
6. In Pastry Management, go to Backup & Restore → Dropbox settings, paste the App key, save, then click **Connect to Dropbox** — your browser opens to Dropbox's sign-in/approval page, and the app picks up the result automatically once you approve.

## 3. Automatic Update Strategy

- **Mechanism:** `tauri-plugin-updater`, checking a `latest.json` manifest published alongside each GitHub Release by the release workflow.
- **Signing:** Tauri's Ed25519 updater signing. Private key generated once via `tauri signer generate`, stored **only** as the `TAURI_SIGNING_PRIVATE_KEY` (+ password) GitHub Actions secret — never committed. Public key is embedded in `tauri.conf.json` (safe to commit; it can only verify, not sign). The updater refuses to install any package whose signature doesn't verify — no unsigned-artifact fallback path exists, satisfying "do not automatically install unsigned or unverifiable production updates."
- **Update settings (Settings → Updates):** "Automatically check for updates" (default on, checks at most once per app launch and at most every 24h thereafter — never on every window focus), "Automatically download," "Automatically install." Each is independently toggleable per requirement §21.1; the three states shown separately in the UI ("Checking… / Update available — Download / Downloading… / Ready to install — Restart").
- **Never forces a restart mid-edit:** the installer prompt is deferred if a recipe/raw-material form has unsaved changes open; the update is downloaded and queued, and the user is asked to restart at a convenient point rather than being interrupted.
- **Failure handling:** network failure → silent retry on next scheduled check, no error dialog spam; signature failure → hard-reject the package and surface a clear security warning (this should never happen against genuine GitHub Releases, so it's treated as a tamper signal, not a transient error); insufficient disk space → checked before download starts; failed install → previous version's files are untouched until the new version's files are verified in place (Tauri's updater replaces the app bundle only after the download is fully verified).
- **OS app-signing vs update-signing are different things:** update-package signing (above) works regardless of OS code-signing certificates. Actual Authenticode/Apple notarization signing of the installer itself requires you to supply paid certificates as additional GitHub secrets; without them, first-run Gatekeeper/SmartScreen warnings will appear. The pipeline is built to consume those secrets if/when provided, but cannot fabricate them.

### 3a. Implementation Notes (Phase 9)

- **Custom commands, not the plugin's own JS bridge:** same convention as Dropbox (§2a) and local backup's folder picker — the frontend never calls `@tauri-apps/plugin-updater` directly; `src-tauri/src/commands/updates.rs` wraps `tauri-plugin-updater`'s Rust API (`AppHandle::updater()`, `Update::check/download/install`) in this app's own typed commands, called from `src/api/updates.ts`. This meant the `updater:default`/`process:default` capability permissions were never actually needed — those only gate a webview calling a plugin's own `invoke("plugin:x|y")` commands, not this app's custom ones.
- **Four real stages, not one bundled call:** the plugin's own `download_and_install()` helper bundles fetch+verify+apply into one step, but the three settings ("auto-check," "auto-download," "auto-install") are documented as independently toggleable, so `check_for_update` → `download_update` → `install_update` → `restart_app` are four separate commands/state transitions here, each individually automatable by its own setting. `restart_app` is never called automatically by any code path in this app, regardless of settings — that's what actually satisfies "never forces a restart mid-edit," instead of tracking unsaved-form state globally as the original sketch above implied.
- **Current version display doesn't require a network check:** `tauri_plugin_updater::Update.current_version` is only populated when an update was actually found, so a separate network-free `get_current_app_version` command (reading `AppHandle::package_info()`) backs the "Current version: vX.Y.Z" line in Settings → Updates.
- **Signing key generated for real:** an Ed25519 keypair was generated via `tauri signer generate`; the public key is committed in `tauri.conf.json`'s `plugins.updater.pubkey`. The private key + password were **not** committed — they were generated locally and must be added by the project owner as the `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub Actions secrets (see `.github/workflows/release.yml`, which only sets them when configured, following the same empty-secret-is-not-the-same-as-absent pattern already fixed for the Apple/Windows codesigning secrets in Phase 8). Losing this key means future releases can never be verified as updates by installs signed with it.
- **Honest gap:** no version of this app has actually been published as a GitHub Release yet with a `latest.json` attached, so the full "a build with a higher version detects and installs an update from a lower one" flow has not been exercised end-to-end against real GitHub infrastructure — only against `cargo test`/`cargo check`/a running dev build (which has no release endpoint to find anything at). Same category of gap as Dropbox's live-OAuth verification in §2a: code-complete and reviewed, not yet exercised against the real service. Signature verification itself is entirely `tauri-plugin-updater`'s own internal logic (not reimplemented here), so there's nothing further this app's own test suite could usefully assert about tamper-rejection beyond what upstream already tests.
