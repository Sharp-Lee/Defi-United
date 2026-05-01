# EVM Wallet Workbench

Local-first Tauri desktop workbench for EVM accounts, native-token transfers, ERC-20 transfers, ABI calls, raw calldata sends, batch workflows, and auditable transaction history.

The current product and test mainline is the Tauri desktop app. Browser donor source has been removed from the current source tree and remains only in git history as historical migration context; new wallet work should follow the desktop boundary in `src/app`, `src/features`, `src/core`, `src/lib/tauri.ts`, and `src-tauri`.

## What v1 Supports

- Create and unlock one encrypted mnemonic vault stored in the local app data directory. The desktop UI does not import, export, display, or receive plaintext mnemonic material.
- Derive EVM accounts from the vault in Rust and scan native balances/nonces per `account + chainId`.
- Validate RPC endpoints by probing remote `chainId` before saving or submitting.
- Build and submit native-token transfers through Tauri commands.
- Build and submit standard ERC-20 transfers through Tauri commands, with token contract identity kept separate from calldata recipient.
- Maintain a token watchlist and scan ERC-20 balances for watched contracts.
- Use managed ABI read-only calls and ABI write transactions through the desktop confirmation and Rust/Tauri submit path.
- Preview and submit raw calldata transactions with bounded calldata summaries, selector inference warnings, and Rust/Tauri signing/broadcast.
- Run native and ERC-20 batch distribution/collection workflows through controlled desktop paths.
- Scan configured/known assets and approvals, including ERC-20 balances/allowances and known NFT approval points, with explicit source coverage and stale/failure states.
- Revoke clearly active ERC-20/NFT approvals through the controlled desktop confirmation, Rust/Tauri signing/broadcast, and typed history path.
- Analyze an existing transaction hash in a read-only desktop view with RPC transaction/receipt/log facts, ABI decode candidates, provider/source visibility, and local history comparison.
- Analyze a contract address in a read-only hot contract view with bounded source sampling, selector/topic candidates, ABI/cache advisory decode, source visibility, uncertainty states, and no signing, broadcasting, history mutation, or full payload persistence.
- Persist local transaction history with separate Intent, Submission, and ChainOutcome fields.
- Reconcile pending history from RPC receipts/nonces.
- Show history filters, nonce-thread grouping, replace/cancel relationships, categorized errors, pending-age guidance, and recovery prompts.
- Replace or cancel an existing pending native transfer while preserving the original `chainId`, account/from, and nonce.
- View and export non-sensitive diagnostics for RPC, chainId, history, broadcast, and reconcile troubleshooting.
- Inspect damaged history storage, quarantine unreadable history, recover broadcasted-but-unwritten submissions, and manually review dropped records.

Full portfolio or NFT collection discovery, full authorization discovery, batch revoke, risk scoring, wallet recovery automation, browser-version work, and broader contract interaction tooling remain future/non-goal exploration unless a later task explicitly implements them.

Plaintext mnemonic import/export and backup UX are not part of P3. Until a future native secure recovery workflow exists, preserve the encrypted vault file together with the password needed to unlock it. On macOS the default app data directory is `~/Library/Application Support/EVMWalletWorkbench/`; the encrypted vault is `vault.json` in that directory. Losing both that vault file or an app-data backup and the password means the generated wallet cannot be recovered by the P3 desktop app.

## Install And Run

```bash
npm install
npm run tauri:dev
```

Frontend-only development is still useful for component work:

```bash
npm run dev
```

Desktop release build:

```bash
npm run tauri:build
```

## Validation

Release readiness gate:

```bash
scripts/run-release-readiness.sh
```

This wrapper first confirms local `main` still matches `origin/main`, verifies a throwaway `origin/main` worktree is clean, checks dependency readiness, then runs an isolated interactive desktop startup/unlock/core smoke against a fresh app dir before frontend/core tests, typecheck, Rust suite, anvil smoke, and final diff check. The controller only enters pass/fail after the readiness marker has appeared, the checklist is complete, and the desktop smoke timeout is kept under control. Use `--post-merge` for merged-main rechecks; it skips only the already-proven `main_sync` stage.

Recommended regression commands, which remain the manual fallback:

```bash
npm test
npm run typecheck
cargo test --manifest-path src-tauri/Cargo.toml
scripts/run-anvil-check.sh
git diff --check
```

`scripts/run-anvil-check.sh` starts anvil on `127.0.0.1:8545` with chainId `31337`, probes `eth_chainId`, runs focused P4 Vitest checks, runs the ignored native-transfer roundtrip test, then runs the Rust test suite. The native roundtrip test is currently hardcoded to port `8545`, so the script fails fast if `ANVIL_PORT` is set to another value. Failures print a `wallet_workbench_validation_failed` line with a category such as `environment_startup`, `rpc_chain_id`, `frontend_vitest`, `vault_session`, `signing_broadcast`, `history`, `reconcile`, or `rust_regression`, plus redacted log references such as `frontend_vitest.log` or `anvil.log`. The summary is intentionally non-sensitive and does not print absolute paths; set `WALLET_WORKBENCH_ANVIL_LOG_DIR` to a directory you control if you want stable local log files for diagnosis. If anvil or the npm fallback cannot start in the local environment, record the categorized output as an environment failure rather than treating the smoke path as proven.

## Safety Boundaries

- Rust/Tauri owns vault decryption, account derivation, transaction signing, broadcasting, and local file persistence.
- Rust/Tauri owns desktop vault creation and generates the vault mnemonic internally.
- React owns UI state, form intent, read models, and display. React must not receive plaintext mnemonics, private keys, or derived signing material.
- The app must reject RPC or submission flows when remote `chainId` does not match the requested chain.
- Local nonce recovery must consider persisted pending history, not only in-memory state.
- If a transaction broadcasts but local history persistence fails, the returned error must include the tx hash and the local write failure.

## Key Paths

```text
src/app/                         Tauri app shell and session wiring
src/features/history/            History filters, details, nonce threads, action guidance
src/features/transfer/           Native transfer draft and submit UI
src/features/tokens/             Token watchlist and ERC-20 balance scanning UI
src/features/assets/             Asset/approval scan and revoke workflow UI
src/features/abi/                Managed ABI library and read/write caller UI
src/features/rawCalldata/        Raw calldata preview and submit UI
src/features/orchestration/      Account selection and orchestration UI
src/core/history/                History schema, selectors, reconcile helpers, action gates
src/core/transactions/           Native/ERC-20 transfer draft helpers
src/core/batch/                  Native/ERC-20 batch planning helpers
src/core/assets/                 Asset/approval scan and revoke read-model helpers
src/core/abi/                    ABI read-model helpers
src/core/rawCalldata/            Raw calldata draft and preview helpers
src/lib/tauri.ts                 Typed Tauri command boundary
src-tauri/src/commands/asset_approvals.rs  Asset/approval scan and revoke commands
src-tauri/src/                   Rust vault, accounts, transactions, storage, commands
src-tauri/tests/                 Rust integration/regression tests
docs/specs/evm-wallet-workbench.md
docs/superpowers/development-workflow.md  Project workflow and quality gates
docs/superpowers/plans/2026-04-27-evm-wallet-workbench-p3-p4.md
scripts/run-anvil-check.sh
```

## History Semantics

- `pending`: broadcast locally and tracked, without terminal receipt/replacement/cancellation/drop.
- `confirmed`: receipt status indicates success.
- `failed`: receipt exists and indicates failure/revert.
- `replaced`: another same-account, same-chain, same-nonce submission superseded it.
- `cancelled`: a same-nonce cancellation transaction to self with 0 value superseded it.
- `dropped`: local reconcile could not find a receipt and the account nonce advanced; this is not an on-chain failed receipt.

History is grouped by `account + chainId + nonce`. RPC URL is an access endpoint, not chain identity.

## Risk Notice

This is local wallet software for advanced users. Chain transactions are irreversible, RPC providers can observe queried addresses and transactions, and one vault mnemonic links derived accounts on chain. Keep a recoverable copy of the encrypted vault file and its password, and test changes against anvil before touching real funds.
