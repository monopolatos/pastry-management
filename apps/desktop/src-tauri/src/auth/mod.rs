//! Authentication: password hashing, user repository, and in-memory session state.
//!
//! Local-first, single-machine auth per docs/architecture.md §3 — Argon2id hashing, no plaintext
//! passwords ever stored, no persistent "remember me" token (a session lives only in memory and
//! ends on logout or app close).

use std::sync::Mutex;

use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{AppError, AppResult};

pub const MIN_PASSWORD_LENGTH: usize = 8;

#[derive(Debug, Clone, Serialize)]
pub struct UserPublic {
    pub id: i64,
    pub username: String,
    pub role: String,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub token: String,
    pub user: UserPublic,
    pub issued_at: String,
}

/// Single active session, mirroring docs/architecture.md's "in-memory session token issued on
/// login, held by the Rust core" design. A single-user desktop app has no need to track multiple
/// concurrent sessions.
pub struct SessionState(pub Mutex<Option<SessionInfo>>);

impl Default for SessionState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

pub fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| AppError::new(format!("failed to hash password: {e}")))
}

pub fn verify_password(password: &str, hash: &str) -> AppResult<bool> {
    let parsed = PasswordHash::new(hash)
        .map_err(|e| AppError::new(format!("stored password hash is corrupt: {e}")))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

pub fn validate_username(username: &str) -> AppResult<()> {
    let trimmed = username.trim();
    if trimmed.is_empty() {
        return Err(AppError::field("username", "Username is required."));
    }
    if trimmed.len() > 64 {
        return Err(AppError::field(
            "username",
            "Username must be 64 characters or fewer.",
        ));
    }
    Ok(())
}

pub fn validate_password(password: &str) -> AppResult<()> {
    if password.len() < MIN_PASSWORD_LENGTH {
        return Err(AppError::field(
            "password",
            format!("Password must be at least {MIN_PASSWORD_LENGTH} characters long."),
        ));
    }
    Ok(())
}

pub fn user_count(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?)
}

struct UserRow {
    id: i64,
    username: String,
    password_hash: String,
    role: String,
    is_active: bool,
    created_at: String,
}

fn map_user_row(row: &rusqlite::Row) -> rusqlite::Result<UserRow> {
    Ok(UserRow {
        id: row.get(0)?,
        username: row.get(1)?,
        password_hash: row.get(2)?,
        role: row.get(3)?,
        is_active: row.get::<_, i64>(4)? != 0,
        created_at: row.get(5)?,
    })
}

fn find_user_by_username(conn: &Connection, username: &str) -> AppResult<Option<UserRow>> {
    Ok(conn
        .query_row(
            "SELECT id, username, password_hash, role, is_active, created_at FROM users WHERE username = ?1",
            [username],
            map_user_row,
        )
        .optional()?)
}

pub fn create_owner_account(
    conn: &Connection,
    username: &str,
    password: &str,
) -> AppResult<UserPublic> {
    validate_username(username)?;
    validate_password(password)?;

    if user_count(conn)? > 0 {
        return Err(AppError::new(
            "An owner account already exists. Use an existing account to sign in.",
        ));
    }

    insert_user(conn, username.trim(), password, "owner")
}

/// Creates an additional user. Restricted to an owner/admin caller at the command layer — this
/// function itself performs no authorization check, since it operates purely on the database.
pub fn create_user(
    conn: &Connection,
    username: &str,
    password: &str,
    role: &str,
) -> AppResult<UserPublic> {
    validate_username(username)?;
    validate_password(password)?;
    if !["owner", "admin", "employee"].contains(&role) {
        return Err(AppError::field(
            "role",
            "Role must be owner, admin, or employee.",
        ));
    }
    insert_user(conn, username.trim(), password, role)
}

fn insert_user(
    conn: &Connection,
    username: &str,
    password: &str,
    role: &str,
) -> AppResult<UserPublic> {
    if find_user_by_username(conn, username)?.is_some() {
        return Err(AppError::field(
            "username",
            "That username is already taken.",
        ));
    }

    let password_hash = hash_password(password)?;
    conn.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?1, ?2, ?3)",
        rusqlite::params![username, password_hash, role],
    )?;
    let id = conn.last_insert_rowid();

    let row = conn.query_row(
        "SELECT id, username, password_hash, role, is_active, created_at FROM users WHERE id = ?1",
        [id],
        map_user_row,
    )?;

    Ok(UserPublic {
        id: row.id,
        username: row.username,
        role: row.role,
        is_active: row.is_active,
        created_at: row.created_at,
    })
}

pub fn authenticate(conn: &Connection, username: &str, password: &str) -> AppResult<UserPublic> {
    let row = find_user_by_username(conn, username)?
        .ok_or_else(|| AppError::new("Incorrect username or password."))?;

    if !row.is_active {
        return Err(AppError::new("This account has been deactivated."));
    }

    if !verify_password(password, &row.password_hash)? {
        return Err(AppError::new("Incorrect username or password."));
    }

    Ok(UserPublic {
        id: row.id,
        username: row.username,
        role: row.role,
        is_active: row.is_active,
        created_at: row.created_at,
    })
}

/// Changes a user's own password. Requires the current password to verify identity — there is no
/// admin-reset path in v1 (see docs/architecture.md §3's documented password-recovery limitation).
pub fn change_password(
    conn: &Connection,
    user_id: i64,
    current_password: &str,
    new_password: &str,
) -> AppResult<()> {
    validate_password(new_password)?;

    let password_hash: String = conn
        .query_row(
            "SELECT password_hash FROM users WHERE id = ?1",
            [user_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::new("User not found."))?;

    if !verify_password(current_password, &password_hash)? {
        return Err(AppError::field(
            "current_password",
            "Current password is incorrect.",
        ));
    }

    let new_hash = hash_password(new_password)?;
    conn.execute(
        "UPDATE users SET password_hash = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?2",
        rusqlite::params![new_hash, user_id],
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db_with_users_table() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('owner','admin','employee')),
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn hash_and_verify_round_trip() {
        let hash = hash_password("correct-horse-battery-staple").unwrap();
        assert!(verify_password("correct-horse-battery-staple", &hash).unwrap());
        assert!(!verify_password("wrong-password", &hash).unwrap());
    }

    #[test]
    fn password_hash_is_never_the_plaintext() {
        let hash = hash_password("supersecret123").unwrap();
        assert_ne!(hash, "supersecret123");
        assert!(hash.starts_with("$argon2id$"));
    }

    #[test]
    fn first_owner_account_can_be_created_and_then_authenticated() {
        let conn = memory_db_with_users_table();
        let user = create_owner_account(&conn, "alice", "password123").unwrap();
        assert_eq!(user.role, "owner");

        let authed = authenticate(&conn, "alice", "password123").unwrap();
        assert_eq!(authed.id, user.id);
    }

    #[test]
    fn second_owner_account_creation_is_rejected() {
        let conn = memory_db_with_users_table();
        create_owner_account(&conn, "alice", "password123").unwrap();

        let result = create_owner_account(&conn, "bob", "password456");
        assert!(result.is_err());
    }

    #[test]
    fn wrong_password_is_rejected() {
        let conn = memory_db_with_users_table();
        create_owner_account(&conn, "alice", "password123").unwrap();

        let result = authenticate(&conn, "alice", "wrong-password");
        assert!(result.is_err());
    }

    #[test]
    fn unknown_username_is_rejected_with_generic_message() {
        let conn = memory_db_with_users_table();
        create_owner_account(&conn, "alice", "password123").unwrap();

        let err = authenticate(&conn, "nobody", "password123").unwrap_err();
        // Deliberately generic: must not leak whether the username exists.
        assert_eq!(err.message, "Incorrect username or password.");
    }

    #[test]
    fn short_password_is_rejected_with_a_field_error() {
        let conn = memory_db_with_users_table();
        let err = create_owner_account(&conn, "alice", "short").unwrap_err();
        assert_eq!(err.field.as_deref(), Some("password"));
    }

    #[test]
    fn duplicate_username_is_rejected() {
        let conn = memory_db_with_users_table();
        create_owner_account(&conn, "alice", "password123").unwrap();
        let err = create_user(&conn, "alice", "password456", "employee").unwrap_err();
        assert_eq!(err.field.as_deref(), Some("username"));
    }

    #[test]
    fn deactivated_account_cannot_authenticate() {
        let conn = memory_db_with_users_table();
        create_owner_account(&conn, "alice", "password123").unwrap();
        conn.execute(
            "UPDATE users SET is_active = 0 WHERE username = 'alice'",
            [],
        )
        .unwrap();

        let result = authenticate(&conn, "alice", "password123");
        assert!(result.is_err());
    }

    #[test]
    fn change_password_succeeds_with_correct_current_password() {
        let conn = memory_db_with_users_table();
        let user = create_owner_account(&conn, "alice", "password123").unwrap();

        change_password(&conn, user.id, "password123", "newpassword456").unwrap();

        assert!(authenticate(&conn, "alice", "newpassword456").is_ok());
        assert!(authenticate(&conn, "alice", "password123").is_err());
    }

    #[test]
    fn change_password_rejects_wrong_current_password() {
        let conn = memory_db_with_users_table();
        let user = create_owner_account(&conn, "alice", "password123").unwrap();

        let err = change_password(&conn, user.id, "wrong-password", "newpassword456").unwrap_err();
        assert_eq!(err.field.as_deref(), Some("current_password"));

        assert!(authenticate(&conn, "alice", "password123").is_ok());
    }

    #[test]
    fn change_password_rejects_a_too_short_new_password() {
        let conn = memory_db_with_users_table();
        let user = create_owner_account(&conn, "alice", "password123").unwrap();

        let err = change_password(&conn, user.id, "password123", "short").unwrap_err();
        assert_eq!(err.field.as_deref(), Some("password"));
    }
}
