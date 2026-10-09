import { useEffect, useRef, useState } from "react";
import { ArrowUpCircle, X } from "lucide-react";
import * as updatesApi from "../../api/updates";
import type { UpdateProgress, UpdateProgressStage } from "../../api/types";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/button";

/**
 * A persistent, dismissible banner shown on every screen (mounted once in App.tsx) whenever an
 * update is available/downloaded/ready — not just on the Settings screen, where a *manually*
 * triggered check already shows its result inline. This is what surfaces an update found by the
 * silent, launch-time background check (see lib.rs's run_startup_update_check), which otherwise
 * has no visible effect until the user happens to open Settings.
 *
 * `getUpdateProgress()` on mount catches up on a stage change that already happened before this
 * component mounted/subscribed; `onUpdateProgress` then covers anything that happens afterward
 * (e.g. the launch-time check finishing a moment later, or finishing its auto-download/install
 * while the app is already open). Both read the exact same backend-held progress, so there's no
 * double-checking and no race between the two.
 *
 * Deliberately never restarts anything itself — install writes the update to disk, but applying
 * it always needs an explicit click on "Restart now" here, same guarantee commands::updates
 * already makes for the Settings screen's flow.
 */
export function UpdateBanner() {
  const { t, te } = useI18n();
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedStage, setDismissedStage] = useState<UpdateProgressStage | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    updatesApi
      .getUpdateProgress()
      .then((p) => {
        if (mountedRef.current) setProgress(p);
      })
      .catch(() => {});

    const unlistenPromise = updatesApi.onUpdateProgress((p) => {
      if (mountedRef.current) setProgress(p);
    });

    return () => {
      mountedRef.current = false;
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  if (!progress || progress.stage === "none" || progress.stage === dismissedStage) {
    return null;
  }

  const version = progress.version ?? "";

  async function runStep(step: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await step();
      const refreshed = await updatesApi.getUpdateProgress();
      if (mountedRef.current) setProgress(refreshed);
    } catch (err) {
      if (mountedRef.current) {
        setError(te(err));
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b bg-primary/10 px-4 py-2 text-sm">
      <ArrowUpCircle className="size-4 shrink-0 text-primary" />

      {progress.stage === "available" && (
        <>
          <span className="flex-1">
            {t("updateBanner.available").replace("{version}", version)}
          </span>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => runStep(() => updatesApi.downloadUpdate())}
          >
            {busy ? t("settings.updatesDownloading") : t("settings.updatesDownload")}
          </Button>
        </>
      )}

      {progress.stage === "downloaded" && (
        <>
          <span className="flex-1">
            {t("updateBanner.downloaded").replace("{version}", version)}
          </span>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => runStep(() => updatesApi.installUpdate())}
          >
            {busy ? t("settings.updatesInstalling") : t("settings.updatesInstall")}
          </Button>
        </>
      )}

      {progress.stage === "ready" && (
        <>
          <span className="flex-1">{t("updateBanner.ready").replace("{version}", version)}</span>
          <Button type="button" size="sm" onClick={() => updatesApi.restartApp()}>
            {t("settings.updatesRestart")}
          </Button>
        </>
      )}

      {error && <span className="text-destructive">{error}</span>}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        title={t("common.close")}
        onClick={() => setDismissedStage(progress.stage)}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
