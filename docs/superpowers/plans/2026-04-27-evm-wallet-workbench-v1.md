# EVM Wallet Workbench V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first macOS Tauri-based EVM wallet workbench with a single encrypted mnemonic vault, multi-chain account browsing, and a complete native-token transfer loop.

**Architecture:** Keep React responsible for UI state and read-only RPC queries, while Tauri/Rust owns vault decryption, BIP-44 derivation, signing, broadcast, and durable local storage. Model accounts as chain-agnostic identities plus `account + chain` state, and model transactions as `Intent -> Submission -> ChainOutcome` so future ERC-20 and contract-call work can plug into the same execution spine.

**Tech Stack:** React 18, TypeScript, Vite, Tauri 2, Rust, ethers v6, Vitest, Testing Library, Anvil

---

## File Structure

### Frontend

- Modify: `package.json`
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/test/render.tsx`
- Create: `src/app/AppShell.tsx`
- Create: `src/app/AppShell.test.tsx`
- Create: `src/app/session.ts`
- Create: `src/app/store.ts`
- Create: `src/features/unlock/UnlockView.tsx`
- Create: `src/features/accounts/AccountsView.tsx`
- Create: `src/features/transfer/TransferView.tsx`
- Create: `src/features/history/HistoryView.tsx`
- Create: `src/features/settings/SettingsView.tsx`
- Create: `src/core/chains/registry.ts`
- Create: `src/core/chains/registry.test.ts`
- Create: `src/core/transactions/draft.ts`
- Create: `src/core/transactions/draft.test.ts`
- Create: `src/core/history/reconciler.ts`
- Create: `src/core/history/reconciler.test.ts`
- Create: `src/lib/tauri.ts`
- Create: `src/lib/rpc.ts`

### Rust / Tauri

- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/models.rs`
- Create: `src-tauri/src/session.rs`
- Create: `src-tauri/src/storage.rs`
- Create: `src-tauri/src/vault.rs`
- Create: `src-tauri/src/accounts.rs`
- Create: `src-tauri/src/transactions.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/vault.rs`
- Create: `src-tauri/src/commands/accounts.rs`
- Create: `src-tauri/src/commands/transactions.rs`

### Tests and Fixtures

- Create: `src-tauri/tests/vault_roundtrip.rs`
- Create: `src-tauri/tests/account_commands.rs`
- Create: `src-tauri/tests/native_transfer.rs`
- Create: `scripts/run-anvil-check.sh`

---

### Task 1: Bootstrap Tauri, Vitest, and the New App Shell

**Files:**
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/test/render.tsx`
- Create: `src/app/AppShell.tsx`
- Create: `src/app/AppShell.test.tsx`
- Create: `src/features/unlock/UnlockView.tsx`
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `package.json`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Test: `src/app/AppShell.test.tsx`

- [ ] **Step 1: Write the failing shell test**

```tsx
// src/app/AppShell.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("renders the locked workspace when no session is active", () => {
    render(<AppShell session={{ status: "locked" }} />);

    expect(screen.getByRole("heading", { name: "EVM Wallet Workbench" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock Vault" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Accounts" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/AppShell.test.tsx`

Expected: FAIL with `Cannot find module './AppShell'` or an equivalent missing-file error.

- [ ] **Step 3: Add the minimal shell, test harness, scripts, and Tauri scaffold**

```json
// package.json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "jsdom": "^25.0.1",
    "vitest": "^2.1.8"
  }
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

```ts
// src/test/setup.ts
import "@testing-library/jest-dom/vitest";
```

```tsx
// src/test/render.tsx
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

export function renderScreen(ui: ReactElement) {
  return render(ui);
}
```

```tsx
// src/features/unlock/UnlockView.tsx
export function UnlockView() {
  return (
    <main className="locked-panel">
      <button type="button">Unlock Vault</button>
    </main>
  );
}
```

```tsx
// src/app/AppShell.tsx
import { UnlockView } from "../features/unlock/UnlockView";

export interface AppShellProps {
  session: { status: "locked" | "ready" };
}

export function AppShell({ session }: AppShellProps) {
  return (
    <div className="workbench-shell">
      <header className="workbench-header">
        <h1>EVM Wallet Workbench</h1>
      </header>
      {session.status === "locked" ? (
        <UnlockView />
      ) : (
        <main className="workspace-tabs" />
      )}
    </div>
  );
}
```

```tsx
// src/App.tsx
import { AppShell } from "./app/AppShell";

export function App() {
  return <AppShell session={{ status: "locked" }} />;
}
```

```tsx
// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

```css
/* src/styles.css */
:root {
  color-scheme: dark;
  --bg: #121318;
  --panel: #181b22;
  --border: #313744;
  --text: #f4f6fb;
  --muted: #97a0b5;
  --accent: #00a56a;
  --danger: #d83c3c;
  font-family: "SF Pro Display", "PingFang SC", "Helvetica Neue", sans-serif;
}

body {
  margin: 0;
  background: linear-gradient(180deg, #101219 0%, #151922 100%);
  color: var(--text);
}

.workbench-shell {
  min-height: 100vh;
  padding: 24px;
}

.workbench-header {
  margin-bottom: 24px;
}

.locked-panel {
  display: grid;
  min-height: 280px;
  place-items: center;
  border: 1px solid var(--border);
  background: rgba(24, 27, 34, 0.92);
}
```

```toml
# src-tauri/Cargo.toml
[package]
name = "wallet-workbench"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2.0.0", features = [] }

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2.0.0", features = [] }

[lib]
name = "wallet_workbench_lib"
crate-type = ["staticlib", "cdylib", "rlib"]
```

```json
// src-tauri/tauri.conf.json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "EVM Wallet Workbench",
  "version": "0.1.0",
  "identifier": "com.defiunited.walletworkbench",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist",
    "devUrl": "http://127.0.0.1:5173"
  },
  "app": {
    "windows": [
      {
        "title": "EVM Wallet Workbench",
        "width": 1440,
        "height": 960
      }
    ]
  }
}
```

```rust
// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    wallet_workbench_lib::run();
}
```

```rust
// src-tauri/src/lib.rs
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
```

- [ ] **Step 4: Run the new checks**

Run: `npm run test -- src/app/AppShell.test.tsx`

Expected: PASS with `1 passed`.

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: PASS with no Rust compile errors.

- [ ] **Step 5: Commit**

```bash
git add package.json vitest.config.ts src/App.tsx src/main.tsx src/styles.css src/app/AppShell.tsx src/app/AppShell.test.tsx src/features/unlock/UnlockView.tsx src/test/setup.ts src/test/render.tsx src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/src/main.rs src-tauri/src/lib.rs
git commit -m "feat: bootstrap tauri wallet workbench shell"
```

### Task 2: Build the Rust Vault and Durable Storage Core

**Files:**
- Create: `src-tauri/src/models.rs`
- Create: `src-tauri/src/session.rs`
- Create: `src-tauri/src/storage.rs`
- Create: `src-tauri/src/vault.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/vault.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/tests/vault_roundtrip.rs`
- Test: `src-tauri/tests/vault_roundtrip.rs`

- [ ] **Step 1: Write the failing Rust integration test**

```rust
// src-tauri/tests/vault_roundtrip.rs
use wallet_workbench_lib::vault::{decrypt_mnemonic, encrypt_mnemonic};

#[test]
fn encrypts_and_decrypts_a_mnemonic_roundtrip() {
    let phrase = "test test test test test test test test test test test junk";
    let password = "correct horse battery staple";

    let blob = encrypt_mnemonic(phrase, password).expect("encrypt");
    let roundtrip = decrypt_mnemonic(&blob, password).expect("decrypt");

    assert_eq!(roundtrip, phrase);
}
```

- [ ] **Step 2: Run the Rust test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml encrypts_and_decrypts_a_mnemonic_roundtrip -- --exact`

Expected: FAIL with unresolved import errors for `vault::{decrypt_mnemonic, encrypt_mnemonic}`.

- [ ] **Step 3: Implement the vault blob, storage paths, and Tauri vault commands**

```toml
# src-tauri/Cargo.toml
[dependencies]
aes-gcm = "0.10"
argon2 = "0.5"
base64 = "0.22"
bip39 = "2.1"
rand = "0.8"
secrecy = "0.10"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2.0.0", features = [] }
thiserror = "2"
dirs = "6"
zeroize = "1"
```

```rust
// src-tauri/src/models.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultBlob {
    pub version: u8,
    pub salt_b64: String,
    pub iv_b64: String,
    pub ciphertext_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub default_chain_id: u64,
    pub idle_lock_minutes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub status: String,
}
```

```rust
// src-tauri/src/session.rs
use std::sync::{Mutex, OnceLock};

static SESSION_MNEMONIC: OnceLock<Mutex<Option<String>>> = OnceLock::new();

pub fn write_session_mnemonic(mnemonic: String) {
    let slot = SESSION_MNEMONIC.get_or_init(|| Mutex::new(None));
    *slot.lock().expect("session lock") = Some(mnemonic);
}

pub fn clear_session_mnemonic() {
    let slot = SESSION_MNEMONIC.get_or_init(|| Mutex::new(None));
    *slot.lock().expect("session lock") = None;
}

pub fn with_session_mnemonic<T>(f: impl FnOnce(&str) -> Result<T, String>) -> Result<T, String> {
    let slot = SESSION_MNEMONIC.get_or_init(|| Mutex::new(None));
    let guard = slot.lock().expect("session lock");
    let mnemonic = guard.as_deref().ok_or_else(|| "vault is locked".to_string())?;
    f(mnemonic)
}
```

```rust
// src-tauri/src/storage.rs
use std::fs;
use std::path::PathBuf;

pub fn app_dir() -> PathBuf {
    let base = dirs::home_dir().expect("home dir");
    base.join("Library/Application Support/EVMWalletWorkbench")
}

pub fn ensure_app_dir() -> PathBuf {
    let dir = app_dir();
    fs::create_dir_all(&dir).expect("create app dir");
    dir
}

pub fn vault_path() -> PathBuf {
    ensure_app_dir().join("vault.json")
}

pub fn accounts_path() -> PathBuf {
    ensure_app_dir().join("accounts.json")
}

pub fn history_path() -> PathBuf {
    ensure_app_dir().join("tx-history.json")
}
```

```rust
// src-tauri/src/vault.rs
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use base64::Engine;
use rand::RngCore;
use serde_json;

use crate::models::VaultBlob;

pub fn encrypt_mnemonic(phrase: &str, password: &str) -> Result<VaultBlob, String> {
    let mut salt = [0u8; 16];
    let mut iv = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut iv);

    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), &salt, &mut key)
        .map_err(|e| e.to_string())?;

    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&iv), phrase.as_bytes())
        .map_err(|e| e.to_string())?;

    Ok(VaultBlob {
        version: 1,
        salt_b64: base64::engine::general_purpose::STANDARD.encode(salt),
        iv_b64: base64::engine::general_purpose::STANDARD.encode(iv),
        ciphertext_b64: base64::engine::general_purpose::STANDARD.encode(ciphertext),
    })
}

pub fn decrypt_mnemonic(blob: &VaultBlob, password: &str) -> Result<String, String> {
    let salt = base64::engine::general_purpose::STANDARD
        .decode(&blob.salt_b64)
        .map_err(|e| e.to_string())?;
    let iv = base64::engine::general_purpose::STANDARD
        .decode(&blob.iv_b64)
        .map_err(|e| e.to_string())?;
    let ciphertext = base64::engine::general_purpose::STANDARD
        .decode(&blob.ciphertext_b64)
        .map_err(|e| e.to_string())?;

    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), &salt, &mut key)
        .map_err(|e| e.to_string())?;

    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&iv), ciphertext.as_ref())
        .map_err(|_| "invalid password or vault data".to_string())?;

    String::from_utf8(plaintext).map_err(|e| e.to_string())
}
```

```rust
// src-tauri/src/commands/vault.rs
use std::fs;

use crate::models::VaultBlob;
use crate::storage::vault_path;
use crate::vault::{decrypt_mnemonic, encrypt_mnemonic};

#[tauri::command]
pub fn create_vault(mnemonic: String, password: String) -> Result<(), String> {
    let blob = encrypt_mnemonic(&mnemonic, &password)?;
    let raw = serde_json::to_string_pretty(&blob).map_err(|e| e.to_string())?;
    fs::write(vault_path(), raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unlock_vault(password: String) -> Result<crate::models::SessionSummary, String> {
    let raw = fs::read_to_string(vault_path()).map_err(|e| e.to_string())?;
    let blob: VaultBlob = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let mnemonic = decrypt_mnemonic(&blob, &password)?;
    crate::session::write_session_mnemonic(mnemonic);
    Ok(crate::models::SessionSummary {
        status: "ready".to_string(),
    })
}
```

```rust
// src-tauri/src/commands/mod.rs
pub mod vault;
```

```rust
// src-tauri/src/lib.rs
pub mod commands;
pub mod models;
pub mod session;
pub mod storage;
pub mod vault;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::vault::create_vault,
            commands::vault::unlock_vault,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
```

- [ ] **Step 4: Run the Rust checks**

Run: `cargo test --manifest-path src-tauri/Cargo.toml encrypts_and_decrypts_a_mnemonic_roundtrip -- --exact`

Expected: PASS with `1 passed`.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS with the vault integration test green.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/src/models.rs src-tauri/src/session.rs src-tauri/src/storage.rs src-tauri/src/vault.rs src-tauri/src/commands/mod.rs src-tauri/src/commands/vault.rs src-tauri/tests/vault_roundtrip.rs
git commit -m "feat: add encrypted vault storage core"
```

### Task 3: Add Account Registry, Derivation, and Default-Chain Scan

**Files:**
- Create: `src-tauri/src/accounts.rs`
- Create: `src-tauri/src/commands/accounts.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/tests/account_commands.rs`
- Create: `src/features/accounts/AccountsView.tsx`
- Create: `src/app/store.ts`
- Create: `src/lib/tauri.ts`
- Create: `src/lib/rpc.ts`
- Modify: `src-tauri/src/storage.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/account_commands.rs`

- [ ] **Step 1: Write the failing account derivation test**

```rust
// src-tauri/tests/account_commands.rs
use wallet_workbench_lib::accounts::derive_account_address;

#[test]
fn derives_expected_first_child_address() {
    let phrase = "test test test test test test test test test test test junk";
    let address = derive_account_address(phrase, 1).expect("derive");

    assert_eq!(address, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
}
```

- [ ] **Step 2: Run the account test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml derives_expected_first_child_address -- --exact`

Expected: FAIL with unresolved import errors for `accounts::derive_account_address`.

- [ ] **Step 3: Implement derivation, account metadata, and the first account view**

```toml
# src-tauri/Cargo.toml
[dependencies]
alloy-primitives = "0.8"
coins-bip32 = "0.12"
coins-bip39 = "0.12"
dirs = "6"
ethers = "2"
```

```rust
// src-tauri/src/accounts.rs
use coins_bip32::path::DerivationPath;
use coins_bip39::Mnemonic;
use ethers::signers::LocalWallet;

pub fn derive_wallet(phrase: &str, index: u32) -> Result<LocalWallet, String> {
    let mnemonic: Mnemonic<coins_bip39::English> = phrase.parse().map_err(|e| format!("{e}"))?;
    let seed = mnemonic.to_seed(None).map_err(|e| format!("{e}"))?;
    let path: DerivationPath = format!("m/44'/60'/0'/0/{index}")
        .parse()
        .map_err(|e| format!("{e}"))?;
    let derived = path.derive(&seed).map_err(|e| format!("{e}"))?;
    let secret = derived.private_key();
    LocalWallet::from_bytes(secret.as_slice()).map_err(|e| e.to_string())
}

pub fn derive_account_address(phrase: &str, index: u32) -> Result<String, String> {
    let wallet = derive_wallet(phrase, index)?;
    Ok(wallet.address().to_string())
}
```

```rust
// src-tauri/src/commands/accounts.rs
use serde::{Deserialize, Serialize};
use std::fs;

use crate::accounts::derive_account_address;
use crate::storage::accounts_path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountRecord {
    pub index: u32,
    pub address: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountSnapshotRecord {
    pub chain_id: u64,
    pub native_balance_wei: String,
    pub nonce: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAccountRecord {
    pub index: u32,
    pub address: String,
    pub label: String,
    pub snapshots: Vec<AccountSnapshotRecord>,
}

#[tauri::command]
pub fn derive_account(index: u32) -> Result<AccountRecord, String> {
    let address = crate::session::with_session_mnemonic(|mnemonic| derive_account_address(mnemonic, index))?;
    Ok(AccountRecord {
        index,
        address,
        label: format!("Account {index}"),
    })
}

#[tauri::command]
pub fn save_scanned_account(
    account: AccountRecord,
    chain_id: u64,
    native_balance_wei: String,
    nonce: u64,
) -> Result<StoredAccountRecord, String> {
    let path = accounts_path();
    let existing = match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<Vec<StoredAccountRecord>>(&raw).map_err(|e| e.to_string())?,
        Err(_) => Vec::new(),
    };

    let mut accounts = existing;
    let snapshot = AccountSnapshotRecord {
        chain_id,
        native_balance_wei,
        nonce,
    };

    if let Some(found) = accounts.iter_mut().find(|item| item.index == account.index) {
        found.address = account.address.clone();
        found.label = account.label.clone();
        if let Some(existing_snapshot) = found.snapshots.iter_mut().find(|item| item.chain_id == chain_id) {
            *existing_snapshot = snapshot;
        } else {
            found.snapshots.push(snapshot);
        }
    } else {
        accounts.push(StoredAccountRecord {
            index: account.index,
            address: account.address.clone(),
            label: account.label.clone(),
            snapshots: vec![snapshot],
        });
    }

    fs::write(&path, serde_json::to_string_pretty(&accounts).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    accounts
        .into_iter()
        .find(|item| item.index == account.index)
        .ok_or_else(|| "stored account missing after save".to_string())
}
```

```rust
// src-tauri/src/commands/mod.rs
pub mod accounts;
pub mod vault;
```

```ts
// src/lib/tauri.ts
import { invoke } from "@tauri-apps/api/core";
import { readAccountState } from "./rpc";

export interface AccountRecord {
  index: number;
  address: string;
  label: string;
}

export interface StoredAccountRecord extends AccountRecord {
  snapshots: Array<{
    chainId: number;
    nativeBalanceWei: string;
    nonce: number;
  }>;
}

export function deriveAccount(index: number) {
  return invoke<AccountRecord>("derive_account", { index });
}

export function saveScannedAccount(
  account: AccountRecord,
  chainId: number,
  nativeBalanceWei: bigint,
  nonce: number,
) {
  return invoke<StoredAccountRecord>("save_scanned_account", {
    account,
    chainId,
    nativeBalanceWei: nativeBalanceWei.toString(),
    nonce,
  });
}

export async function createAndScanAccount(index: number, chainId: number, rpcUrl: string) {
  const account = await deriveAccount(index);
  const snapshot = await readAccountState(rpcUrl, account.address);
  const stored = await saveScannedAccount(account, chainId, snapshot.nativeBalanceWei, snapshot.nonce);
  return {
    index: stored.index,
    address: stored.address,
    label: stored.label,
    nativeBalanceWei: snapshot.nativeBalanceWei,
    nonce: snapshot.nonce,
  };
}
```

```ts
// src/lib/rpc.ts
import { JsonRpcProvider } from "ethers";

export interface AccountChainState {
  nativeBalanceWei: bigint;
  nonce: number;
}

export async function readAccountState(rpcUrl: string, address: string): Promise<AccountChainState> {
  const provider = new JsonRpcProvider(rpcUrl);
  const [nativeBalanceWei, nonce] = await Promise.all([
    provider.getBalance(address),
    provider.getTransactionCount(address),
  ]);
  return { nativeBalanceWei, nonce };
}
```

```tsx
// src/features/accounts/AccountsView.tsx
import type { AccountRecord } from "../../lib/tauri";
import type { AccountChainState } from "../../lib/rpc";

export interface AccountsViewProps {
  accounts: Array<AccountRecord & AccountChainState>;
  onAddAccount: () => void;
}

export function AccountsView({ accounts, onAddAccount }: AccountsViewProps) {
  return (
    <section>
      <header>
        <h2>Accounts</h2>
        <button onClick={onAddAccount} type="button">Add Account</button>
      </header>
      <ul>
        {accounts.map((account) => (
          <li key={account.index}>
            <strong>{account.label}</strong>
            <span>{account.address}</span>
            <span>{account.nativeBalanceWei.toString()} wei</span>
            <span>nonce {account.nonce}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

```ts
// src/app/store.ts
import type { AccountRecord } from "../lib/tauri";
import type { AccountChainState } from "../lib/rpc";

export interface AppStore {
  sessionStatus: "locked" | "ready";
  defaultChainId: number;
  defaultRpcUrl: string;
  accounts: Array<AccountRecord & AccountChainState>;
}

export const initialStore: AppStore = {
  sessionStatus: "locked",
  defaultChainId: 1,
  defaultRpcUrl: "",
  accounts: [],
};
```

- [ ] **Step 4: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml derives_expected_first_child_address -- --exact`

Expected: PASS with the first-child derivation test green.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS with the account registry command compiling and persisting default-chain snapshots.

Run: `npm run typecheck`

Expected: PASS with the new account files compiling.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/accounts.rs src-tauri/src/commands/accounts.rs src-tauri/src/commands/mod.rs src-tauri/src/storage.rs src-tauri/tests/account_commands.rs src/features/accounts/AccountsView.tsx src/lib/tauri.ts src/lib/rpc.ts src/app/store.ts src-tauri/src/lib.rs
git commit -m "feat: add account derivation and account registry view"
```

### Task 4: Add Chain Registry and Custom RPC Identity Validation

**Files:**
- Create: `src/core/chains/registry.ts`
- Create: `src/core/chains/registry.test.ts`
- Modify: `src/lib/rpc.ts`
- Create: `src/features/settings/SettingsView.tsx`
- Test: `src/core/chains/registry.test.ts`

- [ ] **Step 1: Write the failing chain-registry test**

```ts
// src/core/chains/registry.test.ts
import { describe, expect, it } from "vitest";
import { validateCustomRpc } from "./registry";

describe("validateCustomRpc", () => {
  it("rejects a custom RPC whose returned chain id does not match the expected chain", async () => {
    const fetchChainId = async () => 8453n;

    await expect(
      validateCustomRpc(
        { id: "eth-mainnet", name: "Ethereum", chainId: 1n, rpcUrl: "https://rpc.example" },
        fetchChainId,
      ),
    ).rejects.toThrow("Remote chainId 8453 does not match expected chainId 1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/chains/registry.test.ts`

Expected: FAIL with `Cannot find module './registry'`.

- [ ] **Step 3: Implement built-in chains, RPC probing, and validation**

```ts
// src/core/chains/registry.ts
export interface ChainRecord {
  id: string;
  name: string;
  chainId: bigint;
  nativeSymbol: string;
  rpcUrl: string;
}

export const BUILT_IN_CHAINS: ChainRecord[] = [
  { id: "eth-mainnet", name: "Ethereum", chainId: 1n, nativeSymbol: "ETH", rpcUrl: "" },
  { id: "base-mainnet", name: "Base", chainId: 8453n, nativeSymbol: "ETH", rpcUrl: "" },
  { id: "arb-mainnet", name: "Arbitrum", chainId: 42161n, nativeSymbol: "ETH", rpcUrl: "" },
  { id: "op-mainnet", name: "Optimism", chainId: 10n, nativeSymbol: "ETH", rpcUrl: "" },
  { id: "bsc-mainnet", name: "BSC", chainId: 56n, nativeSymbol: "BNB", rpcUrl: "" },
  { id: "polygon-mainnet", name: "Polygon", chainId: 137n, nativeSymbol: "POL", rpcUrl: "" },
];

export async function validateCustomRpc(
  chain: ChainRecord,
  fetchChainId: (rpcUrl: string) => Promise<bigint>,
) {
  const remoteChainId = await fetchChainId(chain.rpcUrl);
  if (remoteChainId !== chain.chainId) {
    throw new Error(`Remote chainId ${remoteChainId} does not match expected chainId ${chain.chainId}`);
  }
  return { ...chain, chainId: remoteChainId };
}
```

```ts
// src/lib/rpc.ts
import { JsonRpcProvider } from "ethers";

export interface AccountChainState {
  nativeBalanceWei: bigint;
  nonce: number;
}

export async function readAccountState(rpcUrl: string, address: string): Promise<AccountChainState> {
  const provider = new JsonRpcProvider(rpcUrl);
  const [nativeBalanceWei, nonce] = await Promise.all([
    provider.getBalance(address),
    provider.getTransactionCount(address),
  ]);
  return { nativeBalanceWei, nonce };
}

export async function probeChainId(rpcUrl: string): Promise<bigint> {
  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  return network.chainId;
}
```

```tsx
// src/features/settings/SettingsView.tsx
import type { ChainRecord } from "../../core/chains/registry";

export interface SettingsViewProps {
  chains: ChainRecord[];
}

export function SettingsView({ chains }: SettingsViewProps) {
  return (
    <section>
      <h2>Settings</h2>
      <ul>
        {chains.map((chain) => (
          <li key={chain.id}>
            {chain.name} · chainId {chain.chainId.toString()}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- src/core/chains/registry.test.ts`

Expected: PASS with the custom RPC validation test green.

Run: `npm run typecheck`

Expected: PASS with the new chain types compiling.

- [ ] **Step 5: Commit**

```bash
git add src/core/chains/registry.ts src/core/chains/registry.test.ts src/lib/rpc.ts src/features/settings/SettingsView.tsx
git commit -m "feat: add chain registry and custom rpc validation"
```

### Task 5: Build Transfer Drafts, Freeze Rules, and Fee Guardrails

**Files:**
- Create: `src/core/transactions/draft.ts`
- Create: `src/core/transactions/draft.test.ts`
- Create: `src/features/transfer/TransferView.tsx`
- Test: `src/core/transactions/draft.test.ts`

- [ ] **Step 1: Write the failing transfer-draft test**

```ts
// src/core/transactions/draft.test.ts
import { describe, expect, it } from "vitest";
import { createTransferDraft } from "./draft";

describe("createTransferDraft", () => {
  it("flags fee risk when maxFeePerGas is far above the live reference fee", () => {
    const draft = createTransferDraft({
      chainId: 1n,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      valueWei: 10n,
      nonce: 7,
      gasLimit: 21_000n,
      maxFeePerGas: 150n,
      maxPriorityFeePerGas: 5n,
      liveMaxFeePerGas: 40n,
      estimatedGasLimit: 21_000n,
    });

    expect(draft.feeRisk).toBe("high");
    expect(draft.requiresSecondConfirmation).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/transactions/draft.test.ts`

Expected: FAIL with `Cannot find module './draft'`.

- [ ] **Step 3: Implement draft freezing and fee warnings**

```ts
// src/core/transactions/draft.ts
export type FeeRisk = "normal" | "high";

export interface TransferDraftInput {
  chainId: bigint;
  from: string;
  to: string;
  valueWei: bigint;
  nonce: number;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  liveMaxFeePerGas: bigint;
  estimatedGasLimit: bigint;
}

export interface TransferDraft {
  frozenKey: string;
  feeRisk: FeeRisk;
  requiresSecondConfirmation: boolean;
  submission: TransferDraftInput;
}

export function createTransferDraft(input: TransferDraftInput): TransferDraft {
  const highFee = input.maxFeePerGas > input.liveMaxFeePerGas * 3n;
  const highTip =
    input.liveMaxFeePerGas > 0n &&
    input.maxPriorityFeePerGas > input.liveMaxFeePerGas * 3n;
  const highGasLimit = input.gasLimit > input.estimatedGasLimit * 2n;

  return {
    frozenKey: [
      input.chainId.toString(),
      input.from,
      input.to,
      input.valueWei.toString(),
      input.nonce.toString(),
      input.gasLimit.toString(),
      input.maxFeePerGas.toString(),
      input.maxPriorityFeePerGas.toString(),
    ].join(":"),
    feeRisk: highFee || highTip || highGasLimit ? "high" : "normal",
    requiresSecondConfirmation: highFee || highTip || highGasLimit,
    submission: input,
  };
}
```

```tsx
// src/features/transfer/TransferView.tsx
import type { TransferDraft } from "../../core/transactions/draft";

export interface TransferViewProps {
  draft: TransferDraft | null;
}

export function TransferView({ draft }: TransferViewProps) {
  return (
    <section>
      <h2>Transfer</h2>
      {draft?.feeRisk === "high" && (
        <div role="alert">
          Gas settings are far above the live network reference. Review total cost before signing.
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- src/core/transactions/draft.test.ts`

Expected: PASS with the fee-risk test green.

Run: `npm run typecheck`

Expected: PASS with the transfer draft types compiling.

- [ ] **Step 5: Commit**

```bash
git add src/core/transactions/draft.ts src/core/transactions/draft.test.ts src/features/transfer/TransferView.tsx
git commit -m "feat: add transfer draft fee guardrails"
```

### Task 6: Add Native Transfer Commands and Durable History Writes

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/accounts.rs`
- Create: `src-tauri/src/transactions.rs`
- Create: `src-tauri/src/commands/transactions.rs`
- Create: `src-tauri/tests/native_transfer.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/storage.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/native_transfer.rs`

- [ ] **Step 1: Write the failing native transfer test**

```rust
// src-tauri/tests/native_transfer.rs
use wallet_workbench_lib::transactions::{ChainOutcomeState, NativeTransferIntent, persist_pending_history};

#[test]
fn writes_pending_history_before_confirmation() {
    let intent = NativeTransferIntent {
        rpc_url: "http://127.0.0.1:8545".into(),
        account_index: 1,
        chain_id: 1,
        from: "0x1111111111111111111111111111111111111111".into(),
        to: "0x2222222222222222222222222222222222222222".into(),
        value_wei: "1000000000000000".into(),
        nonce: 3,
        gas_limit: "21000".into(),
        max_fee_per_gas: "40000000000".into(),
        max_priority_fee_per_gas: "1500000000".into(),
    };

    let record = persist_pending_history(intent, "0xabc".into()).expect("persist");

    assert_eq!(record.outcome.state, ChainOutcomeState::Pending);
    assert_eq!(record.outcome.tx_hash, "0xabc");
}
```

- [ ] **Step 2: Run the Rust test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml writes_pending_history_before_confirmation -- --exact`

Expected: FAIL with unresolved imports for the transaction types.

- [ ] **Step 3: Implement the intent, submission, and pending-history record**

```toml
# src-tauri/Cargo.toml
[dependencies]
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

```rust
// src-tauri/src/models.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ChainOutcomeState {
    Pending,
    Confirmed,
    Failed,
    Replaced,
    Cancelled,
    Dropped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeTransferIntent {
    pub rpc_url: String,
    pub account_index: u32,
    pub chain_id: u64,
    pub from: String,
    pub to: String,
    pub value_wei: String,
    pub nonce: u64,
    pub gas_limit: String,
    pub max_fee_per_gas: String,
    pub max_priority_fee_per_gas: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmissionRecord {
    pub frozen_key: String,
    pub tx_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainOutcome {
    pub state: ChainOutcomeState,
    pub tx_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryRecord {
    pub intent: NativeTransferIntent,
    pub submission: SubmissionRecord,
    pub outcome: ChainOutcome,
}
```

```rust
// src-tauri/src/transactions.rs
use std::fs;

use ethers::middleware::SignerMiddleware;
use ethers::providers::{Http, Middleware, Provider};
use ethers::types::{Address, TransactionRequest, U256};

use crate::accounts::derive_wallet;
use crate::models::{ChainOutcome, ChainOutcomeState, HistoryRecord, NativeTransferIntent, SubmissionRecord};
use crate::session::with_session_mnemonic;
use crate::storage::history_path;

pub fn load_history_records() -> Result<Vec<HistoryRecord>, String> {
    match fs::read_to_string(history_path()) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string()),
        Err(_) => Ok(Vec::new()),
    }
}

pub fn persist_pending_history(intent: NativeTransferIntent, tx_hash: String) -> Result<HistoryRecord, String> {
    let frozen_key = format!(
        "{}:{}:{}:{}:{}",
        intent.chain_id, intent.from, intent.to, intent.value_wei, intent.nonce
    );

    let record = HistoryRecord {
        intent,
        submission: SubmissionRecord {
            frozen_key,
            tx_hash: tx_hash.clone(),
        },
        outcome: ChainOutcome {
            state: ChainOutcomeState::Pending,
            tx_hash,
        },
    };

    let mut records = load_history_records()?;
    records.push(record.clone());
    fs::write(history_path(), serde_json::to_string_pretty(&records).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    Ok(record)
}

pub use crate::models::{ChainOutcomeState, NativeTransferIntent};

async fn preflight_native_transfer(
    intent: &NativeTransferIntent,
    signer_address: Address,
    provider: &Provider<Http>,
) -> Result<(), String> {
    let remote_chain_id = provider.get_chainid().await.map_err(|e| e.to_string())?;
    if remote_chain_id.as_u64() != intent.chain_id {
        return Err(format!(
            "remote chainId {} does not match intent chainId {}",
            remote_chain_id, intent.chain_id
        ));
    }

    let expected_from: Address = intent.from.parse().map_err(|e| format!("{e}"))?;
    if signer_address != expected_from {
        return Err("derived wallet does not match intent.from".to_string());
    }

    let balance = provider
        .get_balance(signer_address, None)
        .await
        .map_err(|e| e.to_string())?;
    let value = U256::from_dec_str(&intent.value_wei).map_err(|e| e.to_string())?;
    let gas_limit = U256::from_dec_str(&intent.gas_limit).map_err(|e| e.to_string())?;
    let max_fee_per_gas = U256::from_dec_str(&intent.max_fee_per_gas).map_err(|e| e.to_string())?;
    let total_cost = value + gas_limit * max_fee_per_gas;
    if balance < total_cost {
        return Err("balance cannot cover value plus max gas cost".to_string());
    }

    let latest_nonce = provider
        .get_transaction_count(signer_address, None)
        .await
        .map_err(|e| e.to_string())?;
    if intent.nonce < latest_nonce.as_u64() {
        return Err(format!(
            "intent nonce {} is below latest on-chain nonce {}",
            intent.nonce,
            latest_nonce
        ));
    }

    Ok(())
}

pub async fn submit_native_transfer(intent: NativeTransferIntent) -> Result<HistoryRecord, String> {
    let wallet = with_session_mnemonic(|mnemonic| derive_wallet(mnemonic, intent.account_index))?
        .with_chain_id(intent.chain_id);
    let provider = Provider::<Http>::try_from(intent.rpc_url.clone()).map_err(|e| e.to_string())?;
    preflight_native_transfer(&intent, wallet.address(), &provider).await?;
    let signer = SignerMiddleware::new(provider, wallet);

    let tx = TransactionRequest::new()
        .to(intent.to.parse().map_err(|e| format!("{e}"))?)
        .from(intent.from.parse().map_err(|e| format!("{e}"))?)
        .value(U256::from_dec_str(&intent.value_wei).map_err(|e| e.to_string())?)
        .nonce(intent.nonce)
        .gas(U256::from_dec_str(&intent.gas_limit).map_err(|e| e.to_string())?)
        .max_fee_per_gas(U256::from_dec_str(&intent.max_fee_per_gas).map_err(|e| e.to_string())?)
        .max_priority_fee_per_gas(
            U256::from_dec_str(&intent.max_priority_fee_per_gas).map_err(|e| e.to_string())?,
        );

    let pending = signer
        .send_transaction(tx, None)
        .await
        .map_err(|e| e.to_string())?;

    persist_pending_history(intent, format!("{:#x}", pending.tx_hash()))
}
```

```rust
// src-tauri/src/commands/transactions.rs
use crate::models::NativeTransferIntent;
use crate::transactions::{persist_pending_history, submit_native_transfer};

#[tauri::command]
pub fn build_pending_history(intent: NativeTransferIntent, tx_hash: String) -> Result<String, String> {
    let record = persist_pending_history(intent, tx_hash)?;
    serde_json::to_string(&record).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn submit_native_transfer_command(intent: NativeTransferIntent) -> Result<String, String> {
    let record = submit_native_transfer(intent).await?;
    serde_json::to_string(&record).map_err(|e| e.to_string())
}
```

```rust
// src-tauri/src/commands/mod.rs
pub mod accounts;
pub mod transactions;
pub mod vault;
```

```rust
// src-tauri/src/lib.rs
pub mod accounts;
pub mod commands;
pub mod models;
pub mod session;
pub mod storage;
pub mod transactions;
pub mod vault;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::vault::create_vault,
            commands::vault::unlock_vault,
            commands::accounts::derive_account,
            commands::transactions::build_pending_history,
            commands::transactions::submit_native_transfer_command,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
```

- [ ] **Step 4: Run the Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml writes_pending_history_before_confirmation -- --exact`

Expected: PASS with the pending-history test green and the history file retaining existing records.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS with vault, account, and transfer tests all green, including Rust-side preflight validation paths.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/accounts.rs src-tauri/src/models.rs src-tauri/src/storage.rs src-tauri/src/transactions.rs src-tauri/src/commands/mod.rs src-tauri/src/commands/transactions.rs src-tauri/src/lib.rs src-tauri/tests/native_transfer.rs
git commit -m "feat: add native transfer history backbone"
```

### Task 7: Add the App-Level Pending Reconciler and Same-Nonce Replace/Cancel Path

**Files:**
- Create: `src/core/history/reconciler.ts`
- Create: `src/core/history/reconciler.test.ts`
- Create: `src/features/history/HistoryView.tsx`
- Modify: `src/lib/tauri.ts`
- Modify: `src/features/transfer/TransferView.tsx`
- Modify: `src-tauri/src/transactions.rs`
- Modify: `src-tauri/src/commands/transactions.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tests/native_transfer.rs`
- Test: `src/core/history/reconciler.test.ts`

- [ ] **Step 1: Write the failing reconciler test**

```ts
// src/core/history/reconciler.test.ts
import { describe, expect, it } from "vitest";
import { releaseNonceReservation } from "./reconciler";

describe("releaseNonceReservation", () => {
  it("releases a nonce reservation when a pending transaction is dropped", () => {
    const next = releaseNonceReservation(
      {
        key: "1:0xabc",
        reservedNonce: 4,
        historyState: "pending",
      },
      "dropped",
    );

    expect(next.historyState).toBe("dropped");
    expect(next.reservedNonce).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/history/reconciler.test.ts`

Expected: FAIL with `Cannot find module './reconciler'`.

- [ ] **Step 3: Implement the reconciler and replace/cancel state rules**

```ts
// src/core/history/reconciler.ts
export type HistoryState =
  | "pending"
  | "confirmed"
  | "failed"
  | "replaced"
  | "cancelled"
  | "dropped";

export interface NonceReservation {
  key: string;
  reservedNonce: number | null;
  historyState: HistoryState;
}

export function releaseNonceReservation(
  reservation: NonceReservation,
  nextState: HistoryState,
): NonceReservation {
  if (nextState === "pending") return reservation;
  return {
    ...reservation,
    historyState: nextState,
    reservedNonce: null,
  };
}
```

```ts
// src/lib/tauri.ts
import { invoke } from "@tauri-apps/api/core";

export interface PendingMutationRequest {
  txHash: string;
  rpcUrl: string;
  accountIndex: number;
  chainId: number;
  from: string;
  nonce: number;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  to?: string;
  valueWei?: string;
}

export function replacePendingTransfer(request: PendingMutationRequest) {
  return invoke<string>("replace_pending_transfer", { request });
}

export function cancelPendingTransfer(request: PendingMutationRequest) {
  return invoke<string>("cancel_pending_transfer", { request });
}
```

```tsx
// src/features/history/HistoryView.tsx
export interface HistoryItem {
  txHash: string;
  state: "pending" | "confirmed" | "failed" | "replaced" | "cancelled" | "dropped";
}

export function HistoryView({ items }: { items: HistoryItem[] }) {
  return (
    <section>
      <h2>History</h2>
      <ul>
        {items.map((item) => (
          <li key={item.txHash}>
            {item.txHash} · {item.state}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

```tsx
// src/features/transfer/TransferView.tsx
import type { PendingMutationRequest } from "../../lib/tauri";

export interface PendingActionProps {
  pendingRequest?: PendingMutationRequest;
  onReplace?: (request: PendingMutationRequest) => void;
  onCancelPending?: (request: PendingMutationRequest) => void;
}

export function PendingActions({ pendingRequest, onReplace, onCancelPending }: PendingActionProps) {
  if (!pendingRequest) return null;
  return (
    <div>
      <button type="button" onClick={() => onReplace?.(pendingRequest)}>Replace Pending</button>
      <button type="button" onClick={() => onCancelPending?.(pendingRequest)}>Cancel Pending</button>
    </div>
  );
}
```

```rust
// src-tauri/src/transactions.rs
use crate::models::ChainOutcomeState;

pub fn mark_prior_history_state(tx_hash: &str, next_state: ChainOutcomeState) -> Result<(), String> {
    let mut records = load_history_records()?;
    if let Some(record) = records.iter_mut().find(|record| record.outcome.tx_hash == tx_hash) {
        record.outcome.state = next_state;
    }
    fs::write(history_path(), serde_json::to_string_pretty(&records).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
```

```rust
// src-tauri/src/commands/transactions.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingMutationRequest {
    pub tx_hash: String,
    pub rpc_url: String,
    pub account_index: u32,
    pub chain_id: u64,
    pub from: String,
    pub nonce: u64,
    pub gas_limit: String,
    pub max_fee_per_gas: String,
    pub max_priority_fee_per_gas: String,
    pub to: Option<String>,
    pub value_wei: Option<String>,
}

#[tauri::command]
pub async fn replace_pending_transfer(request: PendingMutationRequest) -> Result<String, String> {
    let intent = NativeTransferIntent {
        rpc_url: request.rpc_url,
        account_index: request.account_index,
        chain_id: request.chain_id,
        from: request.from,
        to: request.to.ok_or_else(|| "replace requires a destination".to_string())?,
        value_wei: request
            .value_wei
            .ok_or_else(|| "replace requires a value".to_string())?,
        nonce: request.nonce,
        gas_limit: request.gas_limit,
        max_fee_per_gas: request.max_fee_per_gas,
        max_priority_fee_per_gas: request.max_priority_fee_per_gas,
    };

    let record = submit_native_transfer(intent).await?;
    crate::transactions::mark_prior_history_state(&request.tx_hash, crate::models::ChainOutcomeState::Replaced)?;
    serde_json::to_string(&record).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_pending_transfer(request: PendingMutationRequest) -> Result<String, String> {
    let intent = NativeTransferIntent {
        rpc_url: request.rpc_url,
        account_index: request.account_index,
        chain_id: request.chain_id,
        from: request.from.clone(),
        to: request.from,
        value_wei: "0".to_string(),
        nonce: request.nonce,
        gas_limit: request.gas_limit,
        max_fee_per_gas: request.max_fee_per_gas,
        max_priority_fee_per_gas: request.max_priority_fee_per_gas,
    };

    let record = submit_native_transfer(intent).await?;
    crate::transactions::mark_prior_history_state(&request.tx_hash, crate::models::ChainOutcomeState::Cancelled)?;
    serde_json::to_string(&record).map_err(|e| e.to_string())
}
```

```rust
// src-tauri/src/lib.rs
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::vault::create_vault,
            commands::vault::unlock_vault,
            commands::accounts::derive_account,
            commands::transactions::build_pending_history,
            commands::transactions::submit_native_transfer_command,
            commands::transactions::replace_pending_transfer,
            commands::transactions::cancel_pending_transfer,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
```

```rust
// src-tauri/tests/native_transfer.rs
#[test]
fn replace_and_cancel_mutations_keep_the_same_nonce_contract() {
    let request = wallet_workbench_lib::commands::transactions::PendingMutationRequest {
        tx_hash: "0xabc".into(),
        rpc_url: "http://127.0.0.1:8545".into(),
        account_index: 1,
        chain_id: 31337,
        from: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".into(),
        nonce: 5,
        gas_limit: "21000".into(),
        max_fee_per_gas: "2000000000".into(),
        max_priority_fee_per_gas: "1500000000".into(),
        to: Some("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC".into()),
        value_wei: Some("1000000000000000".into()),
    };

    assert_eq!(request.nonce, 5);
    assert_eq!(request.from, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- src/core/history/reconciler.test.ts`

Expected: PASS with the dropped-state reconciler test green.

Run: `cargo test --manifest-path src-tauri/Cargo.toml replace_and_cancel_mutations_keep_the_same_nonce_contract -- --exact`

Expected: PASS with the replace/cancel mutation contract test green.

Run: `npm run typecheck`

Expected: PASS with the history and transfer types compiling.

- [ ] **Step 5: Commit**

```bash
git add src/core/history/reconciler.ts src/core/history/reconciler.test.ts src/features/history/HistoryView.tsx src/features/transfer/TransferView.tsx src/lib/tauri.ts src-tauri/src/transactions.rs src-tauri/src/commands/transactions.rs src-tauri/src/lib.rs src-tauri/tests/native_transfer.rs
git commit -m "feat: add pending reconciler and replace cancel flow"
```

### Task 8: Assemble the End-to-End App Flow

**Files:**
- Modify: `src/app/AppShell.tsx`
- Modify: `src/App.tsx`
- Modify: `src/app/store.ts`
- Modify: `src/features/unlock/UnlockView.tsx`
- Modify: `src/features/accounts/AccountsView.tsx`
- Modify: `src/features/transfer/TransferView.tsx`
- Modify: `src/features/history/HistoryView.tsx`
- Modify: `src/features/settings/SettingsView.tsx`
- Modify: `src/lib/tauri.ts`
- Test: `src/app/AppShell.test.tsx`

- [ ] **Step 1: Extend the shell test to cover the ready-state workflow**

```tsx
// src/app/AppShell.test.tsx
it("renders workspace tabs when the vault session is ready", () => {
  render(
    <AppShell
      session={{ status: "ready" }}
      activeTab="accounts"
      onTabChange={() => {}}
    />,
  );

  expect(screen.getByRole("tab", { name: "Accounts" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Transfer" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the shell test to verify it fails**

Run: `npx vitest run src/app/AppShell.test.tsx`

Expected: FAIL because `AppShell` does not yet accept workspace tab props or render the assembled flow.

- [ ] **Step 3: Wire the views into a working shell**

```tsx
// src/app/AppShell.tsx
import { AccountsView } from "../features/accounts/AccountsView";
import { HistoryView } from "../features/history/HistoryView";
import { SettingsView } from "../features/settings/SettingsView";
import { TransferView } from "../features/transfer/TransferView";
import { UnlockView } from "../features/unlock/UnlockView";

type WorkspaceTab = "accounts" | "transfer" | "history" | "settings";

export interface AppShellProps {
  session: { status: "locked" | "ready" };
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  onUnlock: (password: string) => Promise<void>;
}

export function AppShell({ session, activeTab, onTabChange, onUnlock }: AppShellProps) {
  return (
    <div className="workbench-shell">
      <header className="workbench-header">
        <h1>EVM Wallet Workbench</h1>
      </header>
      {session.status === "locked" ? (
        <UnlockView onUnlock={onUnlock} />
      ) : (
        <>
          <nav role="tablist" className="workspace-tabs">
            {(["accounts", "transfer", "history", "settings"] as WorkspaceTab[]).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => onTabChange(tab)}
                type="button"
              >
                {tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
          {activeTab === "accounts" && <AccountsView accounts={[]} onAddAccount={async () => {}} />}
          {activeTab === "transfer" && <TransferView draft={null} />}
          {activeTab === "history" && <HistoryView items={[]} />}
          {activeTab === "settings" && <SettingsView chains={[]} />}
        </>
      )}
    </div>
  );
}
```

```tsx
// src/App.tsx
import { useState } from "react";
import { AppShell } from "./app/AppShell";
import { unlockVault } from "./lib/tauri";

export function App() {
  const [sessionStatus, setSessionStatus] = useState<"locked" | "ready">("locked");
  const [activeTab, setActiveTab] = useState<"accounts" | "transfer" | "history" | "settings">(
    "accounts",
  );

  async function handleUnlock(password: string) {
    await unlockVault(password);
    setSessionStatus("ready");
  }

  return (
    <AppShell
      session={{ status: sessionStatus }}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onUnlock={handleUnlock}
    />
  );
}
```

```tsx
// src/features/unlock/UnlockView.tsx
import { useState } from "react";

export function UnlockView({ onUnlock }: { onUnlock: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");

  return (
    <main className="locked-panel">
      <input
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-label="Vault password"
      />
      <button type="button" onClick={() => void onUnlock(password)}>
        Unlock Vault
      </button>
    </main>
  );
}
```

```ts
// src/lib/tauri.ts
export interface SessionSummary {
  status: "ready";
}

export function unlockVault(password: string) {
  return invoke<SessionSummary>("unlock_vault", { password });
}
```

- [ ] **Step 4: Run the integration checks**

Run: `npm run test -- src/app/AppShell.test.tsx`

Expected: PASS with both locked and ready-state shell tests green.

Run: `npm run typecheck`

Expected: PASS with the assembled shell compiling.

- [ ] **Step 5: Commit**

```bash
git add src/app/AppShell.tsx src/App.tsx src/app/store.ts src/features/unlock/UnlockView.tsx src/features/accounts/AccountsView.tsx src/features/transfer/TransferView.tsx src/features/history/HistoryView.tsx src/features/settings/SettingsView.tsx src/lib/tauri.ts src/app/AppShell.test.tsx
git commit -m "feat: assemble wallet workbench app flow"
```

### Task 9: Finish Hardening, Auto-Lock, and Local-Chain Validation

**Files:**
- Create: `scripts/run-anvil-check.sh`
- Create: `src/app/session.ts`
- Modify: `src/app/store.ts`
- Modify: `src-tauri/src/commands/vault.rs`
- Modify: `src-tauri/tests/native_transfer.rs`
- Test: `scripts/run-anvil-check.sh`

- [ ] **Step 1: Write the shell-based validation script first**

```bash
#!/usr/bin/env bash
set -euo pipefail

ANVIL_PORT="${ANVIL_PORT:-8545}"
anvil --port "$ANVIL_PORT" --chain-id 31337 > /tmp/wallet-workbench-anvil.log 2>&1 &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID"' EXIT

sleep 2

echo "anvil_ready"
```

- [ ] **Step 2: Run the script to verify the environment hook works**

Run: `bash scripts/run-anvil-check.sh`

Expected: PASS with output containing `anvil_ready`.

- [ ] **Step 3: Implement auto-lock state and expand the validation flow**

```ts
// src/app/session.ts
export interface SessionState {
  status: "locked" | "ready";
  lockedAt: number | null;
  idleLockMinutes: number;
}

export function shouldAutoLock(lastActiveAt: number, now: number, idleLockMinutes: number) {
  return now - lastActiveAt >= idleLockMinutes * 60_000;
}
```

```ts
// src/app/store.ts
import type { SessionState } from "./session";
import type { AccountRecord } from "../lib/tauri";
import type { AccountChainState } from "../lib/rpc";

export interface AppStore {
  session: SessionState;
  defaultRpcUrl: string;
  accounts: Array<AccountRecord & AccountChainState>;
}

export const initialStore: AppStore = {
  session: {
    status: "locked",
    lockedAt: Date.now(),
    idleLockMinutes: 15,
  },
  defaultRpcUrl: "",
  accounts: [],
};
```

```rust
// src-tauri/src/commands/vault.rs
#[tauri::command]
pub fn lock_vault() -> Result<(), String> {
    crate::session::clear_session_mnemonic();
    Ok(())
}
```

```rust
// src-tauri/tests/native_transfer.rs
#[tokio::test]
async fn submit_native_transfer_roundtrip_against_anvil() {
    wallet_workbench_lib::session::write_session_mnemonic(
        "test test test test test test test test test test test junk".into(),
    );

    let intent = NativeTransferIntent {
        rpc_url: "http://127.0.0.1:8545".into(),
        account_index: 1,
        chain_id: 31337,
        from: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".into(),
        to: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC".into(),
        value_wei: "1000000000000000".into(),
        nonce: 0,
        gas_limit: "21000".into(),
        max_fee_per_gas: "2000000000".into(),
        max_priority_fee_per_gas: "1500000000".into(),
    };

    let result = wallet_workbench_lib::transactions::submit_native_transfer(intent).await;
    assert!(result.is_ok());
}
```

```bash
#!/usr/bin/env bash
# scripts/run-anvil-check.sh
set -euo pipefail

ANVIL_PORT="${ANVIL_PORT:-8545}"
anvil --port "$ANVIL_PORT" --chain-id 31337 > /tmp/wallet-workbench-anvil.log 2>&1 &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID"' EXIT

sleep 2
npx vitest run src/core/transactions/draft.test.ts src/core/history/reconciler.test.ts
cargo test --manifest-path src-tauri/Cargo.toml submit_native_transfer_roundtrip_against_anvil -- --exact
cargo test --manifest-path src-tauri/Cargo.toml
echo "wallet_workbench_validation_passed"
```

- [ ] **Step 4: Run the final validation**

Run: `bash scripts/run-anvil-check.sh`

Expected: PASS with final output `wallet_workbench_validation_passed`.

Run: `npm run build`

Expected: PASS with a production bundle and no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/run-anvil-check.sh src/app/session.ts src/app/store.ts src-tauri/src/commands/vault.rs src-tauri/tests/native_transfer.rs
git commit -m "feat: harden session locking and validation flow"
```
