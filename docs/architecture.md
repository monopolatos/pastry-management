# Pastry Management — Architecture & Technology Decision (Phase 1)

Status: **APPROVED.** Decisions locked in: Tauri + React + TS, Dropbox-only cloud backup for v1 (Google Drive interface-complete but deferred), phase-by-phase implementation with a checkpoint after each phase.

## 1. Technology Stack Decision

| Concern                      | Choice                                                                                                                                                                                      | Rationale                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop shell                | **Tauri 2.x** (Rust core + native OS webview)                                                                                                                                               | Smaller binaries (~10-20MB vs 100MB+ for Electron), no bundled Chromium/Node attack surface, native process isolation between the untrusted webview (frontend) and the privileged Rust core, first-class official updater with Ed25519 signature verification, strong GitHub Actions support via `tauri-apps/tauri-action`. |
| UI                           | **React 18 + TypeScript**, Vite bundler                                                                                                                                                     | Mature ecosystem, easy to find contributors, works identically to a normal SPA inside Tauri's webview.                                                                                                                                                                                                                      |
| UI components                | **shadcn/ui + Tailwind CSS**                                                                                                                                                                | Accessible primitives (Radix), no heavy runtime, easy to theme (EL/EN, light/dark).                                                                                                                                                                                                                                         |
| Business logic ("core")      | **Pure TypeScript package**, zero I/O, zero React/Tauri imports                                                                                                                             | Keeps the costing engine, unit conversion, and domain validation independently unit-testable (Vitest) and reusable regardless of UI framework.                                                                                                                                                                              |
| Local database               | **SQLite**, accessed from the Rust core via `rusqlite` (synchronous, no async runtime coupling for a single-user embedded DB) and exposed to the frontend only through typed Tauri commands | Rust owns the only DB connection — the webview never gets raw SQL access, which closes off SQL-injection-via-frontend and lets us keep migrations, transactions, and integrity checks in one trusted place. All queries use parameter binding, never string-concatenated SQL.                                               |
| Monetary/quantity math       | **decimal.js** in `core`, persisted as scaled integers (see §Database)                                                                                                                      | Avoids IEEE-754 float error (`0.1 + 0.2` class bugs) for money and fractional-gram unit costs.                                                                                                                                                                                                                              |
| Password hashing             | **Argon2id** (Rust `argon2` crate), computed only in the Rust core                                                                                                                          | Never hash/verify passwords in JS; the webview never sees the password hash.                                                                                                                                                                                                                                                |
| Secrets (cloud OAuth tokens) | OS-native secret store via Rust `keyring` crate (Windows Credential Manager / macOS Keychain / Linux Secret Service, libsecret)                                                             | Tokens never touch the SQLite file or app config JSON in plaintext.                                                                                                                                                                                                                                                         |
| Auto-update                  | **`tauri-plugin-updater`** against GitHub Releases, Ed25519 signing                                                                                                                         | Official, maintained mechanism; rejects unsigned/tampered artifacts by construction.                                                                                                                                                                                                                                        |
| CI/CD                        | **GitHub Actions** + `tauri-apps/tauri-action`                                                                                                                                              | One action builds, signs, and drafts the GitHub Release for Windows/macOS/Linux in a matrix.                                                                                                                                                                                                                                |
| Package manager / monorepo   | **pnpm workspaces** (no Turborepo/Nx)                                                                                                                                                       | Enough to share the `core` package between the app and its test suite without adding build-system complexity we don't need yet.                                                                                                                                                                                             |

### Why not Electron

Electron was seriously considered. It has broader real-world precedent for exactly this kind of app (e.g. many POS/inventory tools), and its ecosystem for Node-based cloud SDKs (official Dropbox/Google SDKs are JS-first) is more mature than Rust's. The trade-offs:

- Electron ships a full Chromium + Node runtime per app (~120-200MB installers, higher RAM/CPU baseline).
- Node running with full OS access in the same process as (or a short IPC hop from) UI code widens the attack surface for supply-chain-compromised npm dependencies.
- `electron-updater` is workable but its signing/notarization story is more manual to wire correctly across all three OSes than Tauri's built-in updater plugin.

**Decision: Tauri.** The one real cost is that Rust is required for the core/native layer, which is a smaller pool of contributors than "anyone who knows Node." Given this is a from-scratch commercial-grade app prioritizing security and long-term maintainability (explicit requirements), that trade is accepted. This is flagged as the single highest-impact reversible-with-effort decision — see Risks.

## 2. Module Architecture (Hexagonal / Ports & Adapters)

```
apps/desktop/
├── src-tauri/                 # Rust core (the only trusted process)
│   ├── db/                    # rusqlite connection pool, migration runner, repositories
│   ├── auth/                  # Argon2id hashing, session tokens
│   ├── backup/                # local backup engine (zip, manifest, restore)
│   ├── cloud/                 # BackupStorageProvider trait + Dropbox/GDrive adapters
│   ├── updater/                # thin wrapper around tauri-plugin-updater
│   ├── secrets/                # keyring-backed secret store
│   └── commands.rs            # Tauri command surface (typed, validated, the ONLY
│                               # boundary the frontend can cross)
└── src/                        # React + TS frontend (untrusted-by-design)
    ├── pages/                  # Dashboard, RawMaterials, Suppliers, Recipes, ...
    ├── components/
    ├── api/                    # typed wrappers around `invoke()` — the single
    │                           # place that talks to src-tauri
    └── state/                  # app/session state (React Query for server-state)

packages/core/                  # pure TypeScript, no I/O, no React, no Tauri
├── costing/                    # recipe costing engine (see costing-engine.md)
├── units/                      # measurement conversion (weight/volume/count)
├── pricing/                    # purchase-price strategy resolution
├── domain/                     # entities, value objects, validation
└── ports/                      # interfaces the engine depends on (repositories),
                                 # implemented by src-tauri/commands on one side and
                                 # by in-memory fakes in tests on the other
```

**Why this shape satisfies the stated constraints:**

- _"Business logic must not be tightly coupled to the UI"_: `packages/core` imports nothing from `apps/desktop`. The React layer imports `core` and calls it with data it already fetched.
- _"Costing engine must be independently testable"_: it's a pure function pipeline (`RawMaterial[] × Recipe[] × PricingStrategy → CostBreakdown`) — testable with Vitest with zero mocking of Tauri/SQLite.
- _"Backup engine independent of storage providers"_: `BackupStorageProvider` is a Rust trait; local disk, Dropbox, and Google Drive are three interchangeable implementations behind it.
- _"Update service independent of UI"_: the updater lives in `src-tauri/updater`, exposes `check / download / install` commands; the Settings UI is just a view over that state machine.

## 3. Authentication Model (documented per §6 requirement)

- **Local-first, single SQLite-backed user table.** No external identity provider in v1.
- **Account creation:** first launch runs a "Create Owner Account" setup wizard (username + password) instead of a seeded default credential. Additional accounts can be added later from Settings → Users (schema already supports roles, see database-schema.md).
- **Where credentials live:** `users` table in the same SQLite database as business data (`password_hash`, `password_algo`, `role`, timestamps). Only the Argon2id hash is stored — never the plaintext password.
- **Password hashing:** Argon2id, computed in Rust, with per-user random salt and tuned memory/iteration cost.
- **Session:** an in-memory session token issued on login, held by the Rust core and mirrored to the frontend as opaque state; expires on logout or app close. No persistent "remember me" token in v1 (flagged as a documented limitation, not an oversight).
- **Password recovery:** **not supported in v1** for a local single-machine app (there is no email/SMS channel to recover through). Documented limitation: if the password is lost, an administrator-role user (or, if none exists, deleting the `users` row via a documented recovery CLI flag) is required. This is called out explicitly in the README rather than silently assumed.
- **RBAC groundwork:** `users.role` (`owner | admin | employee`) and a `permissions` concept are part of the schema from day one; only `owner`/`admin` vs `employee` gating is enforced in v1 UI (e.g., employees can't edit purchase prices or delete recipes), but the table design allows finer-grained permissions later without a schema rewrite.
- **Documented limitation:** local authentication protects against casual multi-employee misuse (e.g., an employee accidentally editing costs), **not** against someone with OS-level/physical access to the machine or the raw SQLite file. Full-disk encryption (BitLocker/FileVault/LUKS) is recommended in the README as the actual boundary for that threat.

## 4. AI Subagent Task Breakdown (Phase-by-phase)

Each phase below lists which specialized subagent(s) own it and what runs in parallel vs sequentially. The orchestrator (this session) reviews every subagent's diff before merging and runs the test suite after each phase — a subagent's self-report of "done" is never taken as verification.

| Phase                                                                   | Owner subagent(s)                                        | Parallelizable with                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. Architecture (this doc)                                              | Project Architect                                        | —                                                                    |
| 2. Project init (monorepo, tooling, migrations skeleton, CI skeleton)   | DevOps/CI-CD Engineer + Database Architect               | — (sequential, everything depends on this)                           |
| 3. Core data (raw materials, suppliers, purchases, price history, auth) | Business Logic Developer + Database Architect            | Recipe engine scaffolding can start once schema lands                |
| 4. Costing engine (nested recipes, cycle detection, breakdown)          | Recipe Costing Engine Developer + Test Engineer          | Runs in parallel with Phase 3's UI once `core` interfaces are frozen |
| 5. UI                                                                   | Frontend/UI Developer                                    | Parallel per-screen once Phase 3/4 APIs exist                        |
| 6. Backups (local)                                                      | Backup & Cloud Integration Developer                     | Parallel with Phase 5                                                |
| 7. Cloud integrations                                                   | Backup & Cloud Integration Developer                     | Sequential after Phase 6 (reuses its abstraction)                    |
| 8. CI/CD & packaging                                                    | DevOps/CI-CD Engineer                                    | Can start scaffolding in parallel with Phase 3 onward                |
| 9. Auto-updates                                                         | DevOps/CI-CD Engineer + Security Engineer                | After Phase 8's signing keys exist                                   |
| 10. Security & final validation                                         | Security Engineer + Code Reviewer + Integration Engineer | After all above                                                      |

Code Reviewer and Test Engineer are cross-cutting: every subagent's output is reviewed and tested before being considered merged, not just at the end.

## 5. GitHub Actions Strategy

- `ci.yml` — on every push & PR: `pnpm install`, `eslint`, `tsc --noEmit`, `cargo check`/`clippy`, `vitest run` (core unit tests), `cargo test` (Rust integration tests: DB, backup, migrations).
- `release.yml` — on `v*.*.*` tags (and manual `workflow_dispatch` for pre-releases): runs `tauri-action` across a `{windows-latest, macos-latest, ubuntu-22.04}` matrix, producing `.msi`/`.exe` (Windows x64), `.dmg`/`.app` (macOS arm64 + x64 via universal build), `.deb`/`.AppImage`/`.rpm` (Linux x64); signs updater artifacts with the Ed25519 key from `TAURI_SIGNING_PRIVATE_KEY` secret; drafts the GitHub Release (not auto-published — a human clicks "publish" to distinguish dev builds from official releases, per requirement §20.4).
- `security.yml` — scheduled + on PR: `cargo audit`, `pnpm audit`, optionally CodeQL.
- No `build.yml`/`update-validation.yml` as separate files — folded into `ci.yml`/`release.yml` via jobs, to avoid maintaining five near-duplicate workflow files (explicitly allowed: "a unified matrix workflow may be used if cleaner").

## 6. Risks & Ambiguities — Resolved Decisions

1. **Rust requirement (accepted).** Tauri means future maintainers need Rust for core/backup/updater/DB work, not just TypeScript. Mitigated by keeping _all_ business logic in `packages/core` (pure TS) so the Rust surface stays limited to DB/backup/keyring/updater/cloud-HTTP code (~20-30% of the codebase).
2. **Cloud provider scope for v1 (decided: Dropbox only).** The `BackupStorageProvider` abstraction is built fully; **Dropbox** is the one complete v1 implementation (PKCE-only OAuth, no Google Cloud Console project/verification needed). Google Drive is left as a documented, interface-complete stub — not implemented as a pretend-functional feature.
3. **macOS/Windows code signing certificates (documented limitation, not blocking).** Update packages can be Ed25519-signed by Tauri's own updater regardless, but _OS-level_ app signing (Apple Developer ID notarization, Windows Authenticode) requires paid certificates the user would need to provide as GitHub secrets. Without them, macOS/Windows builds will trigger Gatekeeper/SmartScreen warnings on first run. The pipeline is built to consume those secrets if/when supplied.
4. **Default pricing strategy (decided):** **"Latest purchase price per raw material"** — the most recent purchase record's cost-per-base-unit is used, editable per-material to "Manual override" or "Average of last N purchases." Documented in `costing-engine.md`.
5. **Session-scope pacing (decided: phase-by-phase).** Each phase is implemented, tested, and summarized before the next one starts.
