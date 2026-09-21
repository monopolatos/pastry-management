import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { DatabaseBackup } from "lucide-react";
import { toast } from "sonner";
import * as backupApi from "../../api/backup";
import { toAppError } from "../../api/errors";
import type { AutoBackupFrequency, BackupInfo, BackupSettings } from "../../api/types";
import { useFormError } from "../../hooks/useFormError";
import { useI18n } from "../../lib/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { DropboxSection } from "./DropboxSection";
import { formatBytes, formatDateTime } from "./format";

const KNOWN_SETTINGS_FIELDS = ["retention_count", "auto_backup_frequency"] as const;

export function BackupScreen() {
  const { t } = useI18n();

  // Settings card state
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [autoBackupFrequency, setAutoBackupFrequency] = useState<AutoBackupFrequency | "">("");
  const [retentionCount, setRetentionCount] = useState("10");
  const [savingSettings, setSavingSettings] = useState(false);
  const [choosingFolder, setChoosingFolder] = useState(false);
  const formError = useFormError();

  // Backups list card state
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(true);
  const [backupsLoadError, setBackupsLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);

  const applySettings = useCallback((s: BackupSettings) => {
    setSettings(s);
    setAutoBackupEnabled(s.auto_backup_enabled);
    setAutoBackupFrequency(s.auto_backup_frequency ?? "");
    setRetentionCount(String(s.retention_count));
  }, []);

  const refreshSettings = useCallback(() => {
    setSettingsLoading(true);
    setSettingsLoadError(null);
    backupApi
      .getBackupSettings()
      .then(applySettings)
      .catch((err) => setSettingsLoadError(toAppError(err).message))
      .finally(() => setSettingsLoading(false));
  }, [applySettings]);

  const refreshBackups = useCallback(() => {
    setBackupsLoading(true);
    setBackupsLoadError(null);
    backupApi
      .listBackups()
      .then(setBackups)
      .catch((err) => setBackupsLoadError(toAppError(err).message))
      .finally(() => setBackupsLoading(false));
  }, []);

  useEffect(() => {
    refreshSettings();
    refreshBackups();
  }, [refreshSettings, refreshBackups]);

  async function handleChooseFolder() {
    if (!settings) return;
    formError.clear();
    setChoosingFolder(true);
    try {
      const picked = await backupApi.chooseBackupDirectory();
      if (picked !== null) {
        const updated = await backupApi.updateBackupSettings({
          local_path: picked,
          auto_backup_enabled: settings.auto_backup_enabled,
          auto_backup_frequency: settings.auto_backup_frequency,
          retention_count: settings.retention_count,
        });
        applySettings(updated);
        toast.success(t("backup.folderUpdated"));
      }
    } catch (err) {
      formError.handle(err, KNOWN_SETTINGS_FIELDS);
    } finally {
      setChoosingFolder(false);
    }
  }

  async function handleSaveSettings(event: FormEvent) {
    event.preventDefault();
    formError.clear();

    const retention = Number(retentionCount);
    if (!Number.isFinite(retention) || retention < 1) {
      formError.handle(
        { message: t("backup.retentionInvalid"), field: "retention_count" },
        KNOWN_SETTINGS_FIELDS,
      );
      return;
    }
    if (autoBackupEnabled && autoBackupFrequency === "") {
      formError.handle(
        { message: t("backup.frequencyRequired"), field: "auto_backup_frequency" },
        KNOWN_SETTINGS_FIELDS,
      );
      return;
    }

    setSavingSettings(true);
    try {
      const updated = await backupApi.updateBackupSettings({
        local_path: null,
        auto_backup_enabled: autoBackupEnabled,
        auto_backup_frequency: autoBackupFrequency === "" ? null : autoBackupFrequency,
        retention_count: Math.trunc(retention),
      });
      applySettings(updated);
      toast.success(t("backup.settingsSaved"));
    } catch (err) {
      formError.handle(err, KNOWN_SETTINGS_FIELDS);
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleCreateBackup() {
    setRowError(null);
    setCreating(true);
    try {
      await backupApi.createBackup(null);
      toast.success(t("backup.createSuccess"));
      refreshBackups();
    } catch (err) {
      setRowError(toAppError(err).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleValidate(backup: BackupInfo) {
    setRowError(null);
    setBusyPath(backup.path);
    try {
      const result = await backupApi.validateBackupFile(backup.path);
      toast.success(
        `${t("backup.validateSuccess")} v${result.app_version}, schema ${result.schema_version}, created ${formatDateTime(result.created_at)}`,
      );
    } catch (err) {
      setRowError(toAppError(err).message);
    } finally {
      setBusyPath(null);
    }
  }

  async function handleRestore(backup: BackupInfo) {
    setRowError(null);
    setBusyPath(backup.path);
    try {
      await backupApi.restoreBackup(backup.path);
      toast.success(t("backup.restoreSuccess"));
      refreshBackups();
    } catch (err) {
      setRowError(toAppError(err).message);
    } finally {
      setBusyPath(null);
    }
  }

  async function handleDelete(backup: BackupInfo) {
    setRowError(null);
    setBusyPath(backup.path);
    try {
      await backupApi.deleteBackup(backup.path);
      refreshBackups();
    } catch (err) {
      setRowError(toAppError(err).message);
    } finally {
      setBusyPath(null);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseBackup className="size-4" />
            {t("backup.settingsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {settingsLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : settingsLoadError ? (
            <p className="text-sm font-medium text-destructive">{settingsLoadError}</p>
          ) : (
            <form className="flex max-w-xl flex-col gap-4" onSubmit={handleSaveSettings}>
              {formError.general && (
                <p className="text-sm font-medium text-destructive">{formError.general}</p>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="backup-directory">{t("backup.directory")}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="backup-directory"
                    type="text"
                    value={settings?.local_path ?? ""}
                    readOnly
                    disabled
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleChooseFolder}
                    disabled={choosingFolder}
                  >
                    {choosingFolder ? t("common.loading") : t("backup.chooseFolder")}
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="backup-auto-enabled">{t("backup.autoBackup")}</Label>
                  <p className="text-xs text-muted-foreground">{t("backup.autoBackupHint")}</p>
                </div>
                <Switch
                  id="backup-auto-enabled"
                  checked={autoBackupEnabled}
                  onCheckedChange={setAutoBackupEnabled}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="backup-frequency">{t("backup.frequency")}</Label>
                <Select
                  value={autoBackupFrequency === "" ? undefined : autoBackupFrequency}
                  onValueChange={(value) => setAutoBackupFrequency(value as AutoBackupFrequency)}
                  disabled={!autoBackupEnabled}
                >
                  <SelectTrigger id="backup-frequency" className="w-48">
                    <SelectValue placeholder={t("backup.frequencyPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">{t("backup.frequencyDaily")}</SelectItem>
                    <SelectItem value="weekly">{t("backup.frequencyWeekly")}</SelectItem>
                  </SelectContent>
                </Select>
                {formError.fieldError("auto_backup_frequency") && (
                  <p className="text-sm text-destructive">
                    {formError.fieldError("auto_backup_frequency")}
                  </p>
                )}
              </div>

              <div className="flex max-w-40 flex-col gap-1.5">
                <Label htmlFor="backup-retention">{t("backup.retentionCount")}</Label>
                <Input
                  id="backup-retention"
                  type="number"
                  min={1}
                  step={1}
                  value={retentionCount}
                  onChange={(e) => setRetentionCount(e.target.value)}
                />
                {formError.fieldError("retention_count") && (
                  <p className="text-sm text-destructive">
                    {formError.fieldError("retention_count")}
                  </p>
                )}
              </div>

              <p className="text-xs text-muted-foreground">{t("backup.autoCheckNote")}</p>

              <div>
                <Button type="submit" disabled={savingSettings}>
                  {savingSettings ? t("common.loading") : t("backup.saveSettings")}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>{t("backup.backupsTitle")}</CardTitle>
          <Button type="button" onClick={handleCreateBackup} disabled={creating}>
            {creating ? t("common.loading") : t("backup.createNow")}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {rowError && <p className="text-sm font-medium text-destructive">{rowError}</p>}
          {backupsLoadError && (
            <p className="text-sm font-medium text-destructive">{backupsLoadError}</p>
          )}

          {backupsLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : backups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("backup.empty")}</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("backup.createdAt")}</TableHead>
                    <TableHead>{t("backup.size")}</TableHead>
                    <TableHead>{t("backup.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backups.map((backup) => {
                    const busy = busyPath === backup.path;
                    return (
                      <TableRow key={backup.path}>
                        <TableCell className="font-medium">
                          <div className="flex flex-wrap items-center gap-2">
                            {formatDateTime(backup.created_at)}
                            {backup.label && (
                              <Badge variant="secondary">{t("backup.preRestoreSafetyLabel")}</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{formatBytes(backup.size_bytes)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleValidate(backup)}
                              disabled={busy}
                            >
                              {t("backup.validate")}
                            </Button>

                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button type="button" variant="outline" size="sm" disabled={busy}>
                                  {t("backup.restore")}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    {t("backup.restoreConfirmTitle")}
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t("backup.restoreConfirmBody")}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                  <AlertDialogAction
                                    variant="destructive"
                                    onClick={() => handleRestore(backup)}
                                  >
                                    {t("backup.restore")}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>

                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  disabled={busy}
                                >
                                  {t("common.delete")}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    {t("backup.deleteConfirmTitle")}
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t("backup.deleteConfirmBody")}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                  <AlertDialogAction
                                    variant="destructive"
                                    onClick={() => handleDelete(backup)}
                                  >
                                    {t("common.delete")}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <DropboxSection localBackups={backups} onLocalBackupCreated={refreshBackups} />
    </section>
  );
}
