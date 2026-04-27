# EVM Wallet Workbench

Local-first Tauri desktop workbench for EVM accounts, native-token transfers, and auditable transaction history.

The current product and test mainline is the Tauri desktop app. The older browser donor workflow remains in the repository only as historical migration context; new wallet work should follow the desktop boundary in `src/app`, `src/features`, `src/core`, `src/lib/tauri.ts`, and `src-tauri`.

## What v1 Supports

- Create and unlock one encrypted mnemonic vault stored in the local app data directory. The desktop UI does not import, export, display, or receive plaintext mnemonic material.
- Derive EVM accounts from the vault in Rust and scan native balances/nonces per `account + chainId`.
- Validate RPC endpoints by probing remote `chainId` before saving or submitting.
- Build and submit native-token transfers through Tauri commands.
- Persist local transaction history with separate Intent, Submission, and ChainOutcome fields.
- Reconcile pending history from RPC receipts/nonces.
- Show history filters, nonce-thread grouping, replace/cancel relationships, categorized errors, and P3-safe recovery prompts.
- Replace or cancel an existing pending native transfer while preserving the original `chainId`, account/from, and nonce.

ERC-20 transfers, ABI calls, raw calldata, batch strategies, manual dropped review, and broader diagnostics remain future P4-or-later work unless a later task explicitly implements them.

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

Recommended regression commands:

```bash
npm test
npm run typecheck
cargo test --manifest-path src-tauri/Cargo.toml
scripts/run-anvil-check.sh
git diff --check
```

`scripts/run-anvil-check.sh` starts anvil on `127.0.0.1:8545` with chainId `31337`, runs focused Vitest checks, runs the ignored native-transfer roundtrip test, then runs the Rust test suite. If anvil or the npm fallback cannot start in the local environment, record the exact command output as an environment failure rather than treating the smoke path as proven.

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
src/core/history/                History schema, selectors, reconcile helpers, action gates
src/core/transactions/           Transfer draft helpers
src/lib/tauri.ts                 Typed Tauri command boundary
src-tauri/src/                   Rust vault, accounts, transactions, storage, commands
src-tauri/tests/                 Rust integration/regression tests
docs/specs/evm-wallet-workbench.md
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
