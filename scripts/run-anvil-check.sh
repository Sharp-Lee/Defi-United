#!/usr/bin/env bash
set -euo pipefail

ANVIL_PORT="${ANVIL_PORT:-8545}"
ANVIL_RPC_URL="http://127.0.0.1:${ANVIL_PORT}"
EXPECTED_CHAIN_ID_HEX="0x7a69"
LOG_DIR="${WALLET_WORKBENCH_ANVIL_LOG_DIR:-}"
ANVIL_LOG_REF="anvil.log"
ANVIL_LOG=""
ANVIL_PID=""
LOG_LOCATION_HINT="For locatable logs, rerun with WALLET_WORKBENCH_ANVIL_LOG_DIR set to a safe local directory."

prepare_log_dir() {
  if [ -z "${LOG_DIR}" ]; then
    set +e
    LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wallet-workbench-anvil-check.XXXXXX" 2>/dev/null)"
    local status=$?
    set -e
    if [ "${status}" -ne 0 ] || [ -z "${LOG_DIR}" ]; then
      printf 'wallet_workbench_validation_failed category=environment_startup stage=prepare_logs message="could not create temporary log directory" suggestion="Set TMPDIR or WALLET_WORKBENCH_ANVIL_LOG_DIR to a writable local directory. %s" log_dir="[redacted_path]"\n' "${LOG_LOCATION_HINT}"
      exit 1
    fi
  fi

  if ! mkdir -p "${LOG_DIR}" 2>/dev/null; then
    printf 'wallet_workbench_validation_failed category=environment_startup stage=prepare_logs message="could not prepare log directory" suggestion="Set WALLET_WORKBENCH_ANVIL_LOG_DIR to a writable local directory or unset it. %s" log_dir="[redacted_path]"\n' "${LOG_LOCATION_HINT}"
    exit 1
  fi

  local probe_path="${LOG_DIR}/.wallet-workbench-log-probe"
  if ! (printf '' >"${probe_path}" && rm -f "${probe_path}") 2>/dev/null; then
    rm -f "${probe_path}" 2>/dev/null || true
    printf 'wallet_workbench_validation_failed category=environment_startup stage=prepare_logs message="log directory is not writable" suggestion="Set WALLET_WORKBENCH_ANVIL_LOG_DIR to a writable local directory or unset it. %s" log_dir="[redacted_path]"\n' "${LOG_LOCATION_HINT}"
    exit 1
  fi

  ANVIL_LOG="${LOG_DIR}/${ANVIL_LOG_REF}"
}

prepare_log_dir

if command -v anvil >/dev/null 2>&1; then
  ANVIL_CMD=(anvil)
else
  ANVIL_CMD=(npx -y @foundry-rs/anvil@1.6.0-rc1)
fi

cleanup() {
  if [ -n "${ANVIL_PID}" ]; then
    kill "${ANVIL_PID}" 2>/dev/null || true
    wait "${ANVIL_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

print_failure() {
  local category="$1"
  local stage="$2"
  local message="$3"
  local suggestion="$4"
  local log_ref="$5"

  printf 'wallet_workbench_validation_failed category=%s stage=%s message="%s" suggestion="%s %s" log_ref="%s" log_dir="[redacted_path]"' \
    "${category}" "${stage}" "${message}" "${suggestion}" "${LOG_LOCATION_HINT}" "${log_ref}"
  if [ -f "${ANVIL_LOG}" ]; then
    printf ' anvil_log_ref="%s"' "${ANVIL_LOG_REF}"
  fi
  printf '\n'
}

classify_stage_failure() {
  local stage="$1"
  local default_category="$2"
  local log_path="$3"

  if [ "${stage}" = "native_transfer_roundtrip" ]; then
    if grep -Eiq 'vault|session|unlock|password|mnemonic|key[[:space:]_-]*deriv|derive|decrypt' "${log_path}" 2>/dev/null; then
      printf 'vault_session'
    elif grep -Eiq 'history|persist|storage|write' "${log_path}" 2>/dev/null; then
      printf 'history'
    elif grep -Eiq 'reconcile|receipt|confirmed|dropped' "${log_path}" 2>/dev/null; then
      printf 'reconcile'
    elif grep -Eiq 'sign|broadcast|sendRawTransaction|submit failed|transaction' "${log_path}" 2>/dev/null; then
      printf 'signing_broadcast'
    else
      printf 'signing_broadcast'
    fi
    return
  fi

  if [ "${stage}" = "probe_anvil" ] && grep -Eiq 'anvil process exited before RPC was ready' "${log_path}" 2>/dev/null; then
    printf 'environment_startup'
    return
  fi

  printf '%s' "${default_category}"
}

failure_suggestion() {
  local stage="$1"
  local category="$2"
  local default_suggestion="$3"

  if [ "${stage}" = "probe_anvil" ] && [ "${category}" = "environment_startup" ]; then
    printf 'Check anvil_log_ref; the local anvil process exited before RPC became ready.'
    return
  fi

  printf '%s' "${default_suggestion}"
}

run_stage() {
  local stage="$1"
  local category="$2"
  local suggestion="$3"
  shift 3
  local log_ref="${stage}.log"
  local log_path="${LOG_DIR}/${log_ref}"

  printf 'wallet_workbench_stage_start category=%s stage=%s log_ref="%s" log_dir="[redacted_path]"\n' "${category}" "${stage}" "${log_ref}"
  if "$@" >"${log_path}" 2>&1; then
    printf 'wallet_workbench_stage_passed category=%s stage=%s log_ref="%s" log_dir="[redacted_path]"\n' "${category}" "${stage}" "${log_ref}"
    return 0
  else
    local status=$?
    local failed_category
    local failed_suggestion
    failed_category="$(classify_stage_failure "${stage}" "${category}" "${log_path}")"
    failed_suggestion="$(failure_suggestion "${stage}" "${failed_category}" "${suggestion}")"
    print_failure "${failed_category}" "${stage}" "command exited with status ${status}" "${failed_suggestion}" "${log_ref}"
    exit "${status}"
  fi
}

require_command() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1
}

check_environment() {
  require_command npm || {
    printf 'npm is required for frontend/vitest checks.\n' >&2
    return 1
  }
  require_command npx || {
    printf 'npx is required to run Vitest and the fallback anvil package.\n' >&2
    return 1
  }
  require_command cargo || {
    printf 'cargo is required for Rust regression checks.\n' >&2
    return 1
  }
  if ! require_command anvil && ! require_command npx; then
    printf 'anvil or npx is required to start the local chain.\n' >&2
    return 1
  fi
  if ! require_command curl && ! require_command node; then
    printf 'curl or node is required for the RPC chainId probe.\n' >&2
    return 1
  fi
}

validate_anvil_port() {
  if [ "${ANVIL_PORT}" != "8545" ]; then
    printf 'ANVIL_PORT=%s is not supported by this smoke check; the native roundtrip test currently requires 127.0.0.1:8545.\n' "${ANVIL_PORT}" >&2
    return 1
  fi
}

start_anvil() {
  "${ANVIL_CMD[@]}" --silent --host 127.0.0.1 --port "${ANVIL_PORT}" --chain-id 31337 >"${ANVIL_LOG}" 2>&1 &
  ANVIL_PID=$!

  sleep 1
  if ! kill -0 "${ANVIL_PID}" 2>/dev/null; then
    printf 'anvil exited during startup; the port may be busy or the binary may be unavailable.\n' >&2
    return 1
  fi
}

rpc_chain_id_request() {
  local payload='{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'

  if require_command curl; then
    curl -sS --fail --max-time 2 \
      -H 'content-type: application/json' \
      --data "${payload}" \
      "${ANVIL_RPC_URL}"
    return
  fi

  WALLET_WORKBENCH_ANVIL_RPC_URL="${ANVIL_RPC_URL}" node -e '
const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
fetch(process.env.WALLET_WORKBENCH_ANVIL_RPC_URL, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: payload
})
  .then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    process.stdout.write(await response.text());
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
'
}

probe_anvil_chain_id() {
  local response=""
  local observed_chain_id=""

  for attempt in $(seq 1 40); do
    if ! kill -0 "${ANVIL_PID}" 2>/dev/null; then
      printf 'anvil process exited before RPC was ready.\n' >&2
      return 1
    fi

    response="$(rpc_chain_id_request 2>>"${LOG_DIR}/probe_anvil.stderr" || true)"
    if [ -n "${response}" ]; then
      printf 'attempt=%s response=%s\n' "${attempt}" "${response}"
      observed_chain_id="$(printf '%s' "${response}" | sed -n 's/.*"result"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
      if [ -n "${observed_chain_id}" ]; then
        break
      fi
    fi
    sleep 0.25
  done

  if [ -z "${observed_chain_id}" ]; then
    printf 'RPC probe did not return an eth_chainId result from local anvil.\n' >&2
    return 1
  fi

  if [ "${observed_chain_id}" != "${EXPECTED_CHAIN_ID_HEX}" ]; then
    printf 'expected chainId %s but received %s from local anvil.\n' "${EXPECTED_CHAIN_ID_HEX}" "${observed_chain_id}" >&2
    return 1
  fi
}

run_stage "validate_anvil_port" "environment_startup" \
  "Use ANVIL_PORT=8545 or unset ANVIL_PORT; the native roundtrip test currently requires 127.0.0.1:8545." \
  validate_anvil_port

run_stage "check_environment" "environment_startup" \
  "Install Node/npm/npx and cargo, and make anvil or npx available on PATH." \
  check_environment

run_stage "start_anvil" "environment_startup" \
  "Check whether 127.0.0.1:${ANVIL_PORT} is already in use or whether anvil can start locally." \
  start_anvil

run_stage "probe_anvil" "rpc_chain_id" \
  "Confirm local anvil answers eth_chainId with 31337 before running transaction checks." \
  probe_anvil_chain_id

run_stage "frontend_vitest" "frontend_vitest" \
  "Inspect the Vitest log for diagnostics/history/pending-age regressions." \
  npx vitest run \
    src/core/transactions/draft.test.ts \
    src/core/history/reconciler.test.ts \
    src/core/history/actions.test.ts \
    src/core/history/pendingAge.test.ts \
    src/core/history/errors.test.ts \
    src/core/diagnostics/selectors.test.ts \
    src/features/diagnostics/DiagnosticsView.test.tsx \
    src/features/history/HistoryView.test.tsx

run_stage "native_transfer_roundtrip" "signing_broadcast" \
  "Inspect the roundtrip log; failures are classified as vault/session, signing/broadcast, history, or reconcile when possible." \
  cargo test --manifest-path src-tauri/Cargo.toml submit_native_transfer_roundtrip_against_anvil -- --exact --ignored

run_stage "rust_regression" "rust_regression" \
  "Inspect the Rust test log for non-anvil regression failures." \
  cargo test --manifest-path src-tauri/Cargo.toml

printf 'wallet_workbench_validation_passed log_dir="[redacted_path]" anvil_log_ref="%s"\n' "${ANVIL_LOG_REF}"
