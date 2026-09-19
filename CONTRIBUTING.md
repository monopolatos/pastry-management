# Contributing

## Project layout

This is a pnpm workspace monorepo:

- `apps/desktop` — the Tauri application (Rust core in `src-tauri/`, React/TS UI in `src/`).
- `packages/core` — pure TypeScript domain logic (recipe costing engine, unit conversion, pricing
  strategy resolution). No I/O, no React, no Tauri imports. This is where business-rule bugs should
  be fixed and where new business logic tests belong.
- `docs/` — architecture, database schema, costing engine, and backup/update design documents.
  Read these before making structural changes; they record _why_ something is built the way it is,
  not just what it does.

## Prerequisites

- Node.js 20+ and pnpm (`corepack enable` will provide the pinned pnpm version)
- Rust (via [rustup](https://rustup.rs)) — required to build/run `apps/desktop`
- Platform-specific Tauri build dependencies — see the
  [Tauri prerequisites guide](https://tauri.app/start/prerequisites/) for your OS. On Linux this
  includes `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`,
  `librsvg2-dev`, and `libxdo-dev`.

## Setup

```bash
pnpm install
pnpm dev          # launches the Tauri app in development mode
```

## Testing

```bash
pnpm test         # runs all workspace test suites (packages/core's Vitest suite, etc.)
pnpm --filter @pastry-management/desktop tauri -- --help   # Tauri CLI, if needed
cd apps/desktop/src-tauri && cargo test                     # Rust-side tests
```

## Code style

- `pnpm lint` (ESLint) and `pnpm format:check` (Prettier) must pass before a PR is opened.
- `cargo fmt` and `cargo clippy -- -D warnings` for Rust code.
- Business logic changes (costing, pricing, unit conversion) require a corresponding test in
  `packages/core` — this logic is deliberately kept pure and dependency-free specifically so it's
  cheap to test exhaustively.

## Commit / PR expectations

- Keep business logic changes and pure UI changes in separate, reviewable commits where practical.
- Never commit secrets, private signing keys, `.env` files, or real user databases/backups — see
  `.gitignore` and `docs/backup-and-updates.md` for what's excluded and why.
- Reference the relevant `docs/*.md` design doc in your PR description if a change affects
  architecture, schema, costing rules, or the backup/update flow, and update that doc in the same
  PR if the behavior it describes changes.
