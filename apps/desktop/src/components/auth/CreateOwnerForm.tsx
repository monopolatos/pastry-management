import { useState } from "react";
import type { FormEvent } from "react";
import { createOwnerAccount } from "../../api/auth";
import { useFormError } from "../../hooks/useFormError";

interface CreateOwnerFormProps {
  onCreated: (username: string) => void;
}

const KNOWN_FIELDS = ["username", "password"] as const;

export function CreateOwnerForm({ onCreated }: CreateOwnerFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const formError = useFormError();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    formError.clear();

    if (password !== confirmPassword) {
      formError.handle({ message: "Passwords do not match.", field: "confirmPassword" }, [
        "confirmPassword",
      ]);
      return;
    }

    setSubmitting(true);
    try {
      const user = await createOwnerAccount(username, password);
      onCreated(user.username);
    } catch (err) {
      formError.handle(err, KNOWN_FIELDS);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="container">
      <h1>Pastry Management</h1>
      <p>No accounts exist yet. Create the owner account to get started.</p>
      <form className="stacked-form" onSubmit={handleSubmit}>
        {formError.general && <p className="form-error">{formError.general}</p>}

        <label htmlFor="owner-username">Username</label>
        <input
          id="owner-username"
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

        <label htmlFor="owner-password">Password</label>
        <input
          id="owner-password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {formError.fieldError("password") && (
          <p className="field-error">{formError.fieldError("password")}</p>
        )}

        <label htmlFor="owner-confirm-password">Confirm password</label>
        <input
          id="owner-confirm-password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
        {formError.fieldError("confirmPassword") && (
          <p className="field-error">{formError.fieldError("confirmPassword")}</p>
        )}

        <button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create owner account"}
        </button>
      </form>
    </main>
  );
}
