//! Cloud backup storage provider abstraction (docs/backup-and-updates.md §2).
//!
//! `BackupStorageProvider` is intentionally narrow — just the four data operations a connected
//! provider needs to support once authenticated. The OAuth "connect this account" flow is NOT a
//! trait method: constructing a working provider instance already requires a valid token, so
//! "authenticate" necessarily happens *before* a provider exists, not as an operation *on* one.
//! That one-time interactive flow lives in `dropbox::connect` instead — a refinement over the
//! original design sketch, which is documented here rather than silently diverging from it.
//!
//! v1 has exactly one implementation (`dropbox`). Google Drive is intentionally not implemented
//! (see docs/backup-and-updates.md §2) — this trait exists so it can be added later without
//! touching anything that already depends on it.

pub mod dropbox;

use std::path::Path;

#[derive(Debug, Clone, serde::Serialize)]
pub struct RemoteBackupHandle {
    /// Provider-specific identifier needed to address this file in later calls (for Dropbox,
    /// its path, e.g. "/backup-2026-09-10-120000.zip").
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
    pub modified_at: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("authentication failed: {0}")]
    AuthFailed(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("the provider rejected the request: {0}")]
    Api(String),
    #[error("local I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("could not access the system keyring: {0}")]
    Keyring(String),
    #[error("could not complete the sign-in flow: {0}")]
    OAuthFlow(String),
}

impl From<ProviderError> for crate::error::AppError {
    fn from(err: ProviderError) -> Self {
        crate::error::AppError::new(err.to_string())
    }
}

#[async_trait::async_trait]
pub trait BackupStorageProvider: Send + Sync {
    async fn test_connection(&self) -> Result<(), ProviderError>;
    async fn upload(
        &self,
        local_path: &Path,
        remote_name: &str,
    ) -> Result<RemoteBackupHandle, ProviderError>;
    async fn list(&self) -> Result<Vec<RemoteBackupHandle>, ProviderError>;
    async fn download(&self, handle: &RemoteBackupHandle, dest: &Path)
        -> Result<(), ProviderError>;
    async fn delete(&self, handle: &RemoteBackupHandle) -> Result<(), ProviderError>;
}

const KEYRING_SERVICE: &str = "com.pastrymanagement.app";

/// Stores a provider secret (e.g. a Dropbox refresh token) in the OS-native secure store —
/// Windows Credential Manager, macOS Keychain, or the Linux Secret Service — never in the
/// database or anywhere else on disk. See docs/architecture.md's security section.
pub fn store_secret(account: &str, secret: &str) -> Result<(), ProviderError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account)
        .map_err(|e| ProviderError::Keyring(e.to_string()))?;
    entry
        .set_password(secret)
        .map_err(|e| ProviderError::Keyring(e.to_string()))
}

pub fn load_secret(account: &str) -> Result<Option<String>, ProviderError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account)
        .map_err(|e| ProviderError::Keyring(e.to_string()))?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(ProviderError::Keyring(e.to_string())),
    }
}

pub fn delete_secret(account: &str) -> Result<(), ProviderError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account)
        .map_err(|e| ProviderError::Keyring(e.to_string()))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(ProviderError::Keyring(e.to_string())),
    }
}
