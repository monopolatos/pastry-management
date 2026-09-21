# Pastry Management

A cross-platform desktop application for pastry shops and bakeries: raw materials and suppliers,
purchase price history, recipes with nested sub-recipes, automatic recipe costing, local and cloud
backups, and self-updating releases.

**Status:** early implementation (Phase 2 of the roadmap — project scaffolding). See
[`docs/roadmap.md`](docs/roadmap.md) for what's built vs. planned. Sections below describe the
target design; anything not yet implemented is marked as such.

## 1. Purpose

Give a pastry shop owner or employee a single local-first tool to:

- Track raw materials, suppliers, and purchase price history over time.
- Build recipes — including recipes made of other recipes (e.g. a cake built from a ganache
  sub-recipe) — with automatic, auditable cost calculation per unit produced.
- Back up and restore all of that data locally or to cloud storage.
- Stay up to date via signed, automatic application updates.

## 2. Technology Stack

| Layer          | Choice                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Desktop shell  | [Tauri 2](https://tauri.app) (Rust core + native OS webview)                                                             |
| UI             | React 18 + TypeScript, Vite, Tailwind CSS v4 + shadcn/ui                                                                 |
| Business logic | Pure TypeScript (`packages/core`) — no I/O, independently unit-tested                                                    |
| Database       | SQLite, accessed only from the Rust core (`rusqlite`)                                                                    |
| Monetary math  | `decimal.js`, persisted as scaled integers — no floating-point rounding error                                            |
| Auth           | Argon2id password hashing (Rust), local session                                                                          |
| Secrets        | OS-native secret store (Windows Credential Manager / macOS Keychain / Linux Secret Service) via the Rust `keyring` crate |
| Cloud backup   | Dropbox (v1), provider abstraction ready for additional providers                                                        |
| Auto-update    | `tauri-plugin-updater` against GitHub Releases, Ed25519-signed packages                                                  |
| CI/CD          | GitHub Actions (`tauri-apps/tauri-action`)                                                                               |

Full rationale and the Tauri-vs-Electron comparison: [`docs/architecture.md`](docs/architecture.md).

## 3. Architecture

```
apps/desktop/          Tauri application
  src-tauri/            Rust core: DB access, auth, backups, cloud, updater, OS secrets
  src/                   React/TS UI — talks to src-tauri only via typed commands
packages/core/          Pure TypeScript domain logic: costing engine, unit conversion,
                         pricing strategy resolution — framework-agnostic and unit-tested
                         independently of the UI and database.
docs/                    Architecture, schema, costing, and backup/update design docs.
```

See [`docs/architecture.md`](docs/architecture.md) for the full module breakdown and
[`docs/database-schema.md`](docs/database-schema.md) for the data model.

## 4. Prerequisites

- [Node.js](https://nodejs.org) 20+
- [pnpm](https://pnpm.io) (`corepack enable` provides the version pinned in `package.json`)
- [Rust](https://rustup.rs) (stable toolchain)
- Platform build dependencies for Tauri — see the
  [Tauri prerequisites guide](https://tauri.app/start/prerequisites/). On Linux:
  `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`,
  `libxdo-dev`, `build-essential`, `pkg-config`, `libssl-dev`.

## 5. Local Development Setup

```bash
git clone <this-repo>
cd PastryManagement
pnpm install
```

## 6. Running the Application

```bash
pnpm dev
```

This launches the Tauri app in development mode with hot reload for the React frontend.

## 7. Running Tests

```bash
pnpm test                                        # all workspace TypeScript test suites
cd apps/desktop/src-tauri && cargo test           # Rust-side tests
```

## 8. Building

```bash
pnpm build                     # builds the frontend
pnpm --filter @pastry-management/desktop tauri build   # produces a native installer for the
                                                          # current platform
```

Cross-platform installers (Windows/macOS/Linux) are produced by CI, not by building on one OS —
see [`docs/roadmap.md`](docs/roadmap.md) Phase 8.

## 9. Releases

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`, which builds installers for Windows,
macOS (universal, arm64 + x64), and Linux (`.deb` + `.AppImage`) and drafts a GitHub Release with
them attached — **as a draft**, never auto-published, so a human verifies the installers actually
install and launch before clicking "Publish."

Before tagging: bump the version to match in `apps/desktop/src-tauri/tauri.conf.json`,
`apps/desktop/package.json`, and `apps/desktop/src-tauri/Cargo.toml` — the workflow's first job
fails loudly if any of them don't match the tag, rather than silently building a mislabeled
release. To dry-run the packaging step without publishing anything, trigger the workflow manually
from the Actions tab (`workflow_dispatch`); a manual run always just uploads the installers as
downloadable workflow artifacts and never touches GitHub Releases.

Code signing (Apple notarization, Windows Authenticode) is opt-in via GitHub Actions secrets — see
§13 and the comments at the top of `release.yml` for the exact secret names. Without them,
installers build successfully but are unsigned (OS security warnings on first run). Update-package
signing (Tauri's own Ed25519 updater signature) is separate and lands with the updater itself in
Phase 9.

## 10. Backup Configuration

Local backups (create, restore, custom storage location) and Dropbox cloud backup — see
[`docs/backup-and-updates.md`](docs/backup-and-updates.md) for the full design, restore-safety
sequence, and exactly what is/isn't included in a backup file. **Not yet implemented** — tracked
in Phases 6-7.

## 11. Cloud Integration Configuration

Dropbox is the only fully-implemented cloud provider in v1 (PKCE OAuth, no client secret shipped
in the app — see `docs/backup-and-updates.md` §2a for the implementation and §2b for the exact
setup steps). Cloud backup requires registering your own free Dropbox app and entering its App Key
in Backup & Restore → Dropbox settings before connecting — there is no shared/default app key
baked into this project. Google Drive's provider interface exists but is intentionally left
unimplemented pending a verified Google Cloud OAuth consent screen — see `docs/backup-and-updates.md`
§2 for why.

## 12. Automatic Updates

Design: `docs/backup-and-updates.md` §3. **Not yet implemented** — tracked in Phase 9.

## 13. Security Considerations

- No plaintext passwords: Argon2id hashing only, computed in the Rust core.
- The frontend (webview) never has direct DB or filesystem access — only typed Tauri commands.
- Cloud OAuth tokens live in the OS secret store, never in the SQLite database or app config.
- Local authentication is a single-machine access gate, not enterprise identity management — see
  `docs/architecture.md` §3 for the documented threat-model limitations (physical/OS-level access
  to the machine is out of scope; full-disk encryption is recommended).
- No password recovery flow in v1 (documented, not an oversight) — see `docs/architecture.md` §3.

## 14. Known Limitations (current phase)

- OS-level code signing (Apple notarization, Windows Authenticode) requires certificates that must
  be supplied by the project owner as GitHub Actions secrets; without them, unsigned builds will
  trigger OS security warnings on first run. Update-package signing (Tauri's Ed25519 updater
  signing) is independent of this and works regardless.
- Cloud backup: Dropbox only in v1; Google Drive is interface-complete but not implemented (see
  §11).
- Cross-platform packaging: the release workflow builds all three platforms, and the Linux leg has
  been verified locally (a real release build's `.deb` and `.AppImage` were produced and actually
  launched, not just compiled) — Windows and macOS installers have not yet been verified installing
  and launching on their real OS, since this project has so far only been developed and tested on
  Linux. Verify those before publishing the first non-draft release.
- Internationalization: the UI is English-only. An i18n scaffold exists (`apps/desktop/src/lib/i18n.tsx`)
  and is used for the navigation and Phase 5 screens, but the Phase 3/4 forms (raw materials,
  suppliers, recipes) have not been retrofitted to route their strings through it — that's a
  follow-up task, not silently incomplete work.
- See `docs/roadmap.md` for the full phase-by-phase feature status.

## License

[MIT](LICENSE)
