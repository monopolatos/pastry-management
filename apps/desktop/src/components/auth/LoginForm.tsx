import { useState } from "react";
import type { FormEvent } from "react";
import { login } from "../../api/auth";
import type { SessionInfo } from "../../api/types";
import { useFormError } from "../../hooks/useFormError";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

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
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center font-heading text-lg">Pastry Management</CardTitle>
        </CardHeader>
        <CardContent>
          {infoMessage && <p className="mb-4 text-sm font-medium text-primary">{infoMessage}</p>}
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            {formError.general && (
              <p className="text-sm font-medium text-destructive">{formError.general}</p>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-username">Username</Label>
              <Input
                id="login-username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
              {formError.fieldError("username") && (
                <p className="text-sm text-destructive">{formError.fieldError("username")}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {formError.fieldError("password") && (
                <p className="text-sm text-destructive">{formError.fieldError("password")}</p>
              )}
            </div>

            <Button type="submit" disabled={submitting} className="mt-2 w-full">
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
