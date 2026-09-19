//! Shared error type returned by Tauri commands.
//!
//! Serializes to `{ message, field }` so the frontend can attach a validation error to the
//! specific form field it concerns (requirement: "invalid input rejected with field-level
//! errors") instead of only ever showing a generic toast.

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AppError {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
}

impl AppError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            field: None,
        }
    }

    pub fn field(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            field: Some(field.into()),
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        match &err {
            rusqlite::Error::SqliteFailure(e, _)
                if e.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                AppError::new(format!("This operation violates a data constraint: {err}"))
            }
            _ => AppError::new(format!("Database error: {err}")),
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
