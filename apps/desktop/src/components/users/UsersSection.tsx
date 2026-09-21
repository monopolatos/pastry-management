import { useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { createUser } from "../../api/auth";
import { USER_ROLE_LABEL_KEYS } from "../../api/types";
import type { UserRole } from "../../api/types";
import { useFormError } from "../../hooks/useFormError";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const KNOWN_FIELDS = ["username", "password", "role"] as const;
const ROLES: UserRole[] = ["owner", "admin", "employee"];

/**
 * Minimal "add user" form. Not the focus of this phase — there is no list-users command yet, so
 * this only supports creating additional accounts, restricted server-side to owner/admin
 * sessions (the calling code only renders this for such sessions, but the backend enforces it
 * regardless).
 */
export function UsersSection() {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("employee");
  const [submitting, setSubmitting] = useState(false);
  const formError = useFormError();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    formError.clear();
    setSubmitting(true);
    try {
      const user = await createUser(username, password, role);
      toast.success(
        t("users.createdSuccess")
          .replace("{username}", user.username)
          .replace("{role}", t(USER_ROLE_LABEL_KEYS[user.role])),
      );
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
    <section className="flex flex-col gap-4">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>{t("users.addUser")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            {formError.general && (
              <p className="text-sm font-medium text-destructive">{formError.general}</p>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-user-username">{t("auth.username")}</Label>
              <Input
                id="new-user-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
              {formError.fieldError("username") && (
                <p className="text-sm text-destructive">{formError.fieldError("username")}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-user-password">{t("auth.password")}</Label>
              <Input
                id="new-user-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {formError.fieldError("password") && (
                <p className="text-sm text-destructive">{formError.fieldError("password")}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-user-role">{t("users.role")}</Label>
              <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                <SelectTrigger id="new-user-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(USER_ROLE_LABEL_KEYS[r])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formError.fieldError("role") && (
                <p className="text-sm text-destructive">{formError.fieldError("role")}</p>
              )}
            </div>

            <div>
              <Button type="submit" disabled={submitting}>
                {submitting ? t("common.creating") : t("users.createUser")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
