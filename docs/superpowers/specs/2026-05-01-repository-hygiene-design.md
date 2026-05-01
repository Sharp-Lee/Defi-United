# Repository Hygiene Design

## Goal

Reduce project documentation and branch noise while preserving the current product truth, workflow rules, status, and future roadmap.

## Scope

- Keep the Tauri desktop app as the only product mainline.
- Keep only durable, high-signal documentation in the current source tree.
- Remove completed milestone implementation plans and completed milestone design specs from the current source tree after their results are reflected in the current README, product spec, workflow, status table, or roadmap.
- Remove local worktrees and local branches for completed task branches that are clean and merged into `main`.
- Delete remote `origin/codex/*` task branches that are already merged into `origin/main`.
- Preserve `main`, the active cleanup branch until merged, and any remote branch not merged into `origin/main`.

## Non-Goals

- Do not change app runtime behavior.
- Do not rewrite git history.
- Do not delete unmerged remote branches.
- Do not delete branches or worktrees with uncommitted changes.
- Do not remove current product capability wording from README or the product spec.

## Documentation Retention Policy

Keep:

- `README.md`: user-facing current capabilities, install/run, validation, safety boundaries, and key paths.
- `docs/specs/evm-wallet-workbench.md`: current product spec and capability boundary.
- `docs/superpowers/development-workflow.md`: required controller/implementer/reviewer workflow.
- `docs/superpowers/project-status.md`: current milestone status table.
- `docs/superpowers/roadmap.md`: concise future milestone candidates and non-goals.
- The active repository hygiene spec/plan for this cleanup task until the cleanup branch is merged.

Remove from current source tree:

- Completed milestone implementation plans whose outcomes are already merged and summarized elsewhere.
- Completed milestone design specs whose durable requirements have been consolidated into `docs/specs/evm-wallet-workbench.md`.

Removed docs remain available through git history.

## Branch Retention Policy

Keep:

- `main`.
- The active cleanup branch until it has been merged into `main`.
- Remote branches that are not merged into `origin/main`, such as research branches or externally owned work.

Remove:

- Local task branches already merged into `main`.
- Clean local worktrees for completed task branches.
- Remote `origin/codex/*` task branches already merged into `origin/main`.

## Acceptance Criteria

- Current docs are reduced to the retained set plus this cleanup task's active spec/plan.
- `docs/superpowers/roadmap.md` exists and captures future candidates without implying they are implemented.
- `docs/superpowers/project-status.md` records P9 repository hygiene status.
- `git branch --no-merged main` shows no local task branches after cleanup, other than the active branch before merge.
- `git branch -r --no-merged origin/main` still preserves any unmerged non-codex branch.
- `git diff --check` passes.

