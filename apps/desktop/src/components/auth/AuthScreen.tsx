import { useEffect, useState } from "react";
import { setupRequired } from "../../api/auth";
import type { SessionInfo } from "../../api/types";
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
      <main className="container">
        <h1>Pastry Management</h1>
        <p>Loading…</p>
      </main>
    );
  }

  if (mode === "create-owner") {
    return (
      <CreateOwnerForm
        onCreated={(username) => {
          setPrefillUsername(username);
          setInfoMessage("Account created. Please sign in.");
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
