# P12 Asset Watchlist And Balance Snapshots Design

## 1. Purpose

P12 adds the first read-only chain-aware surface to the PWA: selected local accounts can refresh and inspect native plus watched ERC-20 balances after the app verifies that the configured RPC endpoint is serving the selected chain.

This milestone closes the asset visibility gap identified against `https://985monitor.xyz/wallet/` without crossing into transaction signing, broadcasting, nonce submission, distribution, inscription, ABI write calls, reverse parsing, or durable transaction history. It creates the data foundation later milestones need for distribution, collection, calldata, and contract-call workflows.

## 2. Product Scope

### In scope

- Enable the `资产` module as a real read-only workspace.
- Show active chain, native symbol, primary RPC label, selected-account count, latest refresh state, and explicit chain validation state.
- Validate `eth_chainId` through the primary enabled RPC before any balance refresh.
- Display native balances for selected local accounts.
- Add a browser-local ERC-20 watchlist for the active chain.
- Display watched ERC-20 balances for selected local accounts.
- Support adding and removing watched ERC-20 contracts by address, symbol, decimals, and label.
- Preserve watched asset definitions in browser localStorage with the same non-secret boundary as chain/RPC config.
- Keep fetched balance snapshots in current page memory only.
- Show stale, failed, chain-mismatch, no-RPC, and partial-refresh states explicitly.
- Redact RPC URL details from user-facing errors, tests, logs, and status summaries.
- Keep current account-library and settings behavior intact.

### Out of scope

- Signing, broadcasting, transaction queue execution, nonce management, and real history writes.
- Distribution or collection drafts.
- ERC-20 approvals, allowance scanning, or revoke actions.
- NFT discovery and portfolio indexing.
- Automatic token discovery from chain/explorer APIs.
- Explorer API keys or secret-bearing RPC credential storage.
- Persisting fetched balance snapshots across reloads.
- Cross-chain aggregation. P12 shows the active chain only.

## 3. User Experience

When the user opens `资产` while the vault is locked, the page explains that local accounts must be unlocked before balances can be refreshed. It may still show the active chain/RPC context and watched-token editor.

When unlocked, the page shows:

- chain/RPC status strip;
- selected-account count and total account count;
- refresh button;
- native asset summary table for selected accounts;
- watched ERC-20 editor;
- token balance table grouped by watched token and account.

The refresh button is disabled when there is no active chain, no enabled primary RPC, no unlocked vault session, or no selected accounts. If no accounts are selected, the page says so explicitly and links the mental next step to the account library without changing selection itself.

P12 should keep the UI Chinese-first and dense enough for desktop operation while remaining readable on mobile. It should not use cards nested inside cards. Tables can scroll horizontally on narrow screens.

## 4. Data Model

### Persistent watched assets

Create a browser asset registry state stored in localStorage:

```ts
export const BROWSER_ASSET_REGISTRY_SCHEMA_VERSION = 1;

export interface BrowserWatchedErc20Asset {
  id: string;
  chainId: number;
  contractAddress: string;
  symbol: string;
  decimals: number;
  label: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserAssetRegistryState {
  schemaVersion: typeof BROWSER_ASSET_REGISTRY_SCHEMA_VERSION;
  watchedErc20Assets: BrowserWatchedErc20Asset[];
  updatedAt: string;
}
```

Validation rules:

- `contractAddress` must be a valid EVM address and stored in checksum or normalized hex form.
- `symbol` is trimmed and uppercased, with a short fallback such as `TOKEN`.
- `decimals` is an integer from 0 through 36.
- `label` is trimmed and falls back to `symbol`.
- State validation rejects malformed schema versions, invalid addresses, invalid decimals, and non-boolean `enabled`.

The registry is not part of the encrypted vault because ERC-20 contract watch definitions are not secret-bearing. It must not store balances, account labels, mnemonics, private keys, passwords, raw signed transactions, or RPC secrets.

### Session-only balance snapshots

Create session-only snapshot types:

```ts
export type AssetRefreshStatus =
  | "idle"
  | "validating-chain"
  | "refreshing"
  | "success"
  | "partial"
  | "failed"
  | "chain-mismatch"
  | "no-rpc"
  | "no-selected-accounts";

export interface NativeBalanceSnapshot {
  chainId: number;
  accountAddress: string;
  balanceWei: string;
  blockNumber: number | null;
  refreshedAt: string;
}

export interface Erc20BalanceSnapshot {
  chainId: number;
  tokenAddress: string;
  accountAddress: string;
  balanceRaw: string;
  blockNumber: number | null;
  refreshedAt: string;
}
```

Snapshots live in React state inside the active PWA session. They reset on reload and are not written to localStorage, IndexedDB, exports, diagnostics, or history.

## 5. RPC Service Boundary

Add a small browser RPC client abstraction rather than placing `fetch` calls directly in React components.

Required operations:

- `eth_chainId` for identity validation.
- `eth_blockNumber` for snapshot metadata.
- `eth_getBalance` for native balances.
- `eth_call` against `balanceOf(address)` for ERC-20 balances.

The client must:

- use JSON-RPC `POST`;
- reject invalid HTTP responses and JSON-RPC errors;
- parse hex quantities through bigint-safe helpers;
- expose sanitized error messages that never include the full RPC URL;
- support dependency injection in tests.

P12 does not need websocket subscriptions, multicall batching, explorer APIs, or automatic token metadata fetching. If refresh volume becomes too high, a later milestone can add batching or multicall after the queue/rate-limit model exists.

## 6. Refresh Flow

Refresh proceeds in this order:

1. Read active chain and primary enabled RPC endpoint.
2. Read selected accounts from the hot vault session.
3. If no RPC exists, set status `no-rpc`.
4. If no selected accounts exist, set status `no-selected-accounts`.
5. Call `eth_chainId`.
6. If returned chainId does not equal the active chain config, set status `chain-mismatch`, clear only the in-flight result, and keep previous snapshots visibly stale.
7. Call `eth_blockNumber`.
8. Refresh native balances for selected accounts.
9. Refresh watched ERC-20 balances for enabled tokens on the active chain.
10. If all calls pass, set status `success` with new snapshots.
11. If some balance calls fail after chain validation passes, set status `partial`, show successful rows, and show per-row errors for failures.
12. If all balance calls fail, set status `failed` and keep previous snapshots as stale rather than silently zeroing values.

Each refresh receives its own request id. Late responses from an older refresh must not overwrite a newer refresh result.

## 7. Display Rules

- Native balances display formatted decimal values using the active chain native symbol.
- ERC-20 balances display formatted decimal values using token decimals and symbol.
- Raw values remain available internally as strings for later workflow handoff.
- Missing data shows `未刷新`, `失败`, or `陈旧` state, never `0` unless the RPC returned an actual zero balance.
- Chain mismatch shows expected and actual chain IDs, not the RPC URL.
- Partial failures identify account, token if applicable, and sanitized error category.
- User-facing text must not include full RPC URLs, API keys, tokens, mnemonics, private keys, passwords, raw signed transactions, local absolute paths, or serialized vault material.

## 8. Integration Points

### Shell navigation

`assets` becomes a `ready` module once P12 implementation is complete. Until then the spec/plan/status docs may describe it as in progress.

### PwaShell

`PwaShell` owns:

- loading and saving the asset registry;
- session-only balance refresh state;
- passing selected accounts, active chain, primary RPC, watched tokens, and refresh callbacks to the asset workspace.

### Future milestones

P13 queue/history will not reuse P12 snapshots as authoritative nonce or spendable-balance state. It may use them as display hints only.

P14 distribution/collection may use P12 selected-account asset rows as input candidates, but send-time balance checks must still revalidate chain identity and current balances.

## 9. Error Handling And Security

- A locked vault cannot refresh account balances.
- Chain mismatch blocks refresh.
- Failed token calls must not erase native balances that were successfully refreshed.
- Removing a token from the watchlist removes future display rows but does not mutate account vault state.
- Refresh errors are sanitized.
- Tests must cover redaction of RPC URLs containing fake secrets.
- No P12 code path may request the vault password, derive private keys, sign a transaction, broadcast a transaction, or write a transaction history record.

## 10. Tests

Focused tests must cover:

- Asset registry validation, add/remove/update behavior, and per-chain filtering.
- Asset registry storage persists token definitions but not balance snapshots.
- RPC chainId validation success and mismatch.
- Native balance refresh for selected accounts.
- ERC-20 `balanceOf` call encoding and balance parsing.
- Partial failure status without silent zeroing.
- Sanitized errors that omit RPC URLs and token-like path segments.
- Locked vault and no-selected-accounts UI states.
- Asset module does not show signing, broadcast, submit, approve, distribute, collect, or queue execution controls.
- Browser smoke opens the asset module on desktop and mobile production preview and verifies the read-only safety boundary.

## 11. Acceptance Criteria

P12 is complete when:

- `资产` is a real read-only module on `main`.
- A user can unlock a vault, select accounts, add a watched ERC-20, refresh native and ERC-20 balances through a chain-validated RPC, and see explicit status for success, partial failure, stale data, no selected accounts, no RPC, and chain mismatch.
- Balance snapshots reset on reload.
- Watched ERC-20 definitions persist locally.
- RPC URL secrets are not exposed in UI errors, tests, logs, or status summaries.
- No signing, broadcasting, queue execution, distribution, collection, ABI write, inscription execution, reverse parsing, approval, or transaction history write behavior is introduced.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run smoke:browser`, and `git diff --check` pass before milestone merge.
