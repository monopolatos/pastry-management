import { useState } from "react";
import type { FormEvent } from "react";
import { login } from "../../api/auth";
import type { SessionInfo } from "../../api/types";
import { useFormError } from "../../hooks/useFormError";

interface LoginFormProps {
  initialUsername?: string;
  infoMessage?: string | null;
  onLoggedIn: (session: SessionInfo) => void;
}

const KNOWN_FIELDS = ["username", "password"] as const;

export function LoginForm({ initialUsername = "", infoMessage, onLoggedIn }: LoginFormProps) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const formError = useFormError();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    formError.clear();
    setSubmitting(true);
    try {
      const session = await login(username, password);
      onLoggedIn(session);
    } catch (err) {
      formError.handle(err, KNOWN_FIELDS);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="container">
      <h1>Pastry Management</h1>
      {infoMessage && <p className="form-info">{infoMessage}</p>}
      <form className="stacked-form" onSubmit={handleSubmit}>
        {formError.general && <p className="form-error">{formError.general}</p>}

        <label htmlFor="login-username">Username</label>
        <input
          id="login-username"
          name="username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        {formError.fieldError("username") && (
          <p className="field-error">{formError.fieldError("username")}</p>
        )}

        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {formError.fieldError("password") && (
          <p className="field-error">{formError.fieldError("password")}</p>
        )}

        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
