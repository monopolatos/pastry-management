import { invoke } from "@tauri-apps/api/core";
import type { SessionInfo, UserPublic, UserRole } from "./types";

/**
 * Typed wrappers around the `commands::auth` Tauri commands. This is the only module that should
 * call `invoke()` for auth — components call these functions instead.
 */

export function setupRequired(): Promise<boolean> {
  return invoke("setup_required");
}

export function createOwnerAccount(username: string, password: string): Promise<UserPublic> {
  return invoke("create_owner_account", { username, password });
}

export function createUser(
  username: string,
  password: string,
  role: UserRole,
): Promise<UserPublic> {
  return invoke("create_user", { username, password, role });
}

export function login(username: string, password: string): Promise<SessionInfo> {
  return invoke("login", { username, password });
}

export function logout(): Promise<void> {
  return invoke("logout");
}

export function currentSession(): Promise<SessionInfo | null> {
  return invoke("current_session");
}

/**
 * Changes the current session's own password. The backend reads the caller's user id from the
 * session server-side — only the two password strings are passed. Rejects with the usual
 * `{ message, field }` shape: a wrong current password comes back with `field: "current_password"`,
 * a too-short new password with `field: "password"` (see src-tauri/src/auth/mod.rs).
 */
export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return invoke("change_password", { currentPassword, newPassword });
}
