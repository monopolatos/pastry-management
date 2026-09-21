import { useState } from "react";
import type { FormEvent } from "react";
import { createOwnerAccount } from "../../api/auth";
import { useFormError } from "../../hooks/useFormError";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

interface CreateOwnerFormProps {
  onCreated: (username: string) => void;
}

const KNOWN_FIELDS = ["username", "password"] as const;

export function CreateOwnerForm({ onCreated }: CreateOwnerFormProps) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const formError = useFormError();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    formError.clear();

    if (password !== confirmPassword) {
      formError.handle({ message: t("auth.passwordsDoNotMatch"), field: "confirmPassword" }, [
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
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center font-heading text-lg">{t("app.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">{t("auth.noAccountsYet")}</p>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            {formError.general && (
              <p className="text-sm font-medium text-destructive">{formError.general}</p>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="owner-username">{t("auth.username")}</Label>
              <Input
                id="owner-username"
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
              <Label htmlFor="owner-password">{t("auth.password")}</Label>
              <Input
                id="owner-password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {formError.fieldError("password") && (
                <p className="text-sm text-destructive">{formError.fieldError("password")}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="owner-confirm-password">{t("auth.confirmPassword")}</Label>
              <Input
                id="owner-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
              {formError.fieldError("confirmPassword") && (
                <p className="text-sm text-destructive">
                  {formError.fieldError("confirmPassword")}
                </p>
              )}
            </div>

            <Button type="submit" disabled={submitting} className="mt-2 w-full">
              {submitting ? t("auth.creatingAccount") : t("auth.createOwnerAccount")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
