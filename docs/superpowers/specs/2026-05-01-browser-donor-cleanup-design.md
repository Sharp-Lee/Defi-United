# Browser Donor Cleanup Design

## Goal

Remove the obsolete browser donor implementation from the current Tauri desktop mainline, and remove local workspace confusion caused by the repository root still pointing at the old browser branch.

## Scope

- Tauri desktop remains the only product and validation mainline.
- Delete browser-only React donor files from `src/components`, `src/state`, `src/wallet`, and the browser-only `src/types.ts` if they are not imported by the desktop app.
- Keep desktop files in `src/app`, `src/features`, `src/core`, `src/lib`, `src-tauri`, docs, scripts, and tests.
- Update documentation to state that the browser donor implementation has been removed from current source and remains available only through git history.
- Update project status with a P8 cleanup milestone row.
- After code cleanup is merged and pushed, remove or neutralize the local root worktree confusion so the user no longer opens the old browser branch by default.

## Non-Goals

- Do not port any browser donor feature into desktop.
- Do not delete Tauri desktop frontend, Rust commands, tests, docs, or validation scripts.
- Do not change wallet runtime behavior, transaction semantics, vault storage, history schema, or release gates.
- Do not force-delete branches with unreviewed user changes.

## Design

The cleanup has two layers.

First, source cleanup removes browser-only donor modules that are not reachable from the current desktop app entrypoint. The desktop app continues to use `src/App.tsx`, `src/app`, `src/features`, `src/core`, `src/lib/tauri.ts`, and `src-tauri`. Typecheck and tests must prove no active imports depend on deleted browser modules.

Second, workspace cleanup fixes local ergonomics. The current repository root is still checked out as `codex/evm-wallet-workbench-v1-prep`, which makes the project look like the old browser app. The controller should only remove that worktree after the source cleanup branch is committed, pushed, reviewed, and merged, and only if no uncommitted user changes remain there.

## Acceptance Criteria

- `rg --files src/components src/state src/wallet src/types.ts` finds no files in the current mainline after implementation.
- `rg "src/(components|state|wallet)|\\.\\./(components|state|wallet)|\\.\\./types"` does not show active imports from desktop source.
- README no longer says the older browser donor workflow remains in the current repository source.
- Project status records the P8 cleanup task, branch, verification, push, and merge state.
- Focused verification passes: `npm test`, `npm run typecheck`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `git diff --check`.
- Local workspace cleanup leaves a clear current-main desktop worktree for use.

## Risks

- Deleting an apparently unused donor helper that is still imported by a test or desktop file would break typecheck; this is caught by `npm run typecheck`.
- Removing the repository root worktree while it has user changes could lose work; the controller must inspect `git status --short --branch` first and avoid destructive cleanup if dirty.
- Documentation must not imply browser support is available after the source cleanup.
