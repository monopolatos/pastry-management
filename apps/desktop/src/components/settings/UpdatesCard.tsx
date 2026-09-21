import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import * as updatesApi from "../../api/updates";
import { toAppError } from "../../api/errors";
import type { UpdateCheckResult, UpdateSettings } from "../../api/types";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";

/**
 * Settings → Updates (Phase 9). Checking, downloading, and installing are three separate,
 * independently-toggleable steps (see src-tauri/src/commands/updates.rs and
 * docs/backup-and-updates.md §3) — restarting is always a fourth, explicit step triggered only by
 * the user clicking "Restart now" here, regardless of the auto-install setting.
 */
type CheckStage =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "ready-to-restart"
  | "error";

export function UpdatesCard() {
  const { t } = useI18n();

  const [currentVersion, setCurrentVersion] = useState<string | null>(null);

  const [settings, setSettings] = useState<UpdateSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);

  const [autoCheckEnabled, setAutoCheckEnabled] = useState(true);
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState(false);
  const [autoInstallEnabled, setAutoInstallEnabled] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [stage, setStage] = useState<CheckStage>("idle");
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);

  const applySettings = useCallback((s: UpdateSettings) => {
    setSettings(s);
    setAutoCheckEnabled(s.auto_check_enabled);
    setAutoDownloadEnabled(s.auto_download_enabled);
    setAutoInstallEnabled(s.auto_install_enabled);
  }, []);

  const refreshSettings = useCallback(() => {
    setSettingsLoading(true);
    setSettingsLoadError(null);
    updatesApi
      .getUpdateSettings()
      .then(applySettings)
      .catch((err) => setSettingsLoadError(toAppError(err).message))
      .finally(() => setSettingsLoading(false));
  }, [applySettings]);

  useEffect(() => {
    refreshSettings();
    updatesApi
      .getCurrentAppVersion()
      .then(setCurrentVersion)
      .catch(() => {});
  }, [refreshSettings]);

  async function handleSaveSettings(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setSettingsError(null);
    setSavingSettings(true);
    try {
      const updated = await updatesApi.updateUpdateSettings({
        auto_check_enabled: autoCheckEnabled,
        auto_download_enabled: autoDownloadEnabled,
        auto_install_enabled: autoInstallEnabled,
      });
      applySettings(updated);
      toast.success(t("common.save"));
    } catch (err) {
      setSettingsError(toAppError(err).message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleCheck() {
    setStage("checking");
    setStageError(null);
    try {
      const result = await updatesApi.checkForUpdate();
      setCheckResult(result);
      setStage(result.available ? "available" : "up-to-date");
    } catch (err) {
      setStageError(toAppError(err).message);
      setStage("error");
    }
  }

  async function handleDownload() {
    setStage("downloading");
    setStageError(null);
    try {
      await updatesApi.downloadUpdate();
      setStage("downloaded");
    } catch (err) {
      setStageError(toAppError(err).message);
      setStage("error");
    }
  }

  async function handleInstall() {
    setStage("installing");
    setStageError(null);
    try {
      await updatesApi.installUpdate();
      setStage("ready-to-restart");
    } catch (err) {
      setStageError(toAppError(err).message);
      setStage("error");
    }
  }

  async function handleRestart() {
    try {
      await updatesApi.restartApp();
    } catch (err) {
      setStageError(toAppError(err).message);
      setStage("error");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.updates")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {currentVersion && (
          <p className="text-sm text-muted-foreground">
            {t("settings.updatesCurrentVersion")}: v{currentVersion}
          </p>
        )}

        {settingsLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : settingsLoadError ? (
          <p className="text-sm font-medium text-destructive">{settingsLoadError}</p>
        ) : (
          <form className="flex max-w-xl flex-col gap-4" onSubmit={handleSaveSettings}>
            {settingsError && (
              <p className="text-sm font-medium text-destructive">{settingsError}</p>
            )}

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="updates-auto-check">{t("settings.updatesAutoCheck")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.updatesAutoCheckNote")}
                </p>
              </div>
              <Switch
                id="updates-auto-check"
                checked={autoCheckEnabled}
                onCheckedChange={setAutoCheckEnabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <Label htmlFor="updates-auto-download">{t("settings.updatesAutoDownload")}</Label>
              <Switch
                id="updates-auto-download"
                checked={autoDownloadEnabled}
                onCheckedChange={setAutoDownloadEnabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="updates-auto-install">{t("settings.updatesAutoInstall")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.updatesAutoInstallNote")}
                </p>
              </div>
              <Switch
                id="updates-auto-install"
                checked={autoInstallEnabled}
                onCheckedChange={setAutoInstallEnabled}
              />
            </div>

            <div>
              <Button type="submit" disabled={savingSettings}>
                {savingSettings ? t("common.loading") : t("common.save")}
              </Button>
            </div>
          </form>
        )}

        <div className="flex flex-col gap-3 border-t pt-4">
          {stage === "idle" && (
            <Button type="button" variant="outline" onClick={handleCheck} className="w-fit">
              <RefreshCw className="size-4" />
              {t("settings.updatesCheckNow")}
            </Button>
          )}

          {stage === "checking" && (
            <p className="text-sm text-muted-foreground">{t("settings.updatesChecking")}</p>
          )}

          {stage === "up-to-date" && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">{t("settings.updatesUpToDate")}</p>
              <Button type="button" variant="outline" size="sm" onClick={handleCheck}>
                {t("settings.updatesCheckNow")}
              </Button>
            </div>
          )}

          {stage === "available" && (
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium">
                {t("settings.updatesAvailable")}
                {checkResult?.version ? ` — v${checkResult.version}` : ""}
              </p>
              <Button type="button" onClick={handleDownload} size="sm">
                {t("settings.updatesDownload")}
              </Button>
            </div>
          )}

          {stage === "downloading" && (
            <p className="text-sm text-muted-foreground">{t("settings.updatesDownloading")}</p>
          )}

          {stage === "downloaded" && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">{t("settings.updatesReadyToInstall")}</p>
              <Button type="button" onClick={handleInstall} size="sm">
                {t("settings.updatesInstall")}
              </Button>
            </div>
          )}

          {stage === "installing" && (
            <p className="text-sm text-muted-foreground">{t("settings.updatesInstalling")}</p>
          )}

          {stage === "ready-to-restart" && (
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium">{t("settings.updatesReadyToRestart")}</p>
              <Button type="button" onClick={handleRestart} size="sm">
                {t("settings.updatesRestart")}
              </Button>
            </div>
          )}

          {stage === "error" && (
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium text-destructive">
                {stageError ?? t("settings.updatesError")}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={handleCheck}>
                {t("settings.updatesCheckNow")}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
