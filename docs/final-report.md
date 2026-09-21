# Final Report — Pastry Management v0.1.0

Delivered at the close of Phase 10, per the roadmap's own acceptance bar. This report is a status
snapshot as of this date, not a living document — see `docs/roadmap.md` for the phase-by-phase
detail this summarizes, and re-run the checks in §3 before relying on this report again after
further changes.

## 1. What was built

A cross-platform desktop app (Tauri 2 + React/TypeScript + SQLite) for pastry shop/bakery
management, built incrementally across 10 phases:

| Phase | Area                        | Summary                                                                                                                               |
| ----- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Architecture                | Tauri + React + TypeScript, SQLite via `rusqlite`, Dropbox-only cloud backup for v1. See `docs/architecture.md`.                      |
| 2     | Project init                | Monorepo scaffold, first migration, `ci.yml`.                                                                                         |
| 3     | Core data                   | Suppliers, raw materials, purchase price history (append-only), Argon2id auth.                                                        |
| 4     | Costing engine              | Pure-TypeScript recursive recipe costing (`packages/core`), nested sub-recipes, cycle detection, unit conversion, pricing strategies. |
| 5     | UI                          | Sidebar shell, shadcn/ui + Tailwind, light/dark/system theming, i18n scaffold.                                                        |
| 6     | Local backup                | Zip-based backup/restore with checksum validation and an automatic pre-restore safety backup.                                         |
| 7     | Cloud (Dropbox)             | OAuth2 PKCE via a loopback listener, no client secret shipped, OS keyring for tokens.                                                 |
| 8     | CI/CD & packaging           | GitHub Actions release pipeline; builds Windows/macOS/Linux installers and drafts a GitHub Release.                                   |
| 9     | Auto-updates                | `tauri-plugin-updater` wired via custom commands, Ed25519-signed update artifacts, three independently toggleable settings.           |
| 10    | Security & final validation | This report — dependency audits, secret-history scan, injection/XSS review.                                                           |

**Test coverage:** 90 Rust unit tests (`cargo test`, all passing, `cargo fmt`/`cargo clippy -D
warnings` clean) + 54 TypeScript tests in `packages/core` (`pnpm test`, all passing) + full
workspace typecheck/lint/format clean.

## 2. Architecture recap

- **Money:** integer micros (×1,000,000) in SQLite/Rust; `decimal.js` for all costing arithmetic,
  rounded only at output boundaries — no floating-point rounding error in prices or costs.
- **Auth:** Argon2id password hashing, in-memory-only sessions, no password recovery flow (v1
  scope decision, documented in `docs/architecture.md` §3).
- **Secrets:** Dropbox OAuth refresh tokens live only in the OS keyring (Credential
  Manager/Keychain/Secret Service) — never in SQLite, never logged.
- **Data access:** the frontend never touches SQLite directly — only typed Tauri commands, all
  parameterized (`rusqlite` bound `?1` params throughout; the only `format!()` calls that build
  SQL interpolate a compile-time-constant column list, never user input — see §3.3).
- **Costing:** recursive DFS with memoization for diamond-shaped sub-recipe reuse, kept strictly
  separate from cycle detection.

## 3. Security validation (Phase 10)

### 3.1 Dependency audits

- **`cargo audit`** (602 crate dependencies): **zero vulnerabilities.** Seven informational
  warnings (six "unmaintained crate," one "unsound API surface"), all transitive dependencies of
  `tauri`/`gtk`/`glib` (Linux window-menu bindings) or `tauri-utils`' `urlpattern` parser — not
  crates this app depends on directly, and none reachable through code this app calls. Documented
  and pinned as an explicit, named ignore list in `.github/workflows/security.yml` rather than left
  as unexplained noise; `cargo audit` now runs as a hard gate (fails on any _new_ advisory not in
  that list) on every push to `main`, every PR, and weekly.
- **`pnpm audit`**: initially found 7 advisories (1 critical, 1 high, 5 moderate), all in
  `packages/core`'s `vitest@2.1.9` devDependency chain (`vite`/`esbuild`/`@vitest/mocker`/
  `launch-editor`) — dev-server-only path-traversal/request-forgery issues, never reachable in the
  shipped production binary (no dev server runs inside a built Tauri app). **Fixed**, not just
  triaged: bumped `vitest` to `^4.1.11` (packages/core/package.json), confirmed all 54 tests still
  pass unchanged, re-ran the audit — **zero vulnerabilities remain.** `pnpm audit --audit-level=high`
  now runs as a hard gate (previously `|| true`, non-blocking) in `security.yml`.

### 3.2 Secrets in git history

Scanned every commit reachable from any ref (`git rev-list --all`, 13 commits total) for private-key
markers (`BEGIN ... PRIVATE KEY`, `minisign encrypted secret key`) and common credential patterns
(AWS keys, Slack/GitHub/OpenAI-style tokens, `password`/`secret`/`api_key`/`*_token` literal
assignments). **Zero matches.** This is consistent with the codebase's own design: credentials are
never hardcoded as literals anywhere in the source — they're either function parameters, read from
the OS keyring at runtime (Dropbox refresh token), or (for the Phase 9 updater signing key) handed
directly to the project owner out-of-band to store as a GitHub Actions secret, never committed. The
committed `tauri.conf.json` contains only the updater's _public_ key, which can only verify
signatures, not create them.

### 3.3 Injection & XSS review

- **SQL injection:** every user-supplied value reaches SQLite exclusively through `rusqlite`'s
  bound `params![]` placeholders. The only `format!()` calls that build SQL strings interpolate a
  `const SELECT_COLUMNS: &str` (a fixed column list defined in the same file) or hardcoded literal
  predicates — never a value that originates from a Tauri command argument. Verified by grepping
  every `format!()` call site adjacent to `execute`/`query_row`/SQL keywords across
  `commands/` and `db/repositories/`.
- **XSS:** no `dangerouslySetInnerHTML` and no `eval()` anywhere in the frontend. React's default
  JSX escaping is relied on throughout; there is no raw-HTML injection path from user input.
- **Panics on untrusted input:** no `.unwrap()`/`.expect()` calls in the `commands/` or
  `db/repositories/` layers (the code paths that handle arguments coming from the frontend) outside
  test modules — every fallible operation returns `AppResult` and propagates via `?`. The
  `.expect()` calls that do exist are confined to `lib.rs` app-startup setup (e.g. resolving the OS
  app-data directory), where a panic is the intended behavior for an unrecoverable launch-time
  configuration failure, not a response to untrusted input.

## 4. Known limitations (honest gaps carried forward)

These are documented, deliberate, or environment-driven — not oversights:

- **Windows/macOS installers built but not manually verified.** The release pipeline produces
  installers for all three platforms on GitHub Actions, and Linux's `.deb`/`.AppImage` were
  verified locally (built, launched, `.deb` metadata inspected). Windows/macOS have not been
  installed and launched on their native OS by a human, since development has been Linux-only.
  Verify before publishing the first non-draft release (`docs/roadmap.md` Phase 8).
- **Live Dropbox OAuth unverified.** By the project owner's own choice, no Dropbox app has been
  registered yet, so `dropbox_connect` has never been exercised against real Dropbox servers — only
  against a mocked HTTP server. Code-complete and reviewed (`docs/backup-and-updates.md` §2a).
- **Live update-detection flow unverified.** No version of this app has been published as a GitHub
  Release with a `latest.json` yet, so "an older build detects and installs a newer release" has
  only been unit-tested and confirmed running in the dev app, not exercised against real GitHub
  infrastructure (`docs/backup-and-updates.md` §3a).
- **OS code-signing is opt-in and currently unconfigured.** Apple notarization and Windows
  Authenticode certificates are not free; without them, installers build successfully but trigger
  first-run Gatekeeper/SmartScreen warnings. The pipeline consumes those secrets if/when provided.
- **English-only UI**, with an i18n scaffold in place but not retrofitted onto the Phase 3/4 forms.
- **Single-currency (EUR) assumption** throughout; no multi-currency support in v1.
- **No password recovery flow** — a deliberate v1 scope decision (`docs/architecture.md` §3);
  local auth is a single-machine access gate, not enterprise identity management.

## 5. Recommendations before first public release

1. Add the `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub secrets
   (handed to the project owner directly when generated in Phase 9) so releases publish signed
   updater artifacts.
2. Cut a real tagged release, then manually install and launch the Windows and macOS artifacts at
   least once before un-drafting the GitHub Release.
3. Register a Dropbox app and exercise the cloud-backup connect/upload/restore flow live at least
   once.
4. Consider OS code-signing certificates if wider public distribution (beyond technically-inclined
   users comfortable dismissing an OS security warning) is a goal.
