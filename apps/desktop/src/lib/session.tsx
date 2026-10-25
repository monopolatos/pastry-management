import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { SessionInfo, UserRole } from "../api/types";

/**
 * Current signed-in user, available anywhere in the authenticated tree without prop-drilling
 * `session` through every screen — mirrors the `I18nProvider`/`useI18n` pattern already used for
 * locale. `role` gating here is a UX convenience (hiding buttons the user can't use); the actual
 * enforcement lives server-side in `auth::require_write_access`/`require_finance_access` — a
 * command is directly callable regardless of what this hides.
 */
interface SessionContextValue {
  session: SessionInfo;
  role: UserRole;
  /** Employees have read-only access to raw materials, recipes, suppliers, and their categories. */
  isReadOnly: boolean;
  /** Finance (expenses/income and their categories) is off-limits to employees entirely. */
  canSeeFinance: boolean;
  canManageUsers: boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: SessionInfo;
  children: ReactNode;
}) {
  const role = session.user.role;
  const value: SessionContextValue = {
    session,
    role,
    isReadOnly: role === "employee",
    canSeeFinance: role !== "employee",
    canManageUsers: role === "owner" || role === "admin",
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession() must be used within a SessionProvider");
  }
  return ctx;
}
