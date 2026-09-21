import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Cloud } from "lucide-react";
import { toast } from "sonner";
import * as backupApi from "../../api/backup";
import * as cloudBackupApi from "../../api/cloudBackup";
import type {
  AutoBackupFrequency,
  BackupInfo,
  DropboxSettings,
  DropboxStatus,
  RemoteBackupHandle,
} from "../../api/types";
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
import { formatBytes, formatDateTime } from "./format";

const DROPBOX_APP_CONSOLE_URL = "https://www.dropbox.com/developers/apps";

const KNOWN_DROPBOX_SETTINGS_FIELDS = ["retention_count", "auto_backup_frequency"] as const;

interface DropboxSectionProps {
  /** The already-fetched local backups list, so "upload an existing backup" can offer them. */
  localBackups: BackupInfo[];
  /** Called after "Back up to Dropbox now" creates a new local backup, so the local list refreshes too. */
  onLocalBackupCreated: () => void;
}

/**
 * Dropbox cloud backup section of the Backup & Restore screen (Phase 7). Lives alongside local
 * backup, not as a separate nav item — see docs/backup-and-updates.md §2.
 *
 * Three honest connection states, since which one is active is genuinely unknown until the user
 * registers their own Dropbox app (§2b): no App Key saved yet ("not configured"), an App Key saved
 * but no account connected ("configured"), and a connected account ("connected").
 */
export function DropboxSection({ localBackups, onLocalBackupCreated }: DropboxSectionProps) {
  const { t, te } = useI18n();

  // Setup & connection card state
  const [settings, setSettings] = useState<DropboxSettings | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);

  const [appKeyInput, setAppKeyInput] = useState("");
  const [savingAppKey, setSavingAppKey] = useState(false);
  const appKeyFormError = useFormError();

  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [autoBackupFrequency, setAutoBackupFrequency] = useState<AutoBackupFrequency | "">("");
  const [retentionCount, setRetentionCount] = useState("10");
  const [savingSettings, setSavingSettings] = useState(false);
  const settingsFormError = useFormError();

  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Cloud backups list card state
  const [remoteBackups, setRemoteBackups] = useState<RemoteBackupHandle[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteLoadError, setRemoteLoadError] = useState<string | null>(null);
  const [remoteRowError, setRemoteRowError] = useState<string | null>(null);
  const [busyRemoteId, setBusyRemoteId] = useState<string | null>(null);
  const [selectedLocalPath, setSelectedLocalPath] = useState("");
  const [uploadingExisting, setUploadingExisting] = useState(false);
  const [backingUpNow, setBackingUpNow] = useState(false);

  const applyStatus = useCallback((status: DropboxStatus) => {
    setSettings(status.settings);
    setIsConnected(status.is_connected);
    setAppKeyInput(status.settings.app_key ?? "");
    setAutoBackupEnabled(status.settings.auto_backup_enabled);
    setAutoBackupFrequency(status.settings.auto_backup_frequency ?? "");
    setRetentionCount(String(status.settings.retention_count));
  }, []);

  const refreshStatus = useCallback(() => {
    setSettingsLoading(true);
    setSettingsLoadError(null);
    cloudBackupApi
      .getDropboxSettings()
      .then(applyStatus)
      .catch((err) => setSettingsLoadError(te(err)))
      .finally(() => setSettingsLoading(false));
  }, [applyStatus, te]);

  const refreshRemoteBackups = useCallback(() => {
    setRemoteLoading(true);
    setRemoteLoadError(null);
    cloudBackupApi
      .dropboxListBackups()
      .then(setRemoteBackups)
      .catch((err) => setRemoteLoadError(te(err)))
      .finally(() => setRemoteLoading(false));
  }, [te]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (isConnected) {
      refreshRemoteBackups();
    } else {
      setRemoteBackups([]);
    }
  }, [isConnected, refreshRemoteBackups]);

  async function handleOpenConsole() {
    try {
      await openUrl(DROPBOX_APP_CONSOLE_URL);
    } catch {
      // Best-effort — the URL is also printed as plain text below for the user to copy manually.
    }
  }

  async function handleSaveAppKey(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    appKeyFormError.clear();
    setSavingAppKey(true);
    try {
      const updated = await cloudBackupApi.updateDropboxSettings({
        app_key: appKeyInput.trim(),
        auto_backup_enabled: settings.auto_backup_enabled,
        auto_backup_frequency: settings.auto_backup_frequency,
        retention_count: settings.retention_count,
      });
      applyStatus(updated);
      toast.success(t("backup.dropboxAppKeySaved"));
    } catch (err) {
      appKeyFormError.handle(err, []);
    } finally {
      setSavingAppKey(false);
    }
  }

  async function handleSaveSettings(event: FormEvent) {
    event.preventDefault();
    settingsFormError.clear();

    const retention = Number(retentionCount);
    if (!Number.isFinite(retention) || retention < 1) {
      settingsFormError.handle(
        { message: t("backup.retentionInvalid"), field: "retention_count" },
        KNOWN_DROPBOX_SETTINGS_FIELDS,
      );
      return;
    }
    if (autoBackupEnabled && autoBackupFrequency === "") {
      settingsFormError.handle(
        { message: t("backup.frequencyRequired"), field: "auto_backup_frequency" },
        KNOWN_DROPBOX_SETTINGS_FIELDS,
      );
      return;
    }

    setSavingSettings(true);
    try {
      const updated = await cloudBackupApi.updateDropboxSettings({
        app_key: null,
        auto_backup_enabled: autoBackupEnabled,
        auto_backup_frequency: autoBackupFrequency === "" ? null : autoBackupFrequency,
        retention_count: Math.trunc(retention),
      });
      applyStatus(updated);
      toast.success(t("backup.dropboxSettingsSaved"));
    } catch (err) {
      settingsFormError.handle(err, KNOWN_DROPBOX_SETTINGS_FIELDS);
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleConnect() {
    setConnectionError(null);
    setConnecting(true);
    try {
      const status = await cloudBackupApi.dropboxConnect();
      applyStatus(status);
      toast.success(t("backup.dropboxConnectSuccess"));
    } catch (err) {
      setConnectionError(te(err));
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setConnectionError(null);
    setDisconnecting(true);
    try {
      const status = await cloudBackupApi.dropboxDisconnect();
      applyStatus(status);
      toast.success(t("backup.dropboxDisconnectSuccess"));
    } catch (err) {
      setConnectionError(te(err));
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleTestConnection() {
    setConnectionError(null);
    setTestingConnection(true);
    try {
      await cloudBackupApi.dropboxTestConnection();
      toast.success(t("backup.dropboxTestSuccess"));
    } catch (err) {
      toast.error(te(err));
    } finally {
      setTestingConnection(false);
    }
  }

  async function handleUploadExisting() {
    if (!selectedLocalPath) return;
    setRemoteRowError(null);
    setUploadingExisting(true);
    try {
      await cloudBackupApi.dropboxUploadBackup(selectedLocalPath);
      toast.success(t("backup.dropboxUploadSuccess"));
      setSelectedLocalPath("");
      refreshRemoteBackups();
    } catch (err) {
      setRemoteRowError(te(err));
    } finally {
      setUploadingExisting(false);
    }
  }

  async function handleBackupNow() {
    setRemoteRowError(null);
    setBackingUpNow(true);
    try {
      const info = await backupApi.createBackup(null);
      onLocalBackupCreated();
      await cloudBackupApi.dropboxUploadBackup(info.path);
      toast.success(t("backup.dropboxBackupNowSuccess"));
      refreshRemoteBackups();
    } catch (err) {
      setRemoteRowError(te(err));
    } finally {
      setBackingUpNow(false);
    }
  }

  async function handleRestore(handle: RemoteBackupHandle) {
    setRemoteRowError(null);
    setBusyRemoteId(handle.id);
    try {
      await cloudBackupApi.dropboxRestoreBackup(handle.id, handle.name);
      toast.success(t("backup.dropboxRestoreSuccess"));
    } catch (err) {
      setRemoteRowError(te(err));
    } finally {
      setBusyRemoteId(null);
    }
  }

  async function handleDelete(handle: RemoteBackupHandle) {
    setRemoteRowError(null);
    setBusyRemoteId(handle.id);
    try {
      await cloudBackupApi.dropboxDeleteBackup(handle.id);
      refreshRemoteBackups();
    } catch (err) {
      setRemoteRowError(te(err));
    } finally {
      setBusyRemoteId(null);
    }
  }

  const hasAppKey = !!settings?.app_key;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="size-4" />
            {t("backup.dropboxTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {settingsLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : settingsLoadError ? (
            <p className="text-sm font-medium text-destructive">{settingsLoadError}</p>
          ) : (
            <div className="flex max-w-xl flex-col gap-5">
              <div className="flex flex-col gap-1.5 rounded-lg border p-3">
                <p className="text-sm text-muted-foreground">{t("backup.dropboxIntro")}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleOpenConsole}>
                    {t("backup.dropboxOpenConsole")}
                  </Button>
                  <code className="text-xs text-muted-foreground">{DROPBOX_APP_CONSOLE_URL}</code>
                </div>
              </div>

              <form className="flex flex-col gap-1.5" onSubmit={handleSaveAppKey}>
                <Label htmlFor="dropbox-app-key">{t("backup.dropboxAppKey")}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="dropbox-app-key"
                    type="text"
                    value={appKeyInput}
                    onChange={(e) => setAppKeyInput(e.target.value)}
                    placeholder={t("backup.dropboxAppKeyPlaceholder")}
                    className="font-mono text-xs"
                  />
                  <Button type="submit" variant="outline" disabled={savingAppKey}>
                    {savingAppKey ? t("common.loading") : t("backup.dropboxAppKeySave")}
                  </Button>
                </div>
                {appKeyFormError.general && (
                  <p className="text-sm font-medium text-destructive">{appKeyFormError.general}</p>
                )}
              </form>

              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <Label>{t("backup.dropboxStatus")}</Label>
                {!hasAppKey ? (
                  <div className="flex flex-col gap-1">
                    <Badge variant="secondary" className="w-fit">
                      {t("backup.dropboxStatusNotConfigured")}
                    </Badge>
                    <p className="text-xs text-muted-foreground">
                      {t("backup.dropboxStatusNotConfiguredHint")}
                    </p>
                  </div>
                ) : isConnected ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="w-fit">{t("backup.dropboxStatusConnected")}</Badge>
                      {settings?.cloud_account_label && (
                        <span className="text-sm text-muted-foreground">
                          {t("backup.dropboxConnectedAs")} {settings.cloud_account_label}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleTestConnection}
                        disabled={testingConnection}
                      >
                        {testingConnection
                          ? t("common.loading")
                          : t("backup.dropboxTestConnection")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleDisconnect}
                        disabled={disconnecting}
                      >
                        {disconnecting ? t("common.loading") : t("backup.dropboxDisconnect")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Badge variant="secondary" className="w-fit">
                      {t("backup.dropboxStatusConfigured")}
                    </Badge>
                    <div>
                      <Button type="button" onClick={handleConnect} disabled={connecting}>
                        {connecting ? t("backup.dropboxConnecting") : t("backup.dropboxConnect")}
                      </Button>
                    </div>
                  </div>
                )}
                {connectionError && (
                  <p className="text-sm font-medium text-destructive">{connectionError}</p>
                )}
              </div>

              <form className="flex flex-col gap-4" onSubmit={handleSaveSettings}>
                {settingsFormError.general && (
                  <p className="text-sm font-medium text-destructive">
                    {settingsFormError.general}
                  </p>
                )}

                <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="dropbox-auto-enabled">{t("backup.dropboxAutoBackup")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("backup.dropboxAutoBackupHint")}
                    </p>
                  </div>
                  <Switch
                    id="dropbox-auto-enabled"
                    checked={autoBackupEnabled}
                    onCheckedChange={setAutoBackupEnabled}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="dropbox-frequency">{t("backup.frequency")}</Label>
                  <Select
                    value={autoBackupFrequency === "" ? undefined : autoBackupFrequency}
                    onValueChange={(value) => setAutoBackupFrequency(value as AutoBackupFrequency)}
                    disabled={!autoBackupEnabled}
                  >
                    <SelectTrigger id="dropbox-frequency" className="w-48">
                      <SelectValue placeholder={t("backup.frequencyPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">{t("backup.frequencyDaily")}</SelectItem>
                      <SelectItem value="weekly">{t("backup.frequencyWeekly")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {settingsFormError.fieldError("auto_backup_frequency") && (
                    <p className="text-sm text-destructive">
                      {settingsFormError.fieldError("auto_backup_frequency")}
                    </p>
                  )}
                </div>

                <div className="flex max-w-40 flex-col gap-1.5">
                  <Label htmlFor="dropbox-retention">{t("backup.retentionCount")}</Label>
                  <Input
                    id="dropbox-retention"
                    type="number"
                    min={1}
                    step={1}
                    value={retentionCount}
                    onChange={(e) => setRetentionCount(e.target.value)}
                  />
                  {settingsFormError.fieldError("retention_count") && (
                    <p className="text-sm text-destructive">
                      {settingsFormError.fieldError("retention_count")}
                    </p>
                  )}
                </div>

                <div>
                  <Button type="submit" disabled={savingSettings}>
                    {savingSettings ? t("common.loading") : t("backup.dropboxSaveSettings")}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
          <CardTitle>{t("backup.dropboxBackupsTitle")}</CardTitle>
          {isConnected && (
            <Button type="button" onClick={handleBackupNow} disabled={backingUpNow}>
              {backingUpNow ? t("common.loading") : t("backup.dropboxBackupNow")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!isConnected ? (
            <p className="text-sm text-muted-foreground">{t("backup.dropboxConnectFirst")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="dropbox-upload-existing">
                    {t("backup.dropboxUploadExisting")}
                  </Label>
                  <Select
                    value={selectedLocalPath === "" ? undefined : selectedLocalPath}
                    onValueChange={setSelectedLocalPath}
                    disabled={localBackups.length === 0 || uploadingExisting}
                  >
                    <SelectTrigger id="dropbox-upload-existing" className="w-72">
                      <SelectValue placeholder={t("backup.dropboxSelectLocalBackup")} />
                    </SelectTrigger>
                    <SelectContent>
                      {localBackups.map((backup) => (
                        <SelectItem key={backup.path} value={backup.path}>
                          {formatDateTime(backup.created_at)} ({formatBytes(backup.size_bytes)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleUploadExisting}
                  disabled={!selectedLocalPath || uploadingExisting}
                >
                  {uploadingExisting ? t("common.loading") : t("backup.dropboxUploadButton")}
                </Button>
              </div>

              {remoteRowError && (
                <p className="text-sm font-medium text-destructive">{remoteRowError}</p>
              )}
              {remoteLoadError && (
                <p className="text-sm font-medium text-destructive">{remoteLoadError}</p>
              )}

              {remoteLoading ? (
                <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
              ) : remoteBackups.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("backup.dropboxEmpty")}</p>
              ) : (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("backup.dropboxName")}</TableHead>
                        <TableHead>{t("backup.size")}</TableHead>
                        <TableHead>{t("backup.dropboxModified")}</TableHead>
                        <TableHead>{t("backup.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {remoteBackups.map((handle) => {
                        const busy = busyRemoteId === handle.id;
                        return (
                          <TableRow key={handle.id}>
                            <TableCell className="font-medium">{handle.name}</TableCell>
                            <TableCell>{formatBytes(handle.size_bytes)}</TableCell>
                            <TableCell>{formatDateTime(handle.modified_at)}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-2">
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      disabled={busy}
                                    >
                                      {t("backup.restore")}
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>
                                        {t("backup.dropboxRestoreConfirmTitle")}
                                      </AlertDialogTitle>
                                      <AlertDialogDescription>
                                        {t("backup.dropboxRestoreConfirmBody")}
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                      <AlertDialogAction
                                        variant="destructive"
                                        onClick={() => handleRestore(handle)}
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
                                        {t("backup.dropboxDeleteConfirmTitle")}
                                      </AlertDialogTitle>
                                      <AlertDialogDescription>
                                        {t("backup.dropboxDeleteConfirmBody")}
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                      <AlertDialogAction
                                        variant="destructive"
                                        onClick={() => handleDelete(handle)}
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
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
