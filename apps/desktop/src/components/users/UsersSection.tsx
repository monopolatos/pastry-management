import { useState } from "react";
import type { FormEvent } from "react";
import { createUser } from "../../api/auth";
import type { UserRole } from "../../api/types";
import { useFormError } from "../../hooks/useFormError";

const KNOWN_FIELDS = ["username", "password", "role"] as const;
const ROLES: UserRole[] = ["owner", "admin", "employee"];

/**
 * Minimal "add user" form. Not the focus of this phase — there is no list-users command yet, so
 * this only supports creating additional accounts, restricted server-side to owner/admin
 * sessions (the calling code only renders this for such sessions, but the backend enforces it
 * regardless).
 */
export function UsersSection() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("employee");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const formError = useFormError();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    formError.clear();
    setSuccessMessage(null);
    setSubmitting(true);
    try {
      const user = await createUser(username, password, role);
      setSuccessMessage(`Created account "${user.username}" with role "${user.role}".`);
      setUsername("");
      setPassword("");
      setRole("employee");
    } catch (err) {
      formError.handle(err, KNOWN_FIELDS);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2>Add a user</h2>
      <form className="stacked-form" onSubmit={handleSubmit}>
        {formError.general && <p className="form-error">{formError.general}</p>}
        {successMessage && <p className="form-info">{successMessage}</p>}

        <label htmlFor="new-user-username">Username</label>
        <input
          id="new-user-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        {formError.fieldError("username") && (
          <p className="field-error">{formError.fieldError("username")}</p>
        )}

        <label htmlFor="new-user-password">Password</label>
        <input
          id="new-user-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {formError.fieldError("password") && (
          <p className="field-error">{formError.fieldError("password")}</p>
        )}

        <label htmlFor="new-user-role">Role</label>
        <select
          id="new-user-role"
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {formError.fieldError("role") && (
          <p className="field-error">{formError.fieldError("role")}</p>
        )}

        <button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create user"}
        </button>
      </form>
    </section>
  );
}
