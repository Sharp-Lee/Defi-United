# Browser Donor Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove browser donor source residue from the Tauri desktop mainline and clean up local workspace confusion.

**Architecture:** Treat browser donor cleanup as a deletion-only source task plus a local worktree hygiene task. Runtime behavior should stay unchanged; verification proves active desktop code does not depend on deleted files.

**Tech Stack:** React/TypeScript, Tauri/Rust, Vitest, Cargo tests, Git worktrees.

---

## File Structure

- Delete: `src/components/`
- Delete: `src/state/`
- Delete: `src/wallet/`
- Delete: `src/types.ts`
- Modify: `README.md`
- Modify: `docs/specs/evm-wallet-workbench.md`
- Modify: `docs/superpowers/project-status.md`

## Task P8a: Remove Browser Donor Source Residue

**Files:**
- Delete: `src/components/`
- Delete: `src/state/`
- Delete: `src/wallet/`
- Delete: `src/types.ts`
- Modify: `README.md`
- Modify: `docs/specs/evm-wallet-workbench.md`
- Modify: `docs/superpowers/project-status.md`

- [ ] **Step 1: Confirm deleted files are donor-only**

  Run:

  ```bash
  rg -n "src/(components|state|wallet)|\\.\\./(components|state|wallet)|\\.\\./types|\\\"\\.\\./types\\\"|\\\"../types\\\"" src package.json vite.config.ts tsconfig.json README.md
  ```

  Expected: matches are limited to files under `src/components`, `src/state`, `src/wallet`, `src/types.ts`, or documentation describing old browser donor context.

- [ ] **Step 2: Delete donor-only files**

  Delete the browser donor files:

  ```bash
  rm -rf src/components src/state src/wallet src/types.ts
  ```

- [ ] **Step 3: Update docs**

  In `README.md`, replace wording that says the older browser donor workflow remains in the repository with wording that says browser donor source has been removed from the current mainline and is available only through git history.

  In `docs/specs/evm-wallet-workbench.md`, make the same capability-boundary wording precise: Tauri desktop is the only current source mainline; browser donor code is not retained as active source.

  In `docs/superpowers/project-status.md`, add a P8 row for browser donor cleanup.

- [ ] **Step 4: Run focused verification**

  Run:

  ```bash
  npm test
  npm run typecheck
  cargo test --manifest-path src-tauri/Cargo.toml
  git diff --check
  ```

  Expected: all pass.

- [ ] **Step 5: Report changed files and verification**

  Report deleted paths, changed docs, and verification output to the controller.

## Task P8b: Local Workspace Hygiene

**Files:** local git worktree metadata only.

- [ ] **Step 1: Confirm source cleanup is merged**

  Run:

  ```bash
  git fetch origin main
  git rev-parse main
  git rev-parse origin/main
  ```

  Expected: local main and origin/main match the cleanup merge commit.

- [ ] **Step 2: Inspect root worktree**

  Run:

  ```bash
  git -C /Users/wukong/mylife/Defi-United status --short --branch
  ```

  Expected: root worktree is clean before removal or branch reassignment.

- [ ] **Step 3: Remove old browser root worktree if clean**

  If clean, repoint the local checkout so the user opens a clearly named current-main desktop worktree instead of the old browser donor branch. One safe path is:

  ```bash
  git worktree add /Users/wukong/mylife/Defi-United/.worktrees/main-desktop main
  ```

  If the root checkout still points at the browser donor branch after P8a is merged, switch the root checkout to `main` only after freeing `main` from its auxiliary worktree and confirming the root worktree is clean. Do not force-delete data.

- [ ] **Step 4: Verify ergonomic endpoint**

  Run:

  ```bash
  git -C /Users/wukong/mylife/Defi-United/.worktrees/main-desktop branch --show-current
  git -C /Users/wukong/mylife/Defi-United/.worktrees/main-desktop rev-parse --short HEAD
  ```

  Expected: the clearly named desktop worktree is on `main`, and the old browser donor checkout is no longer the path we tell the user to open for active work.
