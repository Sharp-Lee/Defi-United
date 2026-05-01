#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${WALLET_WORKBENCH_RELEASE_LOG_DIR:-}"
LOG_LOCATION_HINT="For locatable logs, rerun with WALLET_WORKBENCH_RELEASE_LOG_DIR set to a safe local directory."
READINESS_MARKER_REGEX="${WALLET_WORKBENCH_RELEASE_DESKTOP_READY_MARKER_REGEX:-^[[:space:]]*Local:.*5173/}"
READINESS_TIMEOUT_SECONDS="${WALLET_WORKBENCH_RELEASE_DESKTOP_READY_TIMEOUT_SECONDS:-120}"
CONTROLLER_TIMEOUT_SECONDS="${WALLET_WORKBENCH_RELEASE_DESKTOP_SMOKE_TIMEOUT_SECONDS:-300}"

POST_MERGE=0

STAGE_FAILURE_CATEGORY=""
STAGE_FAILURE_MESSAGE=""

BASELINE_WORKTREE_DIR=""
BASELINE_CLEANED=0

SMOKE_APP_DIR=""
SMOKE_CLEANED=0
APP_PID=""
APP_PGID=""
SMOKE_LOG_REF="desktop_smoke.log"

cd "${REPO_ROOT}"

usage() {
  printf 'usage: %s [--post-merge]\n' "${0##*/}" >&2
}

stage_fail() {
  STAGE_FAILURE_CATEGORY="$1"
  STAGE_FAILURE_MESSAGE="$2"
  return 1
}

escape_log_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  printf '%s' "${value}"
}

prepare_log_dir() {
  local probe_path=""

  if [ -z "${LOG_DIR}" ]; then
    if ! LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/release-readiness.XXXXXX" 2>/dev/null)"; then
      printf 'release_readiness_stage_fail stage=prepare_logs category=environment_startup message="could not create temporary log directory" log_dir="[redacted_path]"\n'
      printf 'release_readiness_log_hint suggestion="%s"\n' "${LOG_LOCATION_HINT}"
      return 1
    fi
  fi

  if ! mkdir -p "${LOG_DIR}" 2>/dev/null; then
    printf 'release_readiness_stage_fail stage=prepare_logs category=environment_startup message="could not prepare log directory" log_dir="[redacted_path]"\n'
    printf 'release_readiness_log_hint suggestion="%s"\n' "${LOG_LOCATION_HINT}"
    return 1
  fi

  probe_path="${LOG_DIR}/.release-readiness-log-probe"
  if ! (printf '' >"${probe_path}" && rm -f "${probe_path}") 2>/dev/null; then
    rm -f "${probe_path}" 2>/dev/null || true
    printf 'release_readiness_stage_fail stage=prepare_logs category=environment_startup message="log directory is not writable" log_dir="[redacted_path]"\n'
    printf 'release_readiness_log_hint suggestion="%s"\n' "${LOG_LOCATION_HINT}"
    return 1
  fi
}

print_stage_start() {
  local stage="$1"
  local log_ref="$2"
  printf 'release_readiness_stage_start stage=%s log_ref="%s" log_dir="[redacted_path]"\n' \
    "${stage}" "${log_ref}"
}

print_stage_pass() {
  local stage="$1"
  local log_ref="$2"
  printf 'release_readiness_stage_pass stage=%s log_ref="%s" log_dir="[redacted_path]"\n' \
    "${stage}" "${log_ref}"
}

print_stage_fail() {
  local stage="$1"
  local log_ref="$2"
  local category="$3"
  local message="$4"
  printf 'release_readiness_stage_fail stage=%s category=%s message="%s" log_ref="%s" log_dir="[redacted_path]"\n' \
    "${stage}" "${category}" "${message}" "${log_ref}"
}

cleanup_baseline_resources() {
  if [ -n "${BASELINE_WORKTREE_DIR}" ] && [ "${BASELINE_CLEANED}" -eq 0 ]; then
    if git -C "${REPO_ROOT}" worktree remove --force "${BASELINE_WORKTREE_DIR}" >/dev/null 2>&1; then
      BASELINE_CLEANED=1
    else
      rm -rf "${BASELINE_WORKTREE_DIR}" >/dev/null 2>&1 || true
      git -C "${REPO_ROOT}" worktree prune --expire now >/dev/null 2>&1 || true
      BASELINE_CLEANED=1
    fi
  fi
}

cleanup_smoke_resources() {
  if [ -n "${APP_PGID}" ] || [ -n "${SMOKE_APP_DIR}" ]; then
    if [ "${SMOKE_CLEANED}" -eq 0 ]; then
      SMOKE_CLEANED=1
      if [ -n "${APP_PGID}" ]; then
        kill -TERM -- "-${APP_PGID}" >/dev/null 2>&1 || true
      elif [ -n "${APP_PID}" ]; then
        kill -TERM "${APP_PID}" >/dev/null 2>&1 || true
      fi

      local attempts=0
      while [ "${attempts}" -lt 20 ]; do
        if [ -n "${APP_PGID}" ]; then
          if ! kill -0 -- "-${APP_PGID}" >/dev/null 2>&1; then
            break
          fi
        elif [ -n "${APP_PID}" ] && ! kill -0 "${APP_PID}" >/dev/null 2>&1; then
          break
        fi
        attempts=$((attempts + 1))
        sleep 1
      done

      if [ -n "${APP_PGID}" ] && kill -0 -- "-${APP_PGID}" >/dev/null 2>&1; then
        kill -KILL -- "-${APP_PGID}" >/dev/null 2>&1 || true
      elif [ -n "${APP_PID}" ] && kill -0 "${APP_PID}" >/dev/null 2>&1; then
        kill -KILL "${APP_PID}" >/dev/null 2>&1 || true
      fi

      if [ -n "${SMOKE_APP_DIR}" ]; then
        rm -rf "${SMOKE_APP_DIR}" >/dev/null 2>&1 || true
      fi
    fi
  fi
}

cleanup_all_resources() {
  cleanup_smoke_resources
  cleanup_baseline_resources
}

on_signal() {
  cleanup_all_resources
  case "$1" in
    INT) exit 130 ;;
    TERM) exit 143 ;;
    *) exit 1 ;;
  esac
}

trap cleanup_all_resources EXIT
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM

run_stage_capture() {
  local stage="$1"
  local log_ref="$2"
  shift 2
  local log_path="${LOG_DIR}/${log_ref}"

  STAGE_FAILURE_CATEGORY=""
  STAGE_FAILURE_MESSAGE=""
  print_stage_start "${stage}" "${log_ref}"
  if "$@" >"${log_path}" 2>&1; then
    print_stage_pass "${stage}" "${log_ref}"
    return 0
  else
    local status=$?
    print_stage_fail "${stage}" "${log_ref}" \
      "${STAGE_FAILURE_CATEGORY:-${stage}}" \
      "${STAGE_FAILURE_MESSAGE:-command exited with status ${status}}"
    return "${status}"
  fi
}

main_sync() {
  local local_main=""
  local origin_main=""

  if ! git -C "${REPO_ROOT}" fetch origin main; then
    stage_fail "main_sync" "git fetch origin main failed"
    return 1
  fi

  if ! local_main="$(git -C "${REPO_ROOT}" rev-parse main)"; then
    stage_fail "main_sync" "git rev-parse main failed"
    return 1
  fi

  if ! origin_main="$(git -C "${REPO_ROOT}" rev-parse origin/main)"; then
    stage_fail "main_sync" "git rev-parse origin/main failed"
    return 1
  fi

  printf 'main_sync_local=%s origin_main=%s\n' "${local_main}" "${origin_main}"

  if [ "${local_main}" != "${origin_main}" ]; then
    stage_fail "main_sync" "main and origin/main point to different commits"
    return 1
  fi
}

baseline_clean() {
  local worktree_dir=""
  local status_short=""

  if ! worktree_dir="$(mktemp -d "${TMPDIR:-/tmp}/release-readiness-baseline.XXXXXX")"; then
    stage_fail "baseline_clean" "could not create throwaway worktree directory"
    return 1
  fi

  BASELINE_WORKTREE_DIR="${worktree_dir}"
  BASELINE_CLEANED=0

  if ! git -C "${REPO_ROOT}" worktree add --detach "${BASELINE_WORKTREE_DIR}" origin/main; then
    cleanup_baseline_resources
    stage_fail "baseline_clean" "git worktree add from origin/main failed"
    return 1
  fi

  if ! status_short="$(git -C "${BASELINE_WORKTREE_DIR}" status --short)"; then
    cleanup_baseline_resources
    stage_fail "baseline_clean" "git status --short failed in throwaway worktree"
    return 1
  fi

  if [ -n "${status_short}" ]; then
    printf 'baseline_clean_status_short_present=true\n'
    cleanup_baseline_resources
    stage_fail "baseline_clean" "throwaway worktree is not clean"
    return 1
  fi

  if ! git -C "${BASELINE_WORKTREE_DIR}" diff --check; then
    cleanup_baseline_resources
    stage_fail "baseline_clean" "git diff --check failed in throwaway worktree"
    return 1
  fi

  cleanup_baseline_resources
}

dependency_readiness() {
  if ! npm ci; then
    stage_fail "dependency_readiness" "npm ci failed"
    return 1
  fi
}

start_smoke_app() {
  local app_pid_text=""

  if ! command -v python3 >/dev/null 2>&1; then
    stage_fail "environment_startup" "python3 is required to launch the desktop smoke app"
    return 1
  fi

  if ! SMOKE_APP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/release-readiness-smoke.XXXXXX")"; then
    stage_fail "environment_startup" "could not create a fresh EVM_WALLET_WORKBENCH_APP_DIR"
    return 1
  fi

  SMOKE_CLEANED=0
  : >"${SMOKE_LOG_PATH}"

  if ! app_pid_text="$(
    python3 - "${SMOKE_LOG_PATH}" "${SMOKE_APP_DIR}" <<'PY'
import os
import sys

log_path = sys.argv[1]
app_dir = sys.argv[2]

log = open(log_path, "ab", buffering=0)
ready_r, ready_w = os.pipe()
pid = os.fork()
if pid == 0:
    os.close(ready_r)
    try:
        os.setsid()
        os.environ["EVM_WALLET_WORKBENCH_APP_DIR"] = app_dir
        os.dup2(log.fileno(), 1)
        os.dup2(log.fileno(), 2)
        os.write(ready_w, b"1")
        os.close(ready_w)
        devnull = os.open(os.devnull, os.O_RDONLY)
        os.dup2(devnull, 0)
        os.close(devnull)
        os.execvp("npm", ["npm", "run", "tauri:dev"])
    except BaseException as exc:
        try:
            os.write(ready_w, b"0")
        except Exception:
            pass
        try:
            log.write(f"release_readiness_python_startup_failed: {exc}\n".encode())
            log.flush()
        except Exception:
            pass
        os._exit(1)

os.close(ready_w)
ready = os.read(ready_r, 1)
os.close(ready_r)
if ready != b"1":
    sys.exit(1)
sys.stdout.write(f"{pid}\n")
PY
  )"; then
    cleanup_smoke_resources
    stage_fail "environment_startup" "python3 failed to spawn the desktop smoke app"
    return 1
  fi

  APP_PID="${app_pid_text}"
  APP_PGID="${app_pid_text}"
}

wait_for_readiness_marker() {
  local deadline=$((SECONDS + READINESS_TIMEOUT_SECONDS))
  local marker_seen=0

  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if ! kill -0 "${APP_PID}" >/dev/null 2>&1; then
      printf 'desktop_smoke_app_exited_before_readiness log_ref="%s"\n' "${SMOKE_LOG_REF}" >>"${SMOKE_LOG_PATH}"
      stage_fail "desktop_smoke" "desktop app exited before the readiness marker appeared"
      return 1
    fi

    if grep -E -q -- "${READINESS_MARKER_REGEX}" "${SMOKE_LOG_PATH}" 2>/dev/null; then
      marker_seen=1
      break
    fi

    sleep 1
  done

  if [ "${marker_seen}" -ne 1 ]; then
    printf 'desktop_smoke_readiness_timeout marker="%s" timeout_s=%s log_ref="%s"\n' \
      "$(escape_log_value "${READINESS_MARKER_REGEX}")" "${READINESS_TIMEOUT_SECONDS}" "${SMOKE_LOG_REF}" >>"${SMOKE_LOG_PATH}"
    stage_fail "desktop_smoke" "timed out waiting for the readiness marker"
    return 1
  fi
}

controller_gate() {
  local controller_input=""
  local controller_source="/dev/stdin"

  {
    printf 'release_readiness_controller_checklist\n'
    printf '  - confirm the desktop app is responsive at localhost:5173\n'
    printf '  - create or unlock a throwaway vault and confirm the core transfer/history surfaces render\n'
    printf '  - enter pass to continue or fail to stop\n'
    printf 'release_readiness_controller_prompt timeout_s=%s allowed_inputs=pass|fail\n' "${CONTROLLER_TIMEOUT_SECONDS}"
  } | tee -a "${SMOKE_LOG_PATH}"

  if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    controller_source="/dev/tty"
  fi

  if ! IFS= read -r -t "${CONTROLLER_TIMEOUT_SECONDS}" controller_input <"${controller_source}"; then
    printf 'desktop_smoke_controller_timeout timeout_s=%s log_ref="%s"\n' \
      "${CONTROLLER_TIMEOUT_SECONDS}" "${SMOKE_LOG_REF}" >>"${SMOKE_LOG_PATH}"
    stage_fail "desktop_smoke" "timed out waiting for controller input"
    return 1
  fi

  controller_input="${controller_input//$'\r'/}"
  case "${controller_input}" in
    pass)
      if ! kill -0 "${APP_PID}" >/dev/null 2>&1; then
        printf 'desktop_smoke_controller_recheck_app_dead log_ref="%s"\n' "${SMOKE_LOG_REF}" >>"${SMOKE_LOG_PATH}"
        stage_fail "desktop_smoke" "controller approved pass but the app was no longer running"
        return 1
      fi

      if ! grep -E -q -- "${READINESS_MARKER_REGEX}" "${SMOKE_LOG_PATH}" 2>/dev/null; then
        printf 'desktop_smoke_controller_recheck_marker_missing log_ref="%s"\n' "${SMOKE_LOG_REF}" >>"${SMOKE_LOG_PATH}"
        stage_fail "desktop_smoke" "controller approved pass but the readiness marker was no longer in the log"
        return 1
      fi

      printf 'desktop_smoke_controller_decision=pass log_ref="%s"\n' "${SMOKE_LOG_REF}" >>"${SMOKE_LOG_PATH}"
      cleanup_smoke_resources
      return 0
      ;;
    fail)
      printf 'desktop_smoke_controller_decision=fail log_ref="%s"\n' "${SMOKE_LOG_REF}" >>"${SMOKE_LOG_PATH}"
      cleanup_smoke_resources
      stage_fail "desktop_smoke" "controller requested fail"
      return 1
      ;;
    *)
      printf 'desktop_smoke_controller_decision=invalid input="%s" log_ref="%s"\n' \
        "$(escape_log_value "${controller_input}")" "${SMOKE_LOG_REF}" >>"${SMOKE_LOG_PATH}"
      cleanup_smoke_resources
      stage_fail "desktop_smoke" "controller input must be pass or fail"
      return 1
      ;;
  esac
}

desktop_smoke() {
  if ! start_smoke_app; then
    return 1
  fi
  printf 'desktop_smoke_started app_pid=%s app_pgid=%s smoke_app_dir="[redacted_path]" log_ref="%s"\n' \
    "${APP_PID}" "${APP_PGID}" "${SMOKE_LOG_REF}" >>"${SMOKE_LOG_PATH}"
  if ! wait_for_readiness_marker; then
    return 1
  fi
  printf 'desktop_smoke_readiness_marker_detected marker="%s" log_ref="%s"\n' \
    "$(escape_log_value "${READINESS_MARKER_REGEX}")" "${SMOKE_LOG_REF}" >>"${SMOKE_LOG_PATH}"
  controller_gate
}

frontend_core() {
  if ! npm test -- src/features src/core; then
    stage_fail "frontend_core" "npm test -- src/features src/core failed"
    return 1
  fi
}

typecheck() {
  if ! npm run typecheck; then
    stage_fail "typecheck" "npm run typecheck failed"
    return 1
  fi
}

rust_regression() {
  if ! cargo test --manifest-path src-tauri/Cargo.toml; then
    stage_fail "rust_regression" "cargo test --manifest-path src-tauri/Cargo.toml failed"
    return 1
  fi
}

anvil_smoke() {
  if ! scripts/run-anvil-check.sh; then
    stage_fail "anvil_smoke" "scripts/run-anvil-check.sh failed"
    return 1
  fi
}

diff_check() {
  if ! git -C "${REPO_ROOT}" diff --check; then
    stage_fail "diff_check" "git diff --check failed in the working tree"
    return 1
  fi
}

run_stage() {
  local stage="$1"
  local mode="$2"
  local log_ref="$3"
  shift 3

  if [ "${mode}" = "capture" ]; then
    run_stage_capture "${stage}" "${log_ref}" "$@"
    return
  fi

  STAGE_FAILURE_CATEGORY=""
  STAGE_FAILURE_MESSAGE=""
  print_stage_start "${stage}" "${log_ref}"
  if "$@"; then
    print_stage_pass "${stage}" "${log_ref}"
    return 0
  else
    local status=$?
    print_stage_fail "${stage}" "${log_ref}" \
      "${STAGE_FAILURE_CATEGORY:-${stage}}" \
      "${STAGE_FAILURE_MESSAGE:-command exited with status ${status}}"
    return "${status}"
  fi
}

main() {
  if ! prepare_log_dir; then
    exit 1
  fi

  SMOKE_LOG_PATH="${LOG_DIR}/${SMOKE_LOG_REF}"

  if ! [[ "${READINESS_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]]; then
    printf 'release_readiness_stage_fail stage=parameter_validation category=environment_startup message="WALLET_WORKBENCH_RELEASE_DESKTOP_READY_TIMEOUT_SECONDS must be a positive integer" log_dir="[redacted_path]"\n'
    exit 1
  fi

  if ! [[ "${CONTROLLER_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]]; then
    printf 'release_readiness_stage_fail stage=parameter_validation category=environment_startup message="WALLET_WORKBENCH_RELEASE_DESKTOP_SMOKE_TIMEOUT_SECONDS must be a positive integer" log_dir="[redacted_path]"\n'
    exit 1
  fi

  if printf '' | grep -E -q -- "${READINESS_MARKER_REGEX}" >/dev/null 2>&1; then
    :
  else
    local regex_status=$?
    if [ "${regex_status}" -eq 2 ]; then
      printf 'release_readiness_stage_fail stage=parameter_validation category=environment_startup message="WALLET_WORKBENCH_RELEASE_DESKTOP_READY_MARKER_REGEX is not a valid extended regular expression" log_dir="[redacted_path]"\n'
      exit 1
    fi
  fi

  if [ "$#" -eq 0 ]; then
    POST_MERGE=0
  elif [ "$#" -eq 1 ] && [ "$1" = "--post-merge" ]; then
    POST_MERGE=1
  else
    usage
    exit 2
  fi

  if [ "${POST_MERGE}" -eq 0 ]; then
    run_stage "main_sync" "capture" "main_sync.log" main_sync
  fi

  run_stage "baseline_clean" "capture" "baseline_clean.log" baseline_clean
  run_stage "dependency_readiness" "capture" "dependency_readiness.log" dependency_readiness
  run_stage "desktop_smoke" "live" "${SMOKE_LOG_REF}" desktop_smoke
  run_stage "frontend_core" "capture" "frontend_core.log" frontend_core
  run_stage "typecheck" "capture" "typecheck.log" typecheck
  run_stage "rust_regression" "capture" "rust_regression.log" rust_regression
  run_stage "anvil_smoke" "capture" "anvil_smoke.log" anvil_smoke
  run_stage "diff_check" "capture" "diff_check.log" diff_check

  printf 'wallet_workbench_release_readiness_passed log_dir="[redacted_path]"\n'
}

main "$@"
