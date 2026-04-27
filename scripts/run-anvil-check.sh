#!/usr/bin/env bash
set -euo pipefail

ANVIL_PORT="${ANVIL_PORT:-8545}"
if command -v anvil >/dev/null 2>&1; then
  ANVIL_CMD=(anvil)
else
  ANVIL_CMD=(npx -y @foundry-rs/anvil@1.6.0-rc1)
fi

"${ANVIL_CMD[@]}" --port "$ANVIL_PORT" --chain-id 31337 > /tmp/wallet-workbench-anvil.log 2>&1 &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true' EXIT

sleep 2

npx vitest run src/core/transactions/draft.test.ts src/core/history/reconciler.test.ts
cargo test --manifest-path src-tauri/Cargo.toml submit_native_transfer_roundtrip_against_anvil -- --exact --ignored
cargo test --manifest-path src-tauri/Cargo.toml
echo "wallet_workbench_validation_passed"
