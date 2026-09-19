use tauri::State;

use crate::auth::{self, SessionInfo, SessionState, UserPublic};
use crate::error::AppResult;
use crate::DbState;

#[tauri::command]
pub fn setup_required(db: State<DbState>) -> AppResult<bool> {
    let conn =
        db.0.lock()
            .map_err(|e| crate::error::AppError::new(e.to_string()))?;
    Ok(auth::user_count(&conn)? == 0)
}

#[tauri::command]
pub fn create_owner_account(
    db: State<DbState>,
    username: String,
    password: String,
) -> AppResult<UserPublic> {
    let conn =
        db.0.lock()
            .map_err(|e| crate::error::AppError::new(e.to_string()))?;
    auth::create_owner_account(&conn, &username, &password)
}

#[tauri::command]
pub fn login(
    db: State<DbState>,
    session: State<SessionState>,
    username: String,
    password: String,
) -> AppResult<SessionInfo> {
    let conn =
        db.0.lock()
            .map_err(|e| crate::error::AppError::new(e.to_string()))?;
    let user = auth::authenticate(&conn, &username, &password)?;

    let session_info = SessionInfo {
        token: uuid::Uuid::new_v4().to_string(),
        user,
        issued_at: chrono::Utc::now().to_rfc3339(),
    };

    let mut guard = session
        .0
        .lock()
        .map_err(|e| crate::error::AppError::new(e.to_string()))?;
    *guard = Some(session_info.clone());

    Ok(session_info)
}

/// Creates an additional user account. Restricted to an owner/admin caller — anyone else's
/// session is rejected before the repository layer is even touched.
#[tauri::command]
pub fn create_user(
    db: State<DbState>,
    session: State<SessionState>,
    username: String,
    password: String,
    role: String,
) -> AppResult<UserPublic> {
    let guard = session
        .0
        .lock()
        .map_err(|e| crate::error::AppError::new(e.to_string()))?;
    let caller_role = guard
        .as_ref()
        .map(|s| s.user.role.as_str())
        .ok_or_else(|| crate::error::AppError::new("You must be signed in to do that."))?;
    if caller_role != "owner" && caller_role != "admin" {
        return Err(crate::error::AppError::new(
            "Only an owner or admin can create new user accounts.",
        ));
    }
    drop(guard);

    let conn =
        db.0.lock()
            .map_err(|e| crate::error::AppError::new(e.to_string()))?;
    auth::create_user(&conn, &username, &password, &role)
}

#[tauri::command]
pub fn change_password(
    db: State<DbState>,
    session: State<SessionState>,
    current_password: String,
    new_password: String,
) -> AppResult<()> {
    let user_id = session
        .0
        .lock()
        .map_err(|e| crate::error::AppError::new(e.to_string()))?
        .as_ref()
        .map(|s| s.user.id)
        .ok_or_else(|| crate::error::AppError::new("You must be signed in to do that."))?;

    let conn =
        db.0.lock()
            .map_err(|e| crate::error::AppError::new(e.to_string()))?;
    auth::change_password(&conn, user_id, &current_password, &new_password)
}

#[tauri::command]
pub fn logout(session: State<SessionState>) -> AppResult<()> {
    let mut guard = session
        .0
        .lock()
        .map_err(|e| crate::error::AppError::new(e.to_string()))?;
    *guard = None;
    Ok(())
}

#[tauri::command]
pub fn current_session(session: State<SessionState>) -> AppResult<Option<SessionInfo>> {
    let guard = session
        .0
        .lock()
        .map_err(|e| crate::error::AppError::new(e.to_string()))?;
    Ok(guard.clone())
}
