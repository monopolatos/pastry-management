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
