# Repository Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove stale documentation and completed task branches while preserving current product truth, workflow rules, status, and future roadmap.

**Architecture:** Treat this as a documentation-prune task plus a git hygiene task. Documentation changes are committed and merged through the normal workflow; branch/worktree cleanup is performed only after verifying branches are merged and worktrees are clean.

**Tech Stack:** Markdown, Git branches, Git worktrees.

---

## File Structure

- Modify: `README.md`
- Keep: `docs/specs/evm-wallet-workbench.md`
- Keep: `docs/superpowers/development-workflow.md`
- Modify: `docs/superpowers/project-status.md`
- Create: `docs/superpowers/roadmap.md`
- Keep for active task: `docs/superpowers/specs/2026-05-01-repository-hygiene-design.md`
- Keep for active task: `docs/superpowers/plans/2026-05-01-repository-hygiene.md`
- Delete completed historical docs:
  - `docs/superpowers/specs/2026-04-27-evm-wallet-workbench-design.md`
  - `docs/superpowers/specs/2026-05-01-browser-donor-cleanup-design.md`
  - `docs/superpowers/specs/2026-05-01-p7-release-readiness-design.md`
  - `docs/superpowers/plans/2026-04-27-evm-wallet-workbench-v1.md`
  - `docs/superpowers/plans/2026-04-27-evm-wallet-workbench-p3-p4.md`
  - `docs/superpowers/plans/2026-04-30-p6-2-hot-contract-analysis.md`
  - `docs/superpowers/plans/2026-05-01-browser-donor-cleanup.md`
  - `docs/superpowers/plans/2026-05-01-p7-release-readiness.md`

## Task P9a: Write Repository Hygiene Spec And Plan

**Files:**
- Create: `docs/superpowers/specs/2026-05-01-repository-hygiene-design.md`
- Create: `docs/superpowers/plans/2026-05-01-repository-hygiene.md`

- [ ] **Step 1: Record retention policy**

  Write the spec with explicit keep/remove rules for docs and branches.

- [ ] **Step 2: Record executable plan**

  Write this plan with exact files to keep, create, modify, and delete.

- [ ] **Step 3: Verify Markdown whitespace**

  Run:

  ```bash
  git diff --check
  ```

  Expected: exit 0.

## Task P9b: Prune Historical Docs And Add Roadmap

**Files:**
- Delete completed historical docs listed in File Structure.
- Modify: `README.md`
- Create: `docs/superpowers/roadmap.md`
- Modify: `docs/superpowers/project-status.md`

- [ ] **Step 1: Delete completed historical docs**

  Remove the completed milestone specs/plans listed above. Their durable product requirements are already in `docs/specs/evm-wallet-workbench.md`; task-by-task history remains available through git history.

- [ ] **Step 2: Add concise roadmap**

  Create `docs/superpowers/roadmap.md` with:

  - current baseline summary pointing to README and product spec,
  - candidate P9+ milestones,
  - explicit non-goals and safety boundaries.

- [ ] **Step 3: Update README key paths**

  Replace references to deleted historical plans in `README.md` with `docs/superpowers/roadmap.md`.

- [ ] **Step 4: Update status table**

  Add a P9 Repository Hygiene section to `docs/superpowers/project-status.md`, recording P9a, P9b, and P9c on `codex/p9-repository-hygiene`.

- [ ] **Step 5: Verify docs**

  Run:

  ```bash
  git diff --check
  ! rg -n "2026-04-27-evm-wallet-workbench|2026-04-30-p6-2|2026-05-01-browser-donor-cleanup|2026-05-01-p7-release-readiness" README.md docs/specs docs/superpowers/development-workflow.md docs/superpowers/project-status.md docs/superpowers/roadmap.md
  ```

  Expected: `git diff --check` passes; `rg` returns no references to deleted historical docs in retained user-facing docs. The active P9 cleanup plan can still list deleted file paths while the cleanup branch is active.

## Task P9c: Clean Completed Branches And Worktrees

**Files:** Git refs and local worktree metadata only.

- [ ] **Step 1: Verify branch merge status**

  Run:

  ```bash
  git fetch --prune origin
  git branch --merged main
  git branch --no-merged main
  git branch -r --merged origin/main
  git branch -r --no-merged origin/main
  ```

  Expected:

  - `git branch --no-merged main` shows no local task branch other than the active cleanup branch before merge.
  - `git branch -r --no-merged origin/main` preserves `origin/claude/research-defi-united-95e37`; do not delete it.
  - Deletion candidates come only from `git branch --merged main` and `git branch -r --merged origin/main`.

  Current clean completed worktree candidates:

  - `/Users/wukong/mylife/Defi-United/.worktrees/p6-2-hot-analysis-spec`
  - `/Users/wukong/mylife/Defi-United/.worktrees/p6-2b-hot-contract-fetch`
  - `/Users/wukong/mylife/Defi-United/.worktrees/p6-2c-hot-contract-aggregate`
  - `/Users/wukong/mylife/Defi-United/.worktrees/p6-2d-hot-contract-ui`
  - `/Users/wukong/mylife/Defi-United/.worktrees/p7-release-readiness`
  - `/Users/wukong/mylife/Defi-United/.worktrees/p8-clean-browser-residue`
  - `/Users/wukong/mylife/Defi-United/.worktrees/p8-review-fixes`

  Current local branch deletion candidates are all local `codex/*` branches listed by `git branch --merged main`, excluding the active cleanup branch until after merge.

  Current remote deletion candidates are all `origin/codex/*` branches listed by `git branch -r --merged origin/main`, excluding the active cleanup branch until after merge if it has been pushed.

- [ ] **Step 2: Remove clean completed worktrees**

  For each completed task worktree, run `git status --short --branch` first. Remove only clean worktrees whose branches are merged into `main`.

- [ ] **Step 3: Delete merged local task branches**

  Delete local `codex/*` task branches already merged into `main`, excluding the active cleanup branch until after merge.

- [ ] **Step 4: Delete merged remote codex task branches**

  Delete remote `origin/codex/*` branches already merged into `origin/main`. Preserve `origin/main` and any unmerged non-codex branch.

- [ ] **Step 5: Verify final branch state**

  Run:

  ```bash
  git branch
  git branch -r
  git worktree list
  git status --short --branch
  ```

  Expected: local branch/worktree list is minimal; remote keeps `origin/main` and unmerged non-codex work.
