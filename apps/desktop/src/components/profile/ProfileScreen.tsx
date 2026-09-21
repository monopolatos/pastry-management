import { useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { changePassword } from "../../api/auth";
import { USER_ROLE_LABEL_KEYS } from "../../api/types";
import type { SessionInfo } from "../../api/types";
import { useFormError } from "../../hooks/useFormError";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

interface ProfileScreenProps {
  session: SessionInfo;
}

const KNOWN_FIELDS = ["current_password", "password"] as const;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export function ProfileScreen({ session }: ProfileScreenProps) {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const formError = useFormError();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    formError.clear();

    if (newPassword !== confirmPassword) {
      formError.handle({ message: t("profile.passwordMismatch"), field: "confirmPassword" }, [
        "confirmPassword",
      ]);
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast.success(t("profile.passwordChanged"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      formError.handle(err, KNOWN_FIELDS);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("profile.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="font-medium text-muted-foreground">{t("profile.username")}</dt>
            <dd>{session.user.username}</dd>
            <dt className="font-medium text-muted-foreground">{t("profile.role")}</dt>
            <dd className="capitalize">{t(USER_ROLE_LABEL_KEYS[session.user.role])}</dd>
            <dt className="font-medium text-muted-foreground">{t("profile.createdAt")}</dt>
            <dd>{formatDate(session.user.created_at)}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("profile.changePassword")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex max-w-sm flex-col gap-4" onSubmit={handleSubmit}>
            {formError.general && (
              <p className="text-sm font-medium text-destructive">{formError.general}</p>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="profile-current-password">{t("profile.currentPassword")}</Label>
              <Input
                id="profile-current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
              {formError.fieldError("current_password") && (
                <p className="text-sm text-destructive">
                  {formError.fieldError("current_password")}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="profile-new-password">{t("profile.newPassword")}</Label>
              <Input
                id="profile-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
              {formError.fieldError("password") && (
                <p className="text-sm text-destructive">{formError.fieldError("password")}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="profile-confirm-password">{t("profile.confirmPassword")}</Label>
              <Input
                id="profile-confirm-password"
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

            <div>
              <Button type="submit" disabled={submitting}>
                {submitting ? t("common.loading") : t("profile.changePasswordAction")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
