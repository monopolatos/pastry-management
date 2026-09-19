import { useEffect, useState } from "react";
import * as authApi from "./api/auth";
import { AuthScreen } from "./components/auth/AuthScreen";
import { RawMaterialsScreen } from "./components/rawMaterials/RawMaterialsScreen";
import { SuppliersScreen } from "./components/suppliers/SuppliersScreen";
import { UsersSection } from "./components/users/UsersSection";
import type { SessionInfo } from "./api/types";
import "./App.css";

type Tab = "raw-materials" | "suppliers" | "users";

/**
 * Top-level app shell. Session state lives here in plain React state and nowhere else — the Rust
 * side keeps the session in memory only (no persistence across app restart), so the frontend
 * mirrors that instead of persisting it itself (e.g. in localStorage).
 */
function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("raw-materials");

  useEffect(() => {
    // Covers hot-reload during development, where the Rust process (and its in-memory session)
    // may already have an active session even though this component just mounted.
    authApi
      .currentSession()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setCheckingSession(false));
  }, []);

  async function handleLogout() {
    await authApi.logout();
    setSession(null);
    setActiveTab("raw-materials");
  }

  if (checkingSession) {
    return (
      <main className="container">
        <h1>Pastry Management</h1>
        <p>Loading…</p>
      </main>
    );
  }

  if (!session) {
    return <AuthScreen onAuthenticated={setSession} />;
  }

  const canManageUsers = session.user.role === "owner" || session.user.role === "admin";

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Pastry Management</h1>
        <div className="app-header-user">
          <span>
            {session.user.username} ({session.user.role})
          </span>
          <button type="button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <nav className="app-nav">
        <button
          type="button"
          className={activeTab === "raw-materials" ? "nav-tab active" : "nav-tab"}
          onClick={() => setActiveTab("raw-materials")}
        >
          Raw Materials
        </button>
        <button
          type="button"
          className={activeTab === "suppliers" ? "nav-tab active" : "nav-tab"}
          onClick={() => setActiveTab("suppliers")}
        >
          Suppliers
        </button>
        {canManageUsers && (
          <button
            type="button"
            className={activeTab === "users" ? "nav-tab active" : "nav-tab"}
            onClick={() => setActiveTab("users")}
          >
            Users
          </button>
        )}
      </nav>

      <main className="app-main">
        {activeTab === "raw-materials" && <RawMaterialsScreen />}
        {activeTab === "suppliers" && <SuppliersScreen />}
        {activeTab === "users" && canManageUsers && <UsersSection />}
      </main>
    </div>
  );
}

export default App;
