# P7 Desktop Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current Tauri desktop mainline into a reproducible release-readiness gate with documented workflow, status tracking, full validation evidence, and no new wallet runtime capability.

**Architecture:** Keep release readiness as a thin operational layer around the existing desktop app: docs record the workflow and status, a shell runner orchestrates the existing validation commands, and the controller performs final verification/merge. No React/Rust product code should change unless a release gate exposes a real regression.

**Tech Stack:** Markdown docs, Bash, npm/Vitest, TypeScript, Cargo/Rust tests, existing `scripts/run-anvil-check.sh`, Git worktrees.

---

## File Structure

- `docs/superpowers/specs/2026-05-01-p7-release-readiness-design.md`: P7 design spec.
- `docs/superpowers/plans/2026-05-01-p7-release-readiness.md`: this implementation plan.
- `docs/superpowers/development-workflow.md`: fixed controller / implementer / reviewer workflow.
- `docs/superpowers/project-status.md`: current milestone status table.
- `scripts/run-release-readiness.sh`: release gate wrapper that confirms mainline sync, verifies a clean baseline worktree, then runs dependency, desktop smoke, frontend, typecheck, Rust, anvil smoke, and diff checks with redacted log references.
- `README.md`: validation command docs; should point users to the release gate wrapper.
- `docs/specs/evm-wallet-workbench.md`: project-level spec; should record P7 as a process gate, not a new wallet capability.

## Project Rules For This Plan

- Subagents must not commit or push. They implement or review only.
- The controller commits and pushes only after fresh verification.
- Every task uses fresh implementer, then spec reviewer, then code quality reviewer.
- Every reviewer finding must be fixed and re-reviewed before moving on.
- P7 does not add wallet features. If a release check exposes a real regression, fix the smallest affected path and add focused tests.

## Release Gates

P7b must make the release gate wrapper explicitly cover these ordered stages:

1. `main_sync`: `git fetch origin main`, then compare `git rev-parse main` with `git rev-parse origin/main`; pass only if local `main` and `origin/main` resolve to the same commit, fail if fetch fails or the commits differ
2. `baseline_clean`: create a throwaway worktree from `origin/main`, run `git status --short` and `git diff --check` inside it, then remove it; pass only if the new baseline worktree is clean and whitespace checks exit 0, fail if the worktree cannot be created, has local changes, or fails diff checks
3. `dependency_readiness`: `npm ci`
4. `desktop_smoke`: launch `EVM_WALLET_WORKBENCH_APP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wallet-workbench-release-app.XXXXXX")" npm run tauri:dev` against a fresh app dir, then complete the isolated create-or-unlock flow, confirm the core desktop shell renders, and record an explicit `pass`/`fail` marker after the checklist
5. `frontend_core`: `npm test -- src/features src/core`
6. `typecheck`: `npm run typecheck`
7. `rust_regression`: `cargo test --manifest-path src-tauri/Cargo.toml`
8. `anvil_smoke`: `scripts/run-anvil-check.sh`
9. `diff_check`: `git diff --check`

Each stage must have a clear pass/fail result and redacted log reference, and the wrapper must stop at the first failure.

---

### Task P7a: Workflow And Status Records

**Files:**
- Modify: `docs/superpowers/development-workflow.md`
- Modify: `docs/superpowers/project-status.md`

- [ ] **Step 1: Update the workflow delegation rule**

  In `docs/superpowers/development-workflow.md`, under `## 4. 单任务串行流程`, add this rule to the existing rule list:

  ```markdown
  - 如果用户已经明确授权 controller 代为执行需要用户参与的 gate，controller 继续执行 spec / plan / review / verification / commit / push，但不得跳过 implementer -> spec reviewer -> code quality reviewer -> controller fresh verification 的任务流程；只有 scope 扩大、环境阻塞、数据破坏风险或需要业务取舍时才停下来交给用户决策。
  ```

- [ ] **Step 2: Add P7 status rows**

  In `docs/superpowers/project-status.md`, append a new `## P7 Milestone` section after the P6-2 table:

  ```markdown
  ## P7 Milestone

  | milestone | task | branch | commit | review status | verification | pushed | merged | notes |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | P7a | Workflow And Status Records | `codex/p7-release-readiness` | `pending` | pending | pending | no | no | Records delegated workflow and starts P7 status tracking. |
  | P7b | Release Readiness Runner | `codex/p7-release-readiness` | `pending` | pending | pending | no | no | Adds reproducible release gate wrapper. |
  | P7c | Release Docs And Capability Wording | `codex/p7-release-readiness` | `pending` | pending | pending | no | no | Syncs README/spec validation wording without adding new wallet capabilities. |
  | P7d | Final Release Verification And Merge | `main` | `pending` | pending | pending | no | no | Final full validation and fast-forward merge to main. |
  ```

  Replace the `## Next` section with:

  ```markdown
  ## Next

  Next task: P7a Workflow And Status Records.
  ```

- [ ] **Step 3: Verify docs**

  Run:

  ```bash
  git diff --check
  ```

  Expected: exit 0.

- [ ] **Step 4: Report to controller**

  The implementer reports changed files and verification output. The controller then dispatches spec review and code quality review, runs fresh `git diff --check`, commits, and pushes the work diff. After the work commit exists, the controller records that finalized work commit hash in the P7a row, and that row must refer to the work commit hash rather than any later status-update commit, without skipping the implementer -> spec reviewer -> code quality reviewer -> controller fresh verification sequence required by `docs/superpowers/development-workflow.md`.

---

### Task P7b: Release Readiness Runner

**Files:**
- Create: `scripts/run-release-readiness.sh`

- [ ] **Step 1: Write the failing executable check**

  Run before creating the script:

  ```bash
  test -x scripts/run-release-readiness.sh
  ```

  Expected: FAIL because the script does not exist yet.

- [ ] **Step 2: Add the release gate wrapper**

  Create `scripts/run-release-readiness.sh` with executable mode and this behavior:

  ```bash
  #!/usr/bin/env bash
  set -euo pipefail

  LOG_DIR="${WALLET_WORKBENCH_RELEASE_LOG_DIR:-}"
  LOG_LOCATION_HINT="For locatable logs, rerun with WALLET_WORKBENCH_RELEASE_LOG_DIR set to a safe local directory."

  prepare_log_dir() {
    if [ -z "${LOG_DIR}" ]; then
      LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wallet-workbench-release-readiness.XXXXXX")"
    fi
    if ! mkdir -p "${LOG_DIR}" 2>/dev/null; then
      printf 'wallet_workbench_release_failed category=environment_startup stage=prepare_logs message="could not prepare log directory" suggestion="%s" log_dir="[redacted_path]"\n' "${LOG_LOCATION_HINT}"
      exit 1
    fi
    local probe_path="${LOG_DIR}/.wallet-workbench-release-probe"
    if ! (printf '' >"${probe_path}" && rm -f "${probe_path}") 2>/dev/null; then
      rm -f "${probe_path}" 2>/dev/null || true
      printf 'wallet_workbench_release_failed category=environment_startup stage=prepare_logs message="log directory is not writable" suggestion="%s" log_dir="[redacted_path]"\n' "${LOG_LOCATION_HINT}"
      exit 1
    fi
  }

  run_stage() {
    local stage="$1"
    local category="$2"
    shift 2
    local log_ref="${stage}.log"
    local log_path="${LOG_DIR}/${log_ref}"

    printf 'wallet_workbench_release_stage_start category=%s stage=%s log_ref="%s" log_dir="[redacted_path]"\n' "${category}" "${stage}" "${log_ref}"
    if "$@" >"${log_path}" 2>&1; then
      printf 'wallet_workbench_release_stage_passed category=%s stage=%s log_ref="%s" log_dir="[redacted_path]"\n' "${category}" "${stage}" "${log_ref}"
    else
      local status=$?
      printf 'wallet_workbench_release_failed category=%s stage=%s message="command exited with status %s" suggestion="Inspect log_ref. %s" log_ref="%s" log_dir="[redacted_path]"\n' "${category}" "${stage}" "${status}" "${LOG_LOCATION_HINT}" "${log_ref}"
      exit "${status}"
    fi
  }

  prepare_log_dir

  run_main_sync() {
    local stage="main_sync"
    local log_ref="${stage}.log"
    local log_path="${LOG_DIR}/${log_ref}"

    printf 'wallet_workbench_release_stage_start category=workspace stage=%s log_ref="%s" log_dir="[redacted_path]"\n' "${stage}" "${log_ref}"
    set +e
    {
      git fetch origin main &&
      local_main="$(git rev-parse main)" &&
      origin_main="$(git rev-parse origin/main)" &&
      printf 'local_main=%s\norigin_main=%s\n' "${local_main}" "${origin_main}" &&
      test "${local_main}" = "${origin_main}"
    } >"${log_path}" 2>&1
    local status=$?
    set -e
    if [ "${status}" -eq 0 ]; then
      printf 'wallet_workbench_release_stage_passed category=workspace stage=%s log_ref="%s" log_dir="[redacted_path]"\n' "${stage}" "${log_ref}"
    else
      printf 'wallet_workbench_release_failed category=workspace stage=%s message="local main is not synchronized with origin/main" suggestion="Inspect log_ref, then sync main with origin/main before rerunning." log_ref="%s" log_dir="[redacted_path]"\n' "${stage}" "${log_ref}"
      exit "${status}"
    fi
  }

  run_baseline_clean() {
    local stage="baseline_clean"
    local log_ref="${stage}.log"
    local log_path="${LOG_DIR}/${log_ref}"
    local baseline_dir=""

    baseline_dir="$(mktemp -d "${TMPDIR:-/tmp}/wallet-workbench-baseline.XXXXXX")"
    rm -rf "${baseline_dir}"
    printf 'wallet_workbench_release_stage_start category=workspace stage=%s log_ref="%s" baseline_dir="[redacted_path]" log_dir="[redacted_path]"\n' "${stage}" "${log_ref}"
    set +e
    {
      git worktree add --detach "${baseline_dir}" origin/main &&
      status_output="$(git -C "${baseline_dir}" status --short)" &&
      printf '%s' "${status_output}" &&
      test -z "${status_output}" &&
      git -C "${baseline_dir}" diff --check
    } >"${log_path}" 2>&1
    local status=$?
    git worktree remove --force "${baseline_dir}" >>"${log_path}" 2>&1 || true
    rm -rf "${baseline_dir}" >>"${log_path}" 2>&1 || true
    set -e
    if [ "${status}" -eq 0 ]; then
      printf 'wallet_workbench_release_stage_passed category=workspace stage=%s log_ref="%s" log_dir="[redacted_path]"\n' "${stage}" "${log_ref}"
    else
      printf 'wallet_workbench_release_failed category=workspace stage=%s message="origin/main baseline worktree is not clean" suggestion="Inspect log_ref before rerunning the release gate." log_ref="%s" log_dir="[redacted_path]"\n' "${stage}" "${log_ref}"
      exit "${status}"
    fi
  }

  POST_MERGE_MODE="0"
  case "$#" in
    0)
      ;;
    1)
      if [ "${1}" = "--post-merge" ]; then
        POST_MERGE_MODE="1"
      else
        printf 'wallet_workbench_release_failed category=usage stage=argument_parse message="unknown argument" suggestion="Run with no arguments or with --post-merge only." log_dir="[redacted_path]"\n'
        exit 2
      fi
      ;;
    *)
      printf 'wallet_workbench_release_failed category=usage stage=argument_parse message="unexpected arguments" suggestion="Run with no arguments or with --post-merge only." log_dir="[redacted_path]"\n'
      exit 2
      ;;
  esac

  if [ "${POST_MERGE_MODE}" = "1" ]; then
    printf 'wallet_workbench_release_stage_skipped category=workspace stage=main_sync log_ref="main_sync.log" log_dir="[redacted_path]" reason="main sync is already proven before merge"\n'
  else
    run_main_sync
  fi
  run_baseline_clean
  run_stage dependency_readiness setup npm ci

  run_desktop_smoke() {
    smoke_app_dir=""
    local log_ref="desktop_smoke.log"
    local log_path="${LOG_DIR}/${log_ref}"
    app_pid=""
    app_pgid=""
    smoke_result=""
    smoke_cleaned="0"
    local desktop_ready_timeout_seconds="${WALLET_WORKBENCH_RELEASE_DESKTOP_READY_TIMEOUT_SECONDS:-120}"
    local smoke_timeout_seconds="${WALLET_WORKBENCH_RELEASE_DESKTOP_SMOKE_TIMEOUT_SECONDS:-300}"
    local desktop_ready_marker_regex="${WALLET_WORKBENCH_RELEASE_DESKTOP_READY_MARKER_REGEX:-^[[:space:]]*Local:.*5173/}"

    cleanup_desktop_smoke() {
      if [ "${smoke_cleaned:-0}" = "1" ]; then
        return 0
      fi
      smoke_cleaned="1"
      kill_process_tree() {
        local pid="$1"
        local child_pid
        for child_pid in $(pgrep -P "${pid}" 2>/dev/null || true); do
          kill_process_tree "${child_pid}"
        done
        kill "${pid}" 2>/dev/null || true
      }
      if [ -n "${app_pgid}" ]; then
        kill -- "-${app_pgid}" 2>/dev/null || true
      fi
      if [ -n "${app_pid}" ] && kill -0 "${app_pid}" 2>/dev/null; then
        kill_process_tree "${app_pid}"
        wait "${app_pid}" 2>/dev/null || true
      fi
      if [ -n "${smoke_app_dir}" ]; then
        rm -rf "${smoke_app_dir}" 2>/dev/null || true
      fi
    }

    smoke_app_dir="$(mktemp -d "${TMPDIR:-/tmp}/wallet-workbench-release-app.XXXXXX")"
    printf 'wallet_workbench_release_stage_start category=desktop stage=desktop_smoke log_ref="%s" app_dir="[redacted_path]" log_dir="[redacted_path]"\n' "${log_ref}"
    if ! command -v python3 >/dev/null 2>&1; then
      cleanup_desktop_smoke
      printf 'wallet_workbench_release_failed category=environment_startup stage=desktop_smoke message="python3 is required to launch the desktop app in an isolated process group" suggestion="Install python3 or run in the supported controller environment." log_ref="%s" log_dir="[redacted_path]"\n' "${log_ref}"
      exit 1
    fi
    python3 - "${smoke_app_dir}" >"${log_path}" 2>&1 <<'PY' &
import os
import sys

os.environ["EVM_WALLET_WORKBENCH_APP_DIR"] = sys.argv[1]
os.setsid()
os.execvp("npm", ["npm", "run", "tauri:dev"])
PY
    app_pid=$!
    app_pgid="${app_pid}"
    trap cleanup_desktop_smoke EXIT INT TERM

    wait_for_desktop_ready() {
      local ready_wait_elapsed="0"
      while [ "${ready_wait_elapsed}" -lt "${desktop_ready_timeout_seconds}" ]; do
        if grep -Eq "${desktop_ready_marker_regex}" "${log_path}" 2>/dev/null; then
          return 0
        fi
        if ! kill -0 "${app_pid}" 2>/dev/null; then
          cleanup_desktop_smoke
          printf 'wallet_workbench_release_failed category=desktop stage=desktop_smoke message="the desktop app exited before reporting readiness" suggestion="Inspect log_ref and rerun the desktop smoke." log_ref="%s" log_dir="[redacted_path]"\n' "${log_ref}"
          exit 1
        fi
        sleep 1
        ready_wait_elapsed=$((ready_wait_elapsed + 1))
      done
      cleanup_desktop_smoke
      printf 'wallet_workbench_release_failed category=desktop stage=desktop_smoke message="the desktop app did not report readiness in time" suggestion="Inspect log_ref and rerun the desktop smoke." log_ref="%s" log_dir="[redacted_path]"\n' "${log_ref}"
      exit 1
    }

    wait_for_desktop_ready

    printf 'wallet_workbench_release_stage_checklist stage=desktop_smoke checklist="create or unlock a throwaway vault; confirm the core transfer and history surfaces render; keep the app open until after typing pass or fail" log_ref="%s" app_dir="[redacted_path]"\n' "${log_ref}"
    printf 'wallet_workbench_release_stage_prompt stage=desktop_smoke prompt="type pass or fail after the checklist" log_ref="%s"\n' "${log_ref}"
    if ! read -r -t "${smoke_timeout_seconds}" smoke_result; then
      cleanup_desktop_smoke
      printf 'wallet_workbench_release_failed category=desktop stage=desktop_smoke message="no pass/fail marker received" suggestion="Complete the checklist, then type pass or fail at the prompt." log_ref="%s" log_dir="[redacted_path]"\n' "${log_ref}"
      exit 1
    fi

    case "${smoke_result}" in
      pass)
        if ! kill -0 "${app_pid}" 2>/dev/null || ! grep -Eq "${desktop_ready_marker_regex}" "${log_path}" 2>/dev/null; then
          cleanup_desktop_smoke
          printf 'wallet_workbench_release_failed category=desktop stage=desktop_smoke message="the desktop app was not alive with a readiness marker when pass was recorded" suggestion="Inspect log_ref and rerun the desktop checklist." log_ref="%s" log_dir="[redacted_path]"\n' "${log_ref}"
          exit 1
        fi
        cleanup_desktop_smoke
        printf 'wallet_workbench_release_stage_passed category=desktop stage=desktop_smoke log_ref="%s" log_dir="[redacted_path]"\n' "${log_ref}"
        ;;
      fail)
        cleanup_desktop_smoke
        printf 'wallet_workbench_release_failed category=desktop stage=desktop_smoke message="controller marked the smoke as failed" suggestion="Inspect log_ref and rerun the desktop checklist." log_ref="%s" log_dir="[redacted_path]"\n' "${log_ref}"
        exit 1
        ;;
      *)
        cleanup_desktop_smoke
        printf 'wallet_workbench_release_failed category=desktop stage=desktop_smoke message="expected pass or fail marker" suggestion="Rerun the checklist and answer with pass or fail only." log_ref="%s" log_dir="[redacted_path]"\n' "${log_ref}"
        exit 1
        ;;
    esac
  }

  run_desktop_smoke
  run_stage frontend_core frontend npm test -- src/features src/core
  run_stage typecheck frontend npm run typecheck
  run_stage rust_regression rust cargo test --manifest-path src-tauri/Cargo.toml
  run_stage anvil_smoke anvil scripts/run-anvil-check.sh
  run_stage diff_check workspace git diff --check

  printf 'wallet_workbench_release_readiness_passed log_dir="[redacted_path]"\n'
  ```

  `dependency_readiness` must pass only if `npm ci` exits 0 and the installed toolchain remains usable for the later stages. `desktop_smoke` must run against a fresh `EVM_WALLET_WORKBENCH_APP_DIR`, pass only if the app reaches the unlock/create screen, a throwaway vault can be created or unlocked, the ready shell renders the core transfer/history surfaces without an uncaught crash, and the controller marks the stage `pass` after the checklist within `WALLET_WORKBENCH_RELEASE_DESKTOP_SMOKE_TIMEOUT_SECONDS` (default 300s). The wrapper keeps the launched `npm run tauri:dev` session open during the checklist, then closes it and records the result before moving on. The wrapper must keep these stages before the existing frontend/core, typecheck, Rust, anvil, and diff checks.
  The desktop smoke stage is only considered ready after the log shows a readiness marker matching `WALLET_WORKBENCH_RELEASE_DESKTOP_READY_MARKER_REGEX` (default `^[[:space:]]*Local:.*5173/`) and the app is still alive; if the app exits before readiness or never reports readiness within `WALLET_WORKBENCH_RELEASE_DESKTOP_READY_TIMEOUT_SECONDS` (default 120s), the wrapper must fail and clean up the process tree and temp app dir. `cleanup_desktop_smoke()` must be idempotent, and the cleanup state (`smoke_app_dir`, `app_pid`, `app_pgid`, `smoke_cleaned`) must remain visible to EXIT/INT/TERM handling after the function body finishes. Launch the app through a portable process-group helper, such as `python3` with `os.setsid()` before `execvp("npm", ...)`, and derive `app_pgid` from the helper PID rather than reading `ps` output so the retained value matches the new session once it exists; if the helper has not established the new session yet, the negative-PID cleanup may no-op and the process-tree fallback remains available. If `python3` is unavailable, fail explicitly as an environment startup problem. The controller must keep the app open through the checklist and recheck that the app is still alive and the readiness marker is still present immediately before recording `pass`; after that marker, the runner performs cleanup.

- [ ] **Step 3: Make the script executable**

  Run:

  ```bash
  chmod +x scripts/run-release-readiness.sh
  ```

- [ ] **Step 4: Run the executable check**

  Run:

  ```bash
  test -x scripts/run-release-readiness.sh
  ```

  Expected: exit 0.

- [ ] **Step 5: Run the release readiness gate**

  Run:

  ```bash
  scripts/run-release-readiness.sh
  ```

  Expected: final line `wallet_workbench_release_readiness_passed log_dir="[redacted_path]"`.

- [ ] **Step 6: Verify workspace formatting**

  Run:

  ```bash
  git diff --check
  ```

  Expected: exit 0.

- [ ] **Step 7: Report to controller**

  The implementer reports changed files, the failing executable check, final gate output, and `git diff --check`. The controller then dispatches spec review and code quality review, runs fresh focused verification, commits, pushes, and updates the P7b row.

---

### Task P7c: Release Docs And Capability Wording

**Files:**
- Modify: `README.md`
- Modify: `docs/specs/evm-wallet-workbench.md`
- Modify: `docs/superpowers/project-status.md`

- [ ] **Step 1: Update README validation docs**

  In `README.md`, under `## Validation`, add the release wrapper before the existing command list:

  ````markdown
  Release readiness gate:

  ```bash
  scripts/run-release-readiness.sh
  ```

  The wrapper first confirms local `main` is synchronized with `origin/main`, verifies a throwaway `origin/main` worktree is clean, checks dependency readiness, and runs an isolated interactive desktop startup/unlock/core smoke against a fresh app dir. The controller only records the explicit pass/fail marker after the log has already reached a readiness marker, the checklist is complete, and the desktop smoke timeout is respected, then the wrapper runs the frontend feature/core suite, TypeScript typecheck, the full Rust suite, anvil smoke, and whitespace diff checks with redacted log references. The wrapper also has an explicit `--post-merge` mode for the final merged-main recheck, which skips only the already-proven `main_sync` gate.
  ````

  Keep the existing individual commands as the manual fallback.

- [ ] **Step 2: Add P7 spec section**

  In `docs/specs/evm-wallet-workbench.md`, add a release readiness subsection near the final status/current capability sections. It must say:

  - P7 is a release validation gate, not a new wallet capability.
  - P7 uses `scripts/run-release-readiness.sh` plus controller verification.
  - README current capability wording remains limited to implemented wallet features.
  - Browser-version work remains future/non-goal.

- [ ] **Step 3: Update P7 status**

  In `docs/superpowers/project-status.md`, update the P7b row after the controller has committed it, and mark P7c as the current task.

- [ ] **Step 4: Verify docs and release gate**

  Run:

  ```bash
  git diff --check
  scripts/run-release-readiness.sh
  ```

  Expected: both exit 0; release gate ends with `wallet_workbench_release_readiness_passed`.

- [ ] **Step 5: Report to controller**

  The implementer reports changed files and verification output. The controller then dispatches spec review and code quality review, runs fresh verification, commits, pushes, and updates the P7c row.

---

### Task P7d: Final Release Verification And Merge

**Files:**
- Modify: `docs/superpowers/project-status.md`

- [ ] **Step 1: Dispatch final whole-diff implementer**

  The controller dispatches an implementer to prepare the final merge-ready state for the whole P7 diff from `main` to `codex/p7-release-readiness`.

- [ ] **Step 2: Dispatch final whole-diff spec reviewer**

  The controller dispatches one final spec reviewer over the whole P7 diff from `main` to `codex/p7-release-readiness`.

- [ ] **Step 3: Dispatch final whole-diff code quality reviewer**

  The controller dispatches one final code quality reviewer over the whole P7 diff from `main` to `codex/p7-release-readiness`.

- [ ] **Step 4: Fix and re-review any findings**

  If either reviewer finds issues, dispatch an implementer to fix them. Re-run spec/code-quality review for the fix before proceeding.

- [ ] **Step 5: Run full controller verification on the integration branch**

  Run:

  ```bash
  scripts/run-release-readiness.sh
  ```

  Expected: exit 0.

- [ ] **Step 6: Reconcile status table for integration branch**

  After the step 5 fresh verification, the controller dispatches the implementer to reconcile `docs/superpowers/project-status.md`, then runs spec review, then code quality review, then fresh `git diff --check`. Only after that fresh verification does the controller commit and push the status update. Reconcile the table so P7a, P7b, and P7c carry the finalized work commit hashes already captured at each task close, with `review status = passed`, `verification = passed`, `pushed = yes`, and `merged = no`. Do not invent new hashes here or try to describe the status-update commit itself. Mark P7d as pending merge.

- [ ] **Step 7: Commit and push status update**

  Controller runs:

  ```bash
  git add docs/superpowers/project-status.md
  git commit -m "Record P7 release readiness status"
  git push origin codex/p7-release-readiness
  ```

- [ ] **Step 8: Fast-forward merge to main**

  Controller synchronizes local `main` with `origin/main` and then fast-forwards the integration branch into it:

  ```bash
  git fetch origin
  git switch main
  git pull --ff-only origin main
  git merge --ff-only codex/p7-release-readiness
  ```

  If any command fails, stop and do not merge.

- [ ] **Step 9: Run full controller verification on merged main**

  Run the release wrapper in post-merge verification mode. `main_sync` is disabled here because local `main` is the unpushed merge result being verified before the final push; the default wrapper already proved `main` / `origin/main` synchronization before the merge.

  Run:

  ```bash
  scripts/run-release-readiness.sh --post-merge
  ```

  Expected: exit 0.

- [ ] **Step 10: Mark P7 merged and push main**

  After the step 9 fresh verification, the controller dispatches the implementer to update `docs/superpowers/project-status.md`, then runs spec review, then code quality review, then fresh `git diff --check`. Only after that fresh verification does the controller commit and push `main`. Update P7d so it has `review status = passed`, `verification = passed`, `pushed = yes`, `merged = yes`, and the final `main` merge-result hash. Here, "final main commit hash" means the `git merge --ff-only codex/p7-release-readiness` merge-result hash, not the later status-update commit hash.
