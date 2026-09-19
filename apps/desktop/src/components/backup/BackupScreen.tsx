import { DatabaseBackup } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

/**
 * Placeholder screen — Backup & Restore (local + cloud storage) is a whole separate phase
 * (Phase 6). This phase's job is just making the nav section exist and navigate correctly.
 */
export function BackupScreen() {
  const { t } = useI18n();

  return (
    <section className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseBackup className="size-4" />
            {t("backup.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("backup.notReady")}</p>
        </CardContent>
      </Card>
    </section>
  );
}
