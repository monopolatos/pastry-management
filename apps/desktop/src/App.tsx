import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

/**
 * Placeholder shell for Phase 2 (project scaffolding). Confirms the frontend can reach the Rust
 * core and that the SQLite database opened and migrated successfully. Real navigation and screens
 * (Dashboard, Raw Materials, Suppliers, Recipes, ...) land in Phase 5 — see docs/roadmap.md.
 */
function App() {
  const [dbStatus, setDbStatus] = useState<string>("checking…");

  useEffect(() => {
    invoke<string>("db_status")
      .then(setDbStatus)
      .catch((err) => setDbStatus(`error: ${String(err)}`));
  }, []);

  return (
    <main className="container">
      <h1>Pastry Management</h1>
      <p>Database status: {dbStatus}</p>
    </main>
  );
}

export default App;
