import { useEffect, useState } from "react";
import { setupRequired } from "../../api/auth";
import type { SessionInfo } from "../../api/types";
import { useI18n } from "../../lib/i18n";
import { CreateOwnerForm } from "./CreateOwnerForm";
import { LoginForm } from "./LoginForm";

interface AuthScreenProps {
  onAuthenticated: (session: SessionInfo) => void;
}

type Mode = "loading" | "create-owner" | "login";

/**
 * Orchestrates the unauthenticated experience: checks whether an owner account needs to be
 * created first, then shows either the create-owner form or the login form.
 */
export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("loading");
  const [prefillUsername, setPrefillUsername] = useState("");
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setupRequired()
      .then((required) => {
        if (!cancelled) {
          setMode(required ? "create-owner" : "login");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMode("login");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode === "loading") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 text-center">
        <h1 className="font-heading text-xl font-semibold">{t("app.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </main>
    );
  }

  if (mode === "create-owner") {
    return (
      <CreateOwnerForm
        onCreated={(username) => {
          setPrefillUsername(username);
          setInfoMessage(t("auth.accountCreatedPleaseSignIn"));
          setMode("login");
        }}
      />
    );
  }

  return (
    <LoginForm
      initialUsername={prefillUsername}
      infoMessage={infoMessage}
      onLoggedIn={onAuthenticated}
    />
  );
}
