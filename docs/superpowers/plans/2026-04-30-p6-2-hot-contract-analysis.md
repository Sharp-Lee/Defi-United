# P6-2 Hot Contract Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tauri desktop read-only contract address hot interaction analysis entry that samples bounded provider data, aggregates selector/topic candidates, and displays advisory interaction patterns without signing, broadcasting, mutating history, or leaking secrets.

**Architecture:** Rust/Tauri owns chain probing, source adapter calls, provider redaction, sample bounding, aggregation, and ABI/cache decoding. React owns the desktop form, source visibility, analysis read model display, local-only copy actions, and stale request guards. External explorer/indexer data is always advisory and source-labeled; RPC remains the source for chain/code identity.

**Tech Stack:** Tauri 2, Rust, ethers-rs, React, TypeScript, Vitest, existing ABI registry/cache, existing diagnostics/export redaction.

---

## File Structure

- `docs/specs/evm-wallet-workbench.md`: project-level P6-2 contract address hot analysis spec.
- `docs/superpowers/plans/2026-04-30-p6-2-hot-contract-analysis.md`: this task plan.
- `src-tauri/src/commands/hot_contract/mod.rs`: read-only command entrypoint and orchestration glue only.
- `src-tauri/src/commands/hot_contract/types.rs`: input/output structs, source status enums-as-strings, sample rows, selector/topic rows, and uncertainty structs.
- `src-tauri/src/commands/hot_contract/source.rs`: configured sampling source lookup, minimal outbound request construction, fixture adapter, provider status normalization, and secret-safe provider error summaries.
- `src-tauri/src/commands/hot_contract/code.rs`: RPC chainId/code probing and contract identity summaries.
- `src-tauri/src/commands/hot_contract/aggregate.rs`: selector/topic aggregation and bounded example rows.
- `src-tauri/src/commands/hot_contract/decode.rs`: ABI/cache selector-topic decode and uncertainty mapping.
- `src-tauri/src/commands/hot_contract/tests.rs`: Rust unit tests and bounded provider fixtures.
- `src-tauri/src/commands/mod.rs` and `src-tauri/src/lib.rs`: command registration only.
- `src-tauri/src/commands/abi_registry.rs`: source-of-truth for reusable `AbiDataSourceConfigRecord`, provider config fingerprinting, base URL validation, and `api_key_ref` resolution; P6-2 may expose small `pub(crate)` helper functions here rather than duplicating provider config/secret logic.
- `src/lib/tauri.ts`: frontend command types and `fetchHotContractAnalysis`.
- `src/core/hotContract/readModel.ts` and `src/core/hotContract/readModel.test.ts`: small TS-only display helpers for derived labels, status grouping, and copy summaries. Do not duplicate Rust aggregation logic here.
- `src/features/hotContract/HotContractAnalysisView.tsx` and `src/features/hotContract/HotContractAnalysisView.test.tsx`: desktop UI.
- `src/app/AppShell.tsx`, `src/app/AppShell.test.tsx`, `src/styles.css`: navigation entry and scoped styles.
- `src-tauri/src/diagnostics.rs`, `src/core/diagnostics/selectors.ts`, and existing diagnostics tests: redaction/disclosure updates for P6-2 provider sampling diagnostics.

---

### Task P6-2a: Spec And Plan

**Files:**
- Modify: `README.md`
- Modify: `docs/specs/evm-wallet-workbench.md`
- Create: `docs/superpowers/plans/2026-04-30-p6-2-hot-contract-analysis.md`
- Modify: `docs/superpowers/plans/2026-04-27-evm-wallet-workbench-p3-p4.md`

- [ ] **Step 1: Update current capability wording**

  Move P6-1 tx hash analysis from future wording into current read-only capability wording in README and project spec. Keep hot contract analysis as future/P6-2.

- [ ] **Step 2: Add P6-2 project spec**

  Add a `Contract address hot 交易/selector 分析入口` section covering product workflow, data source trust, read model, privacy/diagnostics, storage/history integration, UX boundaries, and task split.

- [ ] **Step 3: Write this P6-2 implementation plan**

  Save the plan at `docs/superpowers/plans/2026-04-30-p6-2-hot-contract-analysis.md`.

- [ ] **Step 4: Cross-link the legacy P3/P4 plan**

  Replace the old short P6-2 bullet in `docs/superpowers/plans/2026-04-27-evm-wallet-workbench-p3-p4.md` with a pointer to this plan and a short task list.

- [ ] **Step 5: Verify docs**

  Run: `git diff --check`

  Expected: exit 0.

- [ ] **Step 6: Commit**

  ```bash
  git add README.md docs/specs/evm-wallet-workbench.md docs/superpowers/plans/2026-04-27-evm-wallet-workbench-p3-p4.md docs/superpowers/plans/2026-04-30-p6-2-hot-contract-analysis.md
  git commit -m "Specify hot contract analysis plan"
  ```

---

### Task P6-2b: Rust Source Fetch Model

**Files:**
- Create: `src-tauri/src/commands/hot_contract/mod.rs`
- Create: `src-tauri/src/commands/hot_contract/types.rs`
- Create: `src-tauri/src/commands/hot_contract/source.rs`
- Create: `src-tauri/src/commands/hot_contract/code.rs`
- Create: `src-tauri/src/commands/hot_contract/aggregate.rs`
- Create: `src-tauri/src/commands/hot_contract/decode.rs`
- Create: `src-tauri/src/commands/hot_contract/tests.rs`
- Modify: `src-tauri/src/commands/abi_registry.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Write failing Rust tests for input and chain/source boundaries**

  Add tests in `src-tauri/src/commands/hot_contract/tests.rs` for:
  - invalid contract address returns `validationError`;
  - missing selected RPC identity blocks before remote lookup;
  - wrong remote chain returns `chainMismatch`;
  - RPC unavailable returns bounded `rpcFailure`;
  - source not configured returns `sourceUnavailable` while still returning RPC code identity when possible.
  - configured sampling sources are loaded from existing `AbiDataSourceConfigRecord` records by `chainId + provider_config_id`.

  Run: `cargo test --manifest-path src-tauri/Cargo.toml hot_contract`

  Expected before implementation: tests fail because the command/model does not exist.

- [ ] **Step 2: Implement read-only command skeleton**

  Define `HotContractAnalysisInput`, `HotContractSelectedRpcInput`, `HotContractSamplingSourceInput`, `HotContractAnalysisReadModel`, `HotContractRpcSummary`, `HotContractCodeSummary`, `HotContractSourceStatus`, and `HotContractSampleCoverage` in `types.rs`.

  Register `fetch_hot_contract_analysis` in `commands/mod.rs` and `lib.rs`. Wire `mod.rs` to declare `types`, `source`, `code`, `aggregate`, `decode`, and test modules. In P6-2b, `aggregate.rs` and `decode.rs` should expose no-op/empty read-model helpers that return empty selector/topic/decode arrays; P6-2c owns their real implementation. The command must not write storage or call transaction submission code.

- [ ] **Step 3: Implement RPC chain/code probing**

  Reuse existing selected RPC identity checks and endpoint redaction patterns from `tx_analysis.rs` inside `code.rs`. Fetch `eth_chainId` and `eth_getCode(contract, latest)`. Return code byte length and `keccak256-v1` code hash. Treat empty code as explicit `codeAbsent`.

- [ ] **Step 4: Write failing provider-boundary tests**

  Add fixture adapter tests for:
  - outbound provider request contains only chain/source identity, contract address, and bounded window/cursor;
  - local history labels, notes, wallet inventory, token watchlist inventory, and ABI catalog are not present;
  - source responses above the sample cap are truncated with `omittedSamples`;
  - provider errors with URLs/API keys/tokens are redacted.
  - disabled, wrong-chain, stale, or missing ABI data source configs cannot be used as hot sampling sources.

- [ ] **Step 5: Implement bounded sample adapter**

  In `source.rs`, reuse the existing ABI data source registry as the sampling source-of-truth. Do not create a second provider config file or store real secrets in hot contract analysis. Add an internal trait or helper that accepts fixture responses in tests and later real source adapters. Initial source kinds may be `customIndexer` and `explorerConfigured`; unsupported sources return `sourceUnsupported`. Normalize each sample to tx hash, block number/time, from, to, value, status, selector, calldata length/hash, log topic0 summaries, and provider label fields.

- [ ] **Step 6: Verify**

  Run:
  - `cargo test --manifest-path src-tauri/Cargo.toml hot_contract`
  - `npm run typecheck`
  - `git diff --check`

- [ ] **Step 7: Commit**

  ```bash
  git add src-tauri/src/commands/hot_contract src-tauri/src/commands/abi_registry.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/lib/tauri.ts
  git commit -m "Add hot contract source fetch model"
  ```

---

### Task P6-2c: Selector And Topic Aggregation Read Model

**Files:**
- Modify: `src-tauri/src/commands/hot_contract/types.rs`
- Modify: `src-tauri/src/commands/hot_contract/aggregate.rs`
- Modify: `src-tauri/src/commands/hot_contract/decode.rs`
- Modify: `src-tauri/src/commands/hot_contract/tests.rs`
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Write failing aggregation tests**

  Add Rust tests for sampled ERC-20 `transfer`, ERC-20 `approve`, revoke-by-zero approval, Disperse batch selector, unknown raw selector, contract creation interaction, and event topic summaries.

  Expected failures: missing selector/topic aggregation fields and classification candidates.

- [ ] **Step 2: Implement aggregation model**

  Add selector rows with selector, sampled call count, sample share, unique sender count when available, success/revert/unknown counts, first/last block/time, native value aggregate summary, example tx hashes, source/confidence, and advisory labels.

- [ ] **Step 3: Write failing ABI/cache uncertainty tests**

  Cover selector collision, overloaded signatures, stale ABI, unverified ABI, proxy uncertainty, event topic conflict, malformed calldata/log, missing logs, provider partial sample, and unknown selector.

- [ ] **Step 4: Implement decode and uncertainty statuses**

  Consume existing ABI registry/cache read-only helpers. Do not fetch arbitrary ABI here. Mark all explorer/indexer labels as advisory. Do not classify candidates as truth.

- [ ] **Step 5: Enforce bounded payloads**

  Add tests that full calldata, full logs, full revert data, provider raw response body, API key, query token, private key, mnemonic, raw signed tx, and secret URL never appear in serialized read models or errors.

- [ ] **Step 6: Verify**

  Run:
  - `cargo test --manifest-path src-tauri/Cargo.toml hot_contract`
  - `cargo test --manifest-path src-tauri/Cargo.toml tx_analysis`
  - `npm run typecheck`
  - `git diff --check`

- [ ] **Step 7: Commit**

  ```bash
  git add src-tauri/src/commands/hot_contract src/lib/tauri.ts
  git commit -m "Aggregate hot contract selectors and topics"
  ```

---

### Task P6-2d: Desktop Hot Contract UI

**Files:**
- Create: `src/features/hotContract/HotContractAnalysisView.tsx`
- Create: `src/features/hotContract/HotContractAnalysisView.test.tsx`
- Create: `src/core/hotContract/readModel.ts`
- Create: `src/core/hotContract/readModel.test.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing UI tests**

  Cover invalid contract address, chain/RPC not ready, source missing, RPC-only limited state, stale request guard, sampled selector rows, event/topic rows, example tx rows, advisory labels, copy actions, and no full payload rendering.

- [ ] **Step 2: Implement view shell and command call**

  Add a desktop tab/entry for hot contract analysis. Inputs: contract address, optional tx hash seed display, source selector, bounded sample limit/window, and Analyze button. Use `fetchHotContractAnalysis` from `src/lib/tauri.ts`.

- [ ] **Step 3: Render read model sections**

  Render contract identity, provider visibility, sample coverage, selector summary table, event/topic summary, uncertainty badges, example rows, and errors. Use compact operational UI, not a landing page.

- [ ] **Step 4: Implement copy actions**

  Copy only contract address, selector, topic, code hash, ABI/source hash, sample tx hash, and bounded summary. Never copy provider URL secret, API key, full calldata, full logs, or raw provider body.

- [ ] **Step 5: Verify**

  Run:
  - `npm test -- src/features/hotContract src/app/AppShell.test.tsx`
  - `npm run typecheck`
  - `git diff --check`

- [ ] **Step 6: Commit**

  ```bash
  git add src/features/hotContract src/core/hotContract src/app/AppShell.tsx src/app/AppShell.test.tsx src/styles.css
  git commit -m "Add hot contract analysis UI"
  ```

---

### Task P6-2e: Diagnostics, Redaction, And Local Hints

**Files:**
- Modify: `src-tauri/src/diagnostics.rs`
- Modify: `src/core/diagnostics/selectors.ts`
- Modify: `src/core/diagnostics/selectors.test.ts`
- Modify: `src/features/diagnostics/DiagnosticsView.test.tsx`
- Modify: `src/features/hotContract/HotContractAnalysisView.tsx`
- Modify: `src/features/hotContract/HotContractAnalysisView.test.tsx`

- [ ] **Step 1: Write failing redaction tests**

  Add diagnostics load/export tests for hot contract provider payloads containing API keys, query tokens, bearer/basic auth, full provider URL, full calldata, full logs, raw provider body, local history match details, classification truth, and source raw response.

- [ ] **Step 2: Extend diagnostics sanitizer vocabulary**

  Redact `hotContractSample`, `providerRawResponse`, `sampleCalldata`, `sampleLogs`, `sourceApiKey`, `sourceQueryToken`, `localHistoryExamples`, and `classificationTruth` shaped fields while preserving bounded selector/topic/hash/count fields.

- [ ] **Step 3: Add local hint boundary**

  If hot contract analysis reads local history, expose only bounded hints such as local example count or whether a sample tx is known locally. Do not show local labels, notes, raw typed metadata, account inventory, or history details in provider request input.

- [ ] **Step 4: Verify**

  Run:
  - `npm test -- src/core/diagnostics src/features/diagnostics src/features/hotContract`
  - `cargo test --manifest-path src-tauri/Cargo.toml diagnostics`
  - `cargo test --manifest-path src-tauri/Cargo.toml hot_contract`
  - `git diff --check`

- [ ] **Step 5: Commit**

  ```bash
  git add src-tauri/src/diagnostics.rs src/core/diagnostics src/features/diagnostics src/features/hotContract
  git commit -m "Harden hot contract diagnostics redaction"
  ```

---

### Task P6-2f: Integration And Security Regressions

**Files:**
- Modify: `src/features/hotContract/HotContractAnalysisView.test.tsx`
- Modify: `src-tauri/src/commands/hot_contract/tests.rs`
- Modify: `README.md`
- Modify: `docs/specs/evm-wallet-workbench.md`

- [ ] **Step 1: Add cross-layer regression tests**

  Cover sampled ERC-20 transfer/approval/revoke selectors, managed ABI selector, unknown raw selector, batch disperse selector, proxy uncertainty, wrong chain, source unavailable, rate limit, partial sample, stale/unverified ABI wording, advisory source labeling, no full payload persistence, and no local context upload.

- [ ] **Step 2: Confirm existing workflows do not regress**

  Run focused suites for tx analysis, ABI, raw calldata, assets/revoke, diagnostics, and hot contract analysis together.

- [ ] **Step 3: Update current capability docs**

  Once P6-2 implementation is complete, move hot contract analysis from future wording into current read-only capability wording. Keep full portfolio/NFT discovery, full authorization discovery, risk scoring, batch revoke, wallet recovery automation, and browser-version work out of current capabilities.

- [ ] **Step 4: Verify full milestone**

  Run:
  - `npm test -- src/features src/core`
  - `npm run typecheck`
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - `scripts/run-anvil-check.sh`
  - `git diff --check`

- [ ] **Step 5: Commit**

  ```bash
  git add src/features src/core src-tauri/src README.md docs/specs/evm-wallet-workbench.md
  git commit -m "Add hot contract integration regressions"
  ```

---

## Milestone Merge

After P6-2f passes spec review, code quality review, controller verification, commit, and push:

- Fast-forward `main` to the P6-2 branch if `origin/main` is an ancestor.
- Re-run `npm test -- src/features src/core`, `npm run typecheck`, `cargo test --manifest-path src-tauri/Cargo.toml`, `scripts/run-anvil-check.sh`, and `git diff --check` on the merged result.
- Push `main`.
- Clean up local P6-2 worktrees after successful push.
