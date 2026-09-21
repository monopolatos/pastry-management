//! Local backup engine: creates timestamped zip archives (SQLite file + manifest), lists and
//! validates them, and performs the multi-step restore-safety sequence documented in
//! docs/backup-and-updates.md §1. This module is independent of any specific storage provider —
//! it only ever reads/writes local filesystem paths handed to it — so it can back a "local"
//! destination today and be reused as the on-disk staging step for a cloud provider later
//! (Phase 7) without change.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

const MANIFEST_VERSION: i64 = 1;
const MANIFEST_FILE_NAME: &str = "manifest.json";
const DB_FILE_NAME_IN_ARCHIVE: &str = "pastry-management.sqlite";

#[derive(Debug, Error)]
pub enum BackupError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("not a valid backup archive: {0}")]
    InvalidZip(String),
    #[error(
        "backup archive is missing its manifest.json — this file is not a Pastry Management backup"
    )]
    MissingManifest,
    #[error("backup manifest is corrupt and could not be read: {0}")]
    InvalidManifest(String),
    #[error("backup archive is missing its database file")]
    MissingDatabase,
    #[error(
        "this backup file is corrupted or has been tampered with — its database does not match \
         the checksum recorded in its own manifest"
    )]
    ChecksumMismatch,
    #[error(
        "this backup was created by a newer version of the app (schema version {backup_schema}, \
         this app understands up to schema version {app_schema}) — update the app before restoring it"
    )]
    SchemaTooNew { backup_schema: i64, app_schema: i64 },
    #[error(transparent)]
    Db(#[from] crate::db::DbError),
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("could not serialize backup manifest: {0}")]
    Serialize(#[from] serde_json::Error),
}

impl From<BackupError> for crate::error::AppError {
    fn from(err: BackupError) -> Self {
        crate::error::AppError::new(err.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BackupManifest {
    manifest_version: i64,
    app_version: String,
    schema_version: i64,
    db_checksum_sha256: String,
    created_at: String,
    label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupInfo {
    pub file_name: String,
    pub path: String,
    pub created_at: String,
    pub app_version: String,
    pub schema_version: i64,
    pub size_bytes: u64,
    pub label: Option<String>,
}

fn compute_sha256(path: &Path) -> Result<String, BackupError> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn current_schema_version(conn: &Connection) -> Result<i64, BackupError> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |r| r.get(0),
    )?)
}

/// Timestamped, collision-safe destination path for a new backup archive — never overwrites an
/// existing file (per docs/backup-and-updates.md: "never silently overwrite").
fn unique_backup_path(dest_dir: &Path, prefix: &str, created_at_iso: &str) -> PathBuf {
    let stamp = chrono::DateTime::parse_from_rfc3339(created_at_iso)
        .map(|dt| dt.format("%Y-%m-%d-%H%M%S").to_string())
        .unwrap_or_else(|_| chrono::Utc::now().format("%Y-%m-%d-%H%M%S").to_string());

    let mut candidate = dest_dir.join(format!("{prefix}-{stamp}.zip"));
    let mut suffix = 2;
    while candidate.exists() {
        candidate = dest_dir.join(format!("{prefix}-{stamp}-{suffix}.zip"));
        suffix += 1;
    }
    candidate
}

fn write_zip(dest: &Path, db_path: &Path, manifest: &BackupManifest) -> Result<(), BackupError> {
    // Write to a temp file in the same directory first, then rename into place, so a backup file
    // never appears at its final name until it's fully and successfully written.
    let tmp_path = dest.with_file_name(format!(
        "{}.tmp",
        dest.file_name().unwrap_or_default().to_string_lossy()
    ));

    {
        let file = std::fs::File::create(&tmp_path)?;
        let mut zip = zip::ZipWriter::new(file);
        let options: zip::write::FileOptions<'_, ()> =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        zip.start_file(DB_FILE_NAME_IN_ARCHIVE, options)
            .map_err(|e| BackupError::InvalidZip(e.to_string()))?;
        let mut db_file = std::fs::File::open(db_path)?;
        std::io::copy(&mut db_file, &mut zip)?;

        zip.start_file(MANIFEST_FILE_NAME, options)
            .map_err(|e| BackupError::InvalidZip(e.to_string()))?;
        let manifest_json = serde_json::to_vec_pretty(manifest)?;
        zip.write_all(&manifest_json)?;

        zip.finish()
            .map_err(|e| BackupError::InvalidZip(e.to_string()))?;
    }

    std::fs::rename(&tmp_path, dest)?;
    Ok(())
}

/// Creates one backup archive of `db_path` into `dest_dir`. `label` distinguishes special-purpose
/// backups (e.g. `"pre-restore-safety"`) from ordinary ones (`None`, filenamed `backup-*`) —
/// ordinary and labeled backups share the same directory and format.
pub fn create_backup(
    conn: &Connection,
    db_path: &Path,
    dest_dir: &Path,
    label: Option<&str>,
) -> Result<BackupInfo, BackupError> {
    std::fs::create_dir_all(dest_dir)?;

    // Checkpoint the WAL so db_path itself holds a complete, consistent snapshot rather than a
    // stale base file plus an unmerged -wal file (see docs/backup-and-updates.md §1).
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;

    let schema_version = current_schema_version(conn)?;
    let checksum = compute_sha256(db_path)?;
    let created_at = chrono::Utc::now().to_rfc3339();

    let manifest = BackupManifest {
        manifest_version: MANIFEST_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        schema_version,
        db_checksum_sha256: checksum,
        created_at: created_at.clone(),
        label: label.map(|s| s.to_string()),
    };

    let prefix = label.unwrap_or("backup");
    let dest_path = unique_backup_path(dest_dir, prefix, &created_at);
    write_zip(&dest_path, db_path, &manifest)?;

    let size_bytes = std::fs::metadata(&dest_path)?.len();

    Ok(BackupInfo {
        file_name: dest_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        path: dest_path.to_string_lossy().to_string(),
        created_at: manifest.created_at,
        app_version: manifest.app_version,
        schema_version: manifest.schema_version,
        size_bytes,
        label: manifest.label,
    })
}

fn read_manifest_from_zip(path: &Path) -> Result<BackupManifest, BackupError> {
    let file = std::fs::File::open(path)?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| BackupError::InvalidZip(e.to_string()))?;
    let mut manifest_entry = archive
        .by_name(MANIFEST_FILE_NAME)
        .map_err(|_| BackupError::MissingManifest)?;
    let mut buf = String::new();
    manifest_entry
        .read_to_string(&mut buf)
        .map_err(BackupError::Io)?;
    drop(manifest_entry);
    serde_json::from_str(&buf).map_err(|e| BackupError::InvalidManifest(e.to_string()))
}

fn extract_db_file(zip_path: &Path, dest_dir: &Path) -> Result<PathBuf, BackupError> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| BackupError::InvalidZip(e.to_string()))?;
    let mut db_entry = archive
        .by_name(DB_FILE_NAME_IN_ARCHIVE)
        .map_err(|_| BackupError::MissingDatabase)?;
    let dest_path = dest_dir.join(DB_FILE_NAME_IN_ARCHIVE);
    let mut out = std::fs::File::create(&dest_path)?;
    std::io::copy(&mut db_entry, &mut out).map_err(BackupError::Io)?;
    Ok(dest_path)
}

/// Lists every recognizable backup archive in `dir`, newest first. A file that fails to parse as
/// a backup (corrupt zip, missing manifest, etc.) is silently skipped rather than failing the
/// whole listing — one bad file in the directory shouldn't hide every good one.
pub fn list_backups(dir: &Path) -> Result<Vec<BackupInfo>, BackupError> {
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut result = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("zip") {
            continue;
        }
        if let Ok(manifest) = read_manifest_from_zip(&path) {
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            result.push(BackupInfo {
                file_name: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
                path: path.to_string_lossy().to_string(),
                created_at: manifest.created_at,
                app_version: manifest.app_version,
                schema_version: manifest.schema_version,
                size_bytes,
                label: manifest.label,
            });
        }
    }

    result.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(result)
}

/// Deletes the oldest backups in `dir` beyond `retention_count`, best-effort (a failed delete is
/// logged-and-skipped, not propagated — retention is a housekeeping nicety, not something that
/// should turn a successful backup into a reported failure).
pub fn enforce_retention(dir: &Path, retention_count: i64) -> Result<(), BackupError> {
    let backups = list_backups(dir)?;
    if backups.len() as i64 <= retention_count {
        return Ok(());
    }
    for stale in backups.into_iter().skip(retention_count.max(0) as usize) {
        let _ = std::fs::remove_file(&stale.path);
    }
    Ok(())
}

/// Validates a backup archive without touching anything live: checks the manifest is present and
/// parses, the schema version is one this app understands, and the archive's database file's
/// checksum matches what the manifest recorded (i.e. the archive hasn't been corrupted or
/// tampered with since it was created).
fn validate_backup(path: &Path) -> Result<BackupManifest, BackupError> {
    let manifest = read_manifest_from_zip(path)?;

    let app_schema = crate::db::max_known_migration_version();
    if manifest.schema_version > app_schema {
        return Err(BackupError::SchemaTooNew {
            backup_schema: manifest.schema_version,
            app_schema,
        });
    }

    let tmp_dir =
        std::env::temp_dir().join(format!("pastry-mgmt-validate-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp_dir)?;
    let extracted = extract_db_file(path, &tmp_dir);
    let result = extracted.and_then(|extracted_db| {
        let checksum = compute_sha256(&extracted_db)?;
        if checksum != manifest.db_checksum_sha256 {
            Err(BackupError::ChecksumMismatch)
        } else {
            Ok(())
        }
    });
    let _ = std::fs::remove_dir_all(&tmp_dir);
    result?;

    Ok(manifest)
}

/// Public wrapper around [`validate_backup`] for the "check this backup's integrity" UI action,
/// returning just the app/schema version so the caller can show something meaningful without
/// reaching into private manifest internals.
pub struct ValidatedBackup {
    pub app_version: String,
    pub schema_version: i64,
    pub created_at: String,
}

pub fn validate_backup_file(path: &Path) -> Result<ValidatedBackup, BackupError> {
    let manifest = validate_backup(path)?;
    Ok(ValidatedBackup {
        app_version: manifest.app_version,
        schema_version: manifest.schema_version,
        created_at: manifest.created_at,
    })
}

/// Full restore-safety sequence (docs/backup-and-updates.md §1):
/// 1-2. Validate the backup (checksum + schema compatibility) — done first, before anything live
///      is touched, so an invalid backup fails loudly without side effects.
/// 3. Stage the backup's database in a temp directory and bring it up to the current schema
///    (never in place).
/// 4. Take an automatic safety backup of the CURRENT live database, labeled `pre-restore-safety`.
/// 5. Atomically swap the staged, validated, up-to-date database in for the live one.
/// 6. Reopen the live connection against the restored file so the running app sees the restored
///    data immediately, without requiring a restart.
///
/// `live_conn` is replaced in place with a fresh connection to the restored database on success.
/// On any failure at steps 1-4, `live_conn` and the live database file are both untouched.
pub fn restore_backup(
    backup_path: &Path,
    live_db_path: &Path,
    backups_dir: &Path,
    live_conn: &mut Connection,
) -> Result<(), BackupError> {
    validate_backup(backup_path)?;

    let staging_dir =
        std::env::temp_dir().join(format!("pastry-mgmt-restore-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&staging_dir)?;
    let staged_db = extract_db_file(backup_path, &staging_dir)?;
    {
        // Opening it through the normal migration runner both proves it's a genuine, openable
        // SQLite database and upgrades it to the current schema if the backup predates it.
        let _staged_conn = crate::db::open_and_migrate(&staged_db)?;
    }

    create_backup(
        live_conn,
        live_db_path,
        backups_dir,
        Some("pre-restore-safety"),
    )?;

    let swap_target = live_db_path.with_file_name(format!(
        "{}.restoring",
        live_db_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    ));
    std::fs::copy(&staged_db, &swap_target)?;
    std::fs::File::open(&swap_target)?.sync_all()?;
    std::fs::rename(&swap_target, live_db_path)?;

    // Sidecar WAL/SHM files from the just-replaced database no longer apply.
    let _ = std::fs::remove_file(live_db_path.with_file_name(format!(
        "{}-wal",
        live_db_path.file_name().unwrap_or_default().to_string_lossy()
    )));
    let _ = std::fs::remove_file(live_db_path.with_file_name(format!(
        "{}-shm",
        live_db_path.file_name().unwrap_or_default().to_string_lossy()
    )));

    let _ = std::fs::remove_dir_all(&staging_dir);

    *live_conn = crate::db::open_and_migrate(live_db_path)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pastry_mgmt_backup_test_{name}_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn seeded_db(path: &Path) -> Connection {
        let conn = crate::db::open_and_migrate(path).unwrap();
        conn.execute(
            "INSERT INTO suppliers (name, contact_person) VALUES ('Acme Flour Co', 'Jane Doe')",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn create_backup_produces_a_valid_archive() {
        let dir = temp_dir("create");
        let db_path = dir.join("live.sqlite");
        let conn = seeded_db(&db_path);
        let backups_dir = dir.join("backups");

        let info = create_backup(&conn, &db_path, &backups_dir, None).unwrap();

        assert!(PathBuf::from(&info.path).exists());
        assert!(info.file_name.starts_with("backup-"));
        assert!(info.size_bytes > 0);

        let validated = validate_backup_file(&PathBuf::from(&info.path)).unwrap();
        assert_eq!(
            validated.schema_version,
            crate::db::max_known_migration_version()
        );
    }

    #[test]
    fn list_backups_returns_newest_first_and_skips_junk_files() {
        let dir = temp_dir("list");
        let db_path = dir.join("live.sqlite");
        let conn = seeded_db(&db_path);
        let backups_dir = dir.join("backups");
        std::fs::create_dir_all(&backups_dir).unwrap();

        create_backup(&conn, &db_path, &backups_dir, None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100)); // ensure a distinct timestamp
        let second = create_backup(&conn, &db_path, &backups_dir, None).unwrap();

        std::fs::write(backups_dir.join("not-a-backup.zip"), b"garbage").unwrap();

        let listed = list_backups(&backups_dir).unwrap();
        assert_eq!(
            listed.len(),
            2,
            "the junk .zip file should be silently skipped"
        );
        assert_eq!(
            listed[0].file_name, second.file_name,
            "newest backup should be first"
        );
    }

    #[test]
    fn restore_round_trips_data_losslessly() {
        let dir = temp_dir("restore");
        let db_path = dir.join("live.sqlite");
        let mut conn = seeded_db(&db_path);
        let backups_dir = dir.join("backups");

        let info = create_backup(&conn, &db_path, &backups_dir, None).unwrap();

        // Mutate the live database after the backup, so restore has something real to undo.
        conn.execute("DELETE FROM suppliers", []).unwrap();
        conn.execute("INSERT INTO suppliers (name) VALUES ('Wrong Supplier')", [])
            .unwrap();

        restore_backup(
            &PathBuf::from(&info.path),
            &db_path,
            &backups_dir,
            &mut conn,
        )
        .unwrap();

        let names: Vec<String> = conn
            .prepare("SELECT name FROM suppliers ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            names,
            vec!["Acme Flour Co".to_string()],
            "restored data should match the backup exactly"
        );
    }

    #[test]
    fn restore_creates_a_pre_restore_safety_backup_automatically() {
        let dir = temp_dir("safety");
        let db_path = dir.join("live.sqlite");
        let mut conn = seeded_db(&db_path);
        let backups_dir = dir.join("backups");

        let info = create_backup(&conn, &db_path, &backups_dir, None).unwrap();
        restore_backup(
            &PathBuf::from(&info.path),
            &db_path,
            &backups_dir,
            &mut conn,
        )
        .unwrap();

        let all = list_backups(&backups_dir).unwrap();
        assert!(
            all.iter()
                .any(|b| b.label.as_deref() == Some("pre-restore-safety")),
            "restore should have created a pre-restore-safety backup"
        );
    }

    #[test]
    fn restore_rejects_a_tampered_checksum_and_leaves_live_db_untouched() {
        let dir = temp_dir("tamper");
        let db_path = dir.join("live.sqlite");
        let mut conn = seeded_db(&db_path);
        let backups_dir = dir.join("backups");

        let info = create_backup(&conn, &db_path, &backups_dir, None).unwrap();

        // Tamper with the archive by rebuilding it with the *same* (untouched, correct) database
        // bytes but a manifest whose recorded checksum has been doctored to a wrong value — this
        // is what an actually-corrupted-in-transit or maliciously-edited backup looks like: the
        // content no longer matches what the manifest claims it should hash to. (Appending random
        // bytes after a complete zip's end-of-central-directory record, by contrast, does NOT
        // corrupt the embedded file data — the zip format tolerates trailing bytes — so that
        // wouldn't actually exercise the checksum check this test is for.)
        {
            let staging = dir.join("tamper-staging");
            std::fs::create_dir_all(&staging).unwrap();
            let db_bytes_path = extract_db_file(&PathBuf::from(&info.path), &staging).unwrap();

            let manifest_text = {
                let file = std::fs::File::open(&info.path).unwrap();
                let mut archive = zip::ZipArchive::new(file).unwrap();
                let mut entry = archive.by_name(MANIFEST_FILE_NAME).unwrap();
                let mut buf = String::new();
                entry.read_to_string(&mut buf).unwrap();
                buf
            };
            let mut manifest: BackupManifest = serde_json::from_str(&manifest_text).unwrap();
            manifest.db_checksum_sha256 = "0".repeat(64);

            let rebuilt_path = dir.join("tampered.zip");
            let file = std::fs::File::create(&rebuilt_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
            zip.start_file(DB_FILE_NAME_IN_ARCHIVE, options).unwrap();
            zip.write_all(&std::fs::read(&db_bytes_path).unwrap())
                .unwrap();
            zip.start_file(MANIFEST_FILE_NAME, options).unwrap();
            zip.write_all(serde_json::to_string(&manifest).unwrap().as_bytes())
                .unwrap();
            zip.finish().unwrap();

            std::fs::rename(&rebuilt_path, &info.path).unwrap();
            let _ = std::fs::remove_dir_all(&staging);
        }

        let before: Vec<String> = conn
            .prepare("SELECT name FROM suppliers")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();

        let result = restore_backup(
            &PathBuf::from(&info.path),
            &db_path,
            &backups_dir,
            &mut conn,
        );
        assert!(
            result.is_err(),
            "a tampered archive must be rejected, not silently accepted"
        );

        let after: Vec<String> = conn
            .prepare("SELECT name FROM suppliers")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            before, after,
            "live database must be untouched after a rejected restore"
        );
    }

    #[test]
    fn restore_rejects_a_backup_with_no_manifest() {
        let dir = temp_dir("no_manifest");
        let db_path = dir.join("live.sqlite");
        let mut conn = seeded_db(&db_path);
        let backups_dir = dir.join("backups");
        std::fs::create_dir_all(&backups_dir).unwrap();

        let fake_path = backups_dir.join("fake.zip");
        {
            let file = std::fs::File::create(&fake_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
            zip.start_file("readme.txt", options).unwrap();
            zip.write_all(b"not a real backup").unwrap();
            zip.finish().unwrap();
        }

        let result = restore_backup(&fake_path, &db_path, &backups_dir, &mut conn);
        assert!(result.is_err());
    }

    #[test]
    fn restore_rejects_a_completely_invalid_zip_file() {
        let dir = temp_dir("invalid_zip");
        let db_path = dir.join("live.sqlite");
        let mut conn = seeded_db(&db_path);
        let backups_dir = dir.join("backups");
        std::fs::create_dir_all(&backups_dir).unwrap();

        let junk_path = backups_dir.join("junk.zip");
        std::fs::write(&junk_path, b"this is not a zip file at all").unwrap();

        let result = restore_backup(&junk_path, &db_path, &backups_dir, &mut conn);
        assert!(
            result.is_err(),
            "an unparseable file must error cleanly, not panic"
        );
    }

    #[test]
    fn enforce_retention_keeps_only_the_newest_n_backups() {
        let dir = temp_dir("retention");
        let db_path = dir.join("live.sqlite");
        let conn = seeded_db(&db_path);
        let backups_dir = dir.join("backups");

        for _ in 0..3 {
            create_backup(&conn, &db_path, &backups_dir, None).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(1100));
        }
        assert_eq!(list_backups(&backups_dir).unwrap().len(), 3);

        enforce_retention(&backups_dir, 2).unwrap();
        assert_eq!(list_backups(&backups_dir).unwrap().len(), 2);
    }

    #[test]
    fn backup_filenames_never_collide() {
        let dir = temp_dir("collision");
        let db_path = dir.join("live.sqlite");
        let conn = seeded_db(&db_path);
        let backups_dir = dir.join("backups");

        // Two backups created within the same second must still get distinct filenames.
        let first = create_backup(&conn, &db_path, &backups_dir, None).unwrap();
        let second = create_backup(&conn, &db_path, &backups_dir, None).unwrap();
        assert_ne!(first.path, second.path);
        assert!(PathBuf::from(&first.path).exists());
        assert!(PathBuf::from(&second.path).exists());
    }
}
