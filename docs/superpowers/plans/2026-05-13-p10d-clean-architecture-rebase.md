# P10d Clean Architecture Rebase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the current PWA baseline into the professional control-console architecture while preserving the verified vault, chain/RPC, fee draft, manifest, and smoke-tested behavior.

**Architecture:** P10d is a foundation milestone, not a transaction feature milestone. Move the current browser PWA code toward `app`, `core`, `services`, `features`, and `shared` boundaries, introduce the selected left-nav/top-context/main-workspace/right-rail shell, and keep future wallet modules visible but clearly unavailable. Current vault and settings behavior must continue to work through compatibility re-exports while new modules adopt the target layout.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, Playwright, ethers v6, browser IndexedDB, browser localStorage.

---

## Controller Rules For This Plan

- Work from `/Users/wukong/mylife/Defi-United/.worktrees/p10d-clean-architecture-rebase` on branch `codex/p10d-clean-architecture-rebase`.
- Do not implement signing, broadcasting, balance scanning, distribution, collection, inscriptions, ABI calls, reverse parsing, or durable transaction history in P10d.
- Subagents implement or review only. The controller runs fresh verification, commits, pushes, and updates `docs/superpowers/project-status.md`.
- After each task:
  - run the focused verification listed in the task;
  - run spec review and code quality review;
  - run controller fresh verification;
  - commit and push the task branch;
  - update the status table with branch, commit, review, verification, push state, and notes.
- Do not persist fee edits, base fee overrides, priority fee edits, multipliers, transaction drafts, active queue drafts, unlocked hot sessions, raw signed transactions, mnemonics, private keys, or passwords.
- RPC URLs remain persisted local endpoint settings and must keep the visible warning that secret-bearing URLs are stored as-is.

## File Structure

Target files and responsibilities:

- Create: `src/app/shell/navigation.ts`
  - Defines stable module ids, Chinese nav labels, availability states, and planned capability copy.
- Create: `src/app/shell/AppNavigation.tsx`
  - Left module navigation only.
- Create: `src/app/shell/AppTopBar.tsx`
  - Top context bar showing chain/RPC/fee/session summary only.
- Create: `src/app/shell/AppPreviewRail.tsx`
  - Right rail for preview/risk/queue placeholders and safety boundaries.
- Create: `src/app/shell/AppWorkspace.tsx`
  - Main workspace switch that renders implemented module content or unavailable module placeholders.
- Create: `src/app/shell/AppShell.tsx`
  - Layout composition for navigation, top bar, workspace, and preview rail.
- Create: `src/app/shell/ModulePlaceholder.tsx`
  - Shared unavailable-state component.
- Create: `src/app/state/appNavigation.ts`
  - Pure navigation helper functions.
- Create: `src/app/state/appSession.ts`
  - Pure session summary helper functions.
- Modify: `src/app/PwaShell.tsx`
  - Keep orchestration of vault/chain state, but delegate layout to `AppShell`.
- Modify: `src/app/PwaShell.test.tsx`
  - Update shell tests for new console layout and module labels.
- Create: `src/core/accounts/index.ts`
  - Re-export account domain types/functions from the current browser-vault account module.
- Create: `src/core/vault/index.ts`
  - Re-export vault-account domain types/functions used by features.
- Create: `src/core/chains/index.ts`
  - Re-export chain config domain types/functions.
- Create: `src/core/fees/index.ts`
  - Re-export fee draft types/functions from chain config.
- Create: `src/services/storage/browserVaultStorage.ts`
  - Re-export current encrypted vault storage/session service.
- Create: `src/services/storage/chainConfigStorage.ts`
  - Re-export current chain config storage service.
- Create: `src/features/accounts/AccountsModule.tsx`
  - New feature entry that wraps locked vault access and unlocked account workspace.
- Create: `src/features/accounts/PwaVaultAccessView.tsx`
  - Move from `src/features/pwaVault/PwaVaultAccessView.tsx`.
- Create: `src/features/accounts/PwaVaultWorkspace.tsx`
  - Move from `src/features/pwaVault/PwaVaultWorkspace.tsx`.
- Create: `src/features/settings/SettingsModule.tsx`
  - New feature entry for chain/RPC and fee controls.
- Create: `src/features/settings/PwaChainSettingsPanel.tsx`
  - Move from `src/features/pwaSettings/PwaChainSettingsPanel.tsx`.
- Create: `src/features/settings/PwaFeePanel.tsx`
  - Move from `src/features/pwaSettings/PwaFeePanel.tsx`.
- Create: `src/shared/ui/StatusBadge.tsx`
  - Reusable status badge component.
- Create: `src/shared/ui/NoticePanel.tsx`
  - Reusable notice/risk panel component.
- Create: `src/shared/format/number.ts`
  - Shared native-cost formatting helper.
- Create: `src/styles/tokens.css`
  - Design tokens.
- Create: `src/styles/base.css`
  - Reset and base element styling.
- Create: `src/styles/layout.css`
  - App shell and responsive layout styling.
- Create: `src/styles/components.css`
  - Shared cards, forms, badges, buttons, notices, lists.
- Create: `src/styles/features.css`
  - Feature-specific account/settings styles.
- Modify: `src/styles.css`
  - Import the split stylesheets.
- Modify: `tests/browser/pwa-smoke.spec.ts`
  - Update smoke coverage for console shell desktop/mobile, unavailable modules, vault flow, settings flow, and no send controls.
- Modify: `README.md`
  - Update current key paths after rebase.
- Modify: `docs/superpowers/project-overview.md`
  - Update current runtime file map and P10d status.
- Modify: `docs/superpowers/project-status.md`
  - Add/update P10d task rows.
- Modify: `docs/superpowers/roadmap.md`
  - Keep P10d wording truthful after implementation.

Compatibility files:

- Keep: `src/core/browserVault/accounts.ts`
- Keep: `src/core/browserChainConfig.ts`
- Keep: `src/lib/browserVault.ts`
- Keep: `src/lib/browserChainConfig.ts`
- Keep temporary re-export compatibility files only if tests still import the old paths:
  - `src/features/pwaVault/PwaVaultAccessView.tsx`
  - `src/features/pwaVault/PwaVaultWorkspace.tsx`
  - `src/features/pwaSettings/PwaChainSettingsPanel.tsx`
  - `src/features/pwaSettings/PwaFeePanel.tsx`

## Task 1: Architecture Boundaries And Compatibility Re-Exports

**Files:**
- Create: `src/core/accounts/index.ts`
- Create: `src/core/vault/index.ts`
- Create: `src/core/chains/index.ts`
- Create: `src/core/fees/index.ts`
- Create: `src/services/storage/browserVaultStorage.ts`
- Create: `src/services/storage/chainConfigStorage.ts`
- Create: `src/shared/format/number.ts`
- Modify: `src/features/pwaSettings/PwaFeePanel.tsx`
- Test: `src/shared/format/number.test.ts`

- [ ] **Step 1: Write the failing formatter test**

  Create `src/shared/format/number.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { formatEstimatedNativeCost } from "./number";

  describe("formatEstimatedNativeCost", () => {
    it("formats gas times gwei as native token cost", () => {
      expect(formatEstimatedNativeCost("21000", "42")).toBe("0.00088200");
    });

    it("returns placeholder for invalid values", () => {
      expect(formatEstimatedNativeCost("", "42")).toBe("--");
      expect(formatEstimatedNativeCost("21000", "0")).toBe("--");
      expect(formatEstimatedNativeCost("nope", "42")).toBe("--");
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run:

  ```bash
  npm test -- src/shared/format/number.test.ts
  ```

  Expected: fail because `src/shared/format/number.ts` does not exist.

- [ ] **Step 3: Add the shared formatter**

  Create `src/shared/format/number.ts`:

  ```ts
  export function formatEstimatedNativeCost(gasLimit: string, feePerGasGwei: string) {
    const gas = Number(gasLimit);
    const fee = Number(feePerGasGwei);
    if (!Number.isFinite(gas) || !Number.isFinite(fee) || gas <= 0 || fee <= 0) return "--";
    return ((gas * fee) / 1_000_000_000).toFixed(8);
  }
  ```

- [ ] **Step 4: Add architecture re-export files**

  Create `src/core/accounts/index.ts`:

  ```ts
  export * from "../browserVault/accounts";
  ```

  Create `src/core/vault/index.ts`:

  ```ts
  export * from "../browserVault/accounts";
  ```

  Create `src/core/chains/index.ts`:

  ```ts
  export * from "../browserChainConfig";
  ```

  Create `src/core/fees/index.ts`:

  ```ts
  export type { BrowserFeeDraft } from "../browserChainConfig";
  export { updateBrowserFeeDraft } from "../browserChainConfig";
  ```

  Create `src/services/storage/browserVaultStorage.ts`:

  ```ts
  export * from "../../lib/browserVault";
  ```

  Create `src/services/storage/chainConfigStorage.ts`:

  ```ts
  export * from "../../lib/browserChainConfig";
  ```

- [ ] **Step 5: Use the shared formatter in the current fee panel**

  In `src/features/pwaSettings/PwaFeePanel.tsx`, replace the local `estimateNativeCost` helper with:

  ```ts
  import { formatEstimatedNativeCost } from "../../shared/format/number";
  import type { BrowserChainRecord, BrowserFeeDraft } from "../../core/browserChainConfig";
  ```

  Then replace:

  ```ts
  const estimatedCost = estimateNativeCost(feeDraft.gasLimit, feeDraft.maxFeePerGasGwei);
  ```

  with:

  ```ts
  const estimatedCost = formatEstimatedNativeCost(feeDraft.gasLimit, feeDraft.maxFeePerGasGwei);
  ```

- [ ] **Step 6: Run focused verification**

  Run:

  ```bash
  npm test -- src/shared/format/number.test.ts src/app/PwaShell.test.tsx
  npm run typecheck
  git diff --check
  ```

  Expected: all commands pass.

- [ ] **Step 7: Controller commit and push**

  After review approval and fresh verification, controller runs:

  ```bash
  git add src/core/accounts/index.ts src/core/vault/index.ts src/core/chains/index.ts src/core/fees/index.ts src/services/storage/browserVaultStorage.ts src/services/storage/chainConfigStorage.ts src/shared/format/number.ts src/shared/format/number.test.ts src/features/pwaSettings/PwaFeePanel.tsx docs/superpowers/project-status.md
  git commit -m "refactor: add P10d architecture boundaries"
  git push origin codex/p10d-clean-architecture-rebase
  ```

## Task 2: Professional Console Shell Components

**Files:**
- Create: `src/app/shell/navigation.ts`
- Create: `src/app/state/appNavigation.ts`
- Create: `src/app/state/appSession.ts`
- Create: `src/app/shell/ModulePlaceholder.tsx`
- Create: `src/app/shell/AppNavigation.tsx`
- Create: `src/app/shell/AppTopBar.tsx`
- Create: `src/app/shell/AppPreviewRail.tsx`
- Create: `src/app/shell/AppWorkspace.tsx`
- Create: `src/app/shell/AppShell.tsx`
- Create: `src/shared/ui/StatusBadge.tsx`
- Create: `src/shared/ui/NoticePanel.tsx`
- Modify: `src/app/PwaShell.tsx`
- Modify: `src/app/PwaShell.test.tsx`

- [ ] **Step 1: Add navigation domain tests**

  Create `src/app/state/appNavigation.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { getDefaultModuleId, getModuleById } from "./appNavigation";

  describe("appNavigation", () => {
    it("uses dashboard as default module", () => {
      expect(getDefaultModuleId()).toBe("dashboard");
    });

    it("falls back to dashboard for unknown ids", () => {
      expect(getModuleById("contracts")?.label).toBe("合约调用");
      expect(getModuleById("missing")?.id).toBe("dashboard");
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run:

  ```bash
  npm test -- src/app/state/appNavigation.test.ts
  ```

  Expected: fail because `src/app/state/appNavigation.ts` does not exist.

- [ ] **Step 3: Add navigation model**

  Create `src/app/shell/navigation.ts`:

  ```ts
  export type AppModuleId =
    | "dashboard"
    | "accounts"
    | "assets"
    | "distribution"
    | "inscriptions"
    | "contracts"
    | "queueHistory"
    | "settings";

  export type AppModuleStatus = "ready" | "planned";

  export interface AppModuleDefinition {
    id: AppModuleId;
    label: string;
    shortLabel: string;
    status: AppModuleStatus;
    summary: string;
    planned: string[];
  }

  export const appModules: AppModuleDefinition[] = [
    {
      id: "dashboard",
      label: "总览",
      shortLabel: "总览",
      status: "planned",
      summary: "显示 vault、链、账户选择、风险和队列摘要的控制台首页。",
      planned: ["账户与链状态", "资产摘要", "队列摘要"],
    },
    {
      id: "accounts",
      label: "账户库",
      shortLabel: "账户",
      status: "ready",
      summary: "浏览器本地 encrypted vault、助记词组、派生账户和热会话。",
      planned: ["加密 vault", "助记词组", "派生账户"],
    },
    {
      id: "assets",
      label: "资产",
      shortLabel: "资产",
      status: "planned",
      summary: "原生币、ERC-20、授权和资产快照。",
      planned: ["Native balance", "ERC-20 watchlist", "授权扫描"],
    },
    {
      id: "distribution",
      label: "分发/归集",
      shortLabel: "分发",
      status: "planned",
      summary: "通过分发合约和多账户队列完成 native/ERC-20 分发与归集。",
      planned: ["合约分发", "多账户归集", "失败重跑"],
    },
    {
      id: "inscriptions",
      label: "铭文刻录",
      shortLabel: "铭文",
      status: "planned",
      summary: "hex/txt calldata、self/fixed target 和重复次数的快速刻录页面。",
      planned: ["hex calldata", "txt 转 calldata", "nonce 续跑"],
    },
    {
      id: "contracts",
      label: "合约调用",
      shortLabel: "合约",
      status: "planned",
      summary: "ABI 拉取、粘贴/导入、raw calldata fallback 和多钱包参数映射。",
      planned: ["ABI fetch", "ABI import", "Self 参数"],
    },
    {
      id: "queueHistory",
      label: "队列/历史",
      shortLabel: "队列",
      status: "planned",
      summary: "前端签名广播队列、nonce 编排、停止/重试和脱敏历史。",
      planned: ["并发控制", "停止/重试", "脱敏导出"],
    },
    {
      id: "settings",
      label: "设置",
      shortLabel: "设置",
      status: "ready",
      summary: "链/RPC 设置、session-only fee 草稿和本地存储边界。",
      planned: ["链配置", "RPC URL", "fee 草稿"],
    },
  ];
  ```

  Create `src/app/state/appNavigation.ts`:

  ```ts
  import { appModules, type AppModuleDefinition, type AppModuleId } from "../shell/navigation";

  export function getDefaultModuleId(): AppModuleId {
    return "dashboard";
  }

  export function getModuleById(id: string): AppModuleDefinition {
    return appModules.find((module) => module.id === id) ?? appModules[0];
  }
  ```

- [ ] **Step 4: Add shared UI primitives**

  Create `src/shared/ui/StatusBadge.tsx`:

  ```tsx
  import type { ReactNode } from "react";

  export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" }) {
    return <span className={`status-badge status-badge-${tone}`}>{children}</span>;
  }
  ```

  Create `src/shared/ui/NoticePanel.tsx`:

  ```tsx
  import type { ReactNode } from "react";

  export function NoticePanel({
    children,
    title,
    tone = "neutral",
  }: {
    children: ReactNode;
    title: string;
    tone?: "neutral" | "warning";
  }) {
    return (
      <article className={`notice-panel notice-panel-${tone}`}>
        <h3>{title}</h3>
        <div>{children}</div>
      </article>
    );
  }
  ```

- [ ] **Step 5: Add session summary helper**

  Create `src/app/state/appSession.ts`:

  ```ts
  import type { BrowserChainRecord } from "../../core/chains";
  import type { BrowserVaultSession } from "../../services/storage/browserVaultStorage";

  export interface AppSessionSummary {
    accountCount: number;
    selectedAccountCount: number;
    activeChainName: string;
    nativeSymbol: string;
    vaultStateLabel: string;
  }

  export function summarizeAppSession(session: BrowserVaultSession | null, activeChain: BrowserChainRecord | null): AppSessionSummary {
    const accounts = session?.state.groups.flatMap((group) => group.accounts) ?? [];
    return {
      accountCount: accounts.length,
      selectedAccountCount: accounts.filter((account) => account.selected).length,
      activeChainName: activeChain?.name ?? "未选择链",
      nativeSymbol: activeChain?.nativeCurrencySymbol ?? "--",
      vaultStateLabel: session ? "已解锁" : "未解锁",
    };
  }
  ```

- [ ] **Step 6: Add shell components**

  Create `src/app/shell/ModulePlaceholder.tsx`:

  ```tsx
  import { NoticePanel } from "../../shared/ui/NoticePanel";
  import { StatusBadge } from "../../shared/ui/StatusBadge";
  import type { AppModuleDefinition } from "./navigation";

  export function ModulePlaceholder({ module }: { module: AppModuleDefinition }) {
    return (
      <section className="module-placeholder" aria-labelledby={`module-${module.id}`}>
        <header className="module-header">
          <div>
            <p className="eyebrow">规划模块</p>
            <h2 id={`module-${module.id}`}>{module.label}</h2>
            <p>{module.summary}</p>
          </div>
          <StatusBadge tone="warning">未启用</StatusBadge>
        </header>
        <div className="module-grid">
          <NoticePanel title="计划能力">
            <ul>
              {module.planned.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </NoticePanel>
          <NoticePanel title="安全边界" tone="warning">
            <p>当前模块不包含签名、广播、RPC 提交、余额扫描或真实交易历史写入。</p>
            <p>相关能力必须在链身份、nonce、fee、队列、历史和脱敏验证完成后启用。</p>
          </NoticePanel>
        </div>
      </section>
    );
  }
  ```

  Create `src/app/shell/AppNavigation.tsx`:

  ```tsx
  import { StatusBadge } from "../../shared/ui/StatusBadge";
  import { appModules, type AppModuleId } from "./navigation";

  export function AppNavigation({
    activeModuleId,
    onSelectModule,
  }: {
    activeModuleId: AppModuleId;
    onSelectModule(moduleId: AppModuleId): void;
  }) {
    return (
      <nav className="app-navigation" aria-label="钱包工作台导航">
        <div className="app-navigation-brand">
          <span>DeFi United</span>
          <strong>PWA 控制台</strong>
        </div>
        <div className="app-navigation-list">
          {appModules.map((module) => (
            <button
              key={module.id}
              type="button"
              className={module.id === activeModuleId ? "app-nav-item app-nav-item-active" : "app-nav-item"}
              aria-current={module.id === activeModuleId ? "page" : undefined}
              onClick={() => onSelectModule(module.id)}
            >
              <span>{module.label}</span>
              {module.status === "ready" ? <StatusBadge tone="success">可用</StatusBadge> : <StatusBadge>规划</StatusBadge>}
            </button>
          ))}
        </div>
      </nav>
    );
  }
  ```

  Create `src/app/shell/AppTopBar.tsx`:

  ```tsx
  import type { AppSessionSummary } from "../state/appSession";

  export function AppTopBar({ summary }: { summary: AppSessionSummary }) {
    return (
      <header className="app-topbar">
        <div>
          <span>Vault</span>
          <strong>{summary.vaultStateLabel}</strong>
        </div>
        <div>
          <span>账户</span>
          <strong>{summary.selectedAccountCount}/{summary.accountCount} 已选</strong>
        </div>
        <div>
          <span>链</span>
          <strong>{summary.activeChainName}</strong>
        </div>
        <div>
          <span>Gas</span>
          <strong>{summary.nativeSymbol} fee 草稿</strong>
        </div>
      </header>
    );
  }
  ```

  Create `src/app/shell/AppPreviewRail.tsx`:

  ```tsx
  import { NoticePanel } from "../../shared/ui/NoticePanel";
  import type { AppModuleDefinition } from "./navigation";

  export function AppPreviewRail({ activeModule }: { activeModule: AppModuleDefinition }) {
    return (
      <aside className="app-preview-rail" aria-label="预览与风险">
        <NoticePanel title="交易预览">
          <p>{activeModule.label} 当前没有可提交交易。</p>
        </NoticePanel>
        <NoticePanel title="风险边界" tone="warning">
          <p>raw signed tx、助记词、私钥、密码和 API token 不进入日志、历史或导出。</p>
        </NoticePanel>
        <NoticePanel title="队列">
          <p>P13 前仅显示占位，不运行签名或广播队列。</p>
        </NoticePanel>
      </aside>
    );
  }
  ```

  Create `src/app/shell/AppWorkspace.tsx`:

  ```tsx
  import type { ReactNode } from "react";
  import { getModuleById } from "../state/appNavigation";
  import type { AppModuleId } from "./navigation";
  import { ModulePlaceholder } from "./ModulePlaceholder";

  export function AppWorkspace({
    activeModuleId,
    accountsContent,
    settingsContent,
  }: {
    activeModuleId: AppModuleId;
    accountsContent: ReactNode;
    settingsContent: ReactNode;
  }) {
    if (activeModuleId === "accounts") return <>{accountsContent}</>;
    if (activeModuleId === "settings") return <>{settingsContent}</>;
    return <ModulePlaceholder module={getModuleById(activeModuleId)} />;
  }
  ```

  Create `src/app/shell/AppShell.tsx`:

  ```tsx
  import type { ReactNode } from "react";
  import type { AppSessionSummary } from "../state/appSession";
  import { AppNavigation } from "./AppNavigation";
  import { AppPreviewRail } from "./AppPreviewRail";
  import { AppTopBar } from "./AppTopBar";
  import { AppWorkspace } from "./AppWorkspace";
  import { getModuleById } from "../state/appNavigation";
  import type { AppModuleId } from "./navigation";

  export function AppShell({
    activeModuleId,
    accountsContent,
    settingsContent,
    sessionSummary,
    onSelectModule,
  }: {
    activeModuleId: AppModuleId;
    accountsContent: ReactNode;
    settingsContent: ReactNode;
    sessionSummary: AppSessionSummary;
    onSelectModule(moduleId: AppModuleId): void;
  }) {
    const activeModule = getModuleById(activeModuleId);
    return (
      <main className="app-shell">
        <AppNavigation activeModuleId={activeModuleId} onSelectModule={onSelectModule} />
        <div className="app-shell-main">
          <AppTopBar summary={sessionSummary} />
          <div className="app-shell-content">
            <section className="app-workspace" aria-label="主工作区">
              <AppWorkspace activeModuleId={activeModuleId} accountsContent={accountsContent} settingsContent={settingsContent} />
            </section>
            <AppPreviewRail activeModule={activeModule} />
          </div>
        </div>
      </main>
    );
  }
  ```

- [ ] **Step 7: Wire `PwaShell` into `AppShell`**

  In `src/app/PwaShell.tsx`:

  - remove the old `PwaSectionId`, `PwaSection`, `pwaSections`, and `PwaSectionPanel` definitions;
  - import the new shell and helpers:

  ```ts
  import { AppShell } from "./shell/AppShell";
  import { getDefaultModuleId } from "./state/appNavigation";
  import { summarizeAppSession } from "./state/appSession";
  import type { AppModuleId } from "./shell/navigation";
  ```

  - replace `activeSectionId` state with:

  ```ts
  const [activeModuleId, setActiveModuleId] = useState<AppModuleId>(getDefaultModuleId());
  ```

  - replace the old return block with:

  ```tsx
  return (
    <AppShell
      accountsContent={renderAccountsSection()}
      activeModuleId={activeModuleId}
      onSelectModule={setActiveModuleId}
      sessionSummary={summarizeAppSession(session, activeChain)}
      settingsContent={renderSettingsSection()}
    />
  );
  ```

- [ ] **Step 8: Update shell tests**

  In `src/app/PwaShell.test.tsx`:

  - Change `primaryNavLabels` to:

    ```ts
    const primaryNavLabels = ["总览", "账户库", "资产", "分发/归集", "铭文刻录", "合约调用", "队列/历史", "设置"];
    ```

  - In the baseline test, assert:

    ```ts
    expect(screen.getByText("PWA 控制台")).toBeInTheDocument();
    expect(screen.getByLabelText("主工作区")).toBeInTheDocument();
    expect(screen.getByLabelText("预览与风险")).toBeInTheDocument();
    ```

  - Replace button lookups for old `账户` nav with `账户库`.
  - Replace history nav text with `队列/历史`.
  - Keep the assertions that no sign/broadcast/submit buttons exist.

- [ ] **Step 9: Run focused verification**

  Run:

  ```bash
  npm test -- src/app/state/appNavigation.test.ts src/app/PwaShell.test.tsx
  npm run typecheck
  git diff --check
  ```

  Expected: all commands pass.

- [ ] **Step 10: Controller commit and push**

  After review approval and fresh verification, controller runs:

  ```bash
  git add src/app/shell src/app/state src/shared/ui src/app/PwaShell.tsx src/app/PwaShell.test.tsx docs/superpowers/project-status.md
  git commit -m "feat: add P10d console shell"
  git push origin codex/p10d-clean-architecture-rebase
  ```

## Task 3: Accounts Feature Migration

**Files:**
- Create: `src/features/accounts/AccountsModule.tsx`
- Move/Create: `src/features/accounts/PwaVaultAccessView.tsx`
- Move/Create: `src/features/accounts/PwaVaultWorkspace.tsx`
- Modify: `src/features/pwaVault/PwaVaultAccessView.tsx`
- Modify: `src/features/pwaVault/PwaVaultWorkspace.tsx`
- Modify: `src/features/pwaVault/PwaVaultAccessView.test.tsx`
- Modify: `src/features/pwaVault/PwaVaultWorkspace.test.tsx`
- Modify: `src/app/PwaShell.tsx`
- Modify: `src/app/PwaShell.test.tsx`

- [ ] **Step 1: Add accounts module wrapper**

  Create `src/features/accounts/AccountsModule.tsx`:

  ```tsx
  import type { ReactNode } from "react";

  export function AccountsModule({ children }: { children: ReactNode }) {
    return (
      <section className="accounts-module" aria-labelledby="accounts-module-title">
        <header className="module-header">
          <div>
            <p className="eyebrow">账户库</p>
            <h2 id="accounts-module-title">账户库</h2>
            <p>一套助记词一个组，组内可派生多个本地账户；当前只启用加密 vault 与账户派生。</p>
          </div>
        </header>
        {children}
      </section>
    );
  }
  ```

- [ ] **Step 2: Move account view modules**

  Copy the exact current contents of:

  - `src/features/pwaVault/PwaVaultAccessView.tsx`
  - `src/features/pwaVault/PwaVaultWorkspace.tsx`

  into:

  - `src/features/accounts/PwaVaultAccessView.tsx`
  - `src/features/accounts/PwaVaultWorkspace.tsx`

  Update imports in the new files to use the target boundary:

  ```ts
  import type { BrowserVaultAccountRecord, BrowserVaultGroupRecord } from "../../core/accounts";
  ```

- [ ] **Step 3: Keep old feature paths as compatibility re-exports**

  Replace `src/features/pwaVault/PwaVaultAccessView.tsx` with:

  ```ts
  export { PwaVaultAccessView } from "../accounts/PwaVaultAccessView";
  export type { PwaVaultAccessViewProps } from "../accounts/PwaVaultAccessView";
  ```

  Replace `src/features/pwaVault/PwaVaultWorkspace.tsx` with:

  ```ts
  export { PwaVaultWorkspace } from "../accounts/PwaVaultWorkspace";
  export type { PwaVaultWorkspaceProps } from "../accounts/PwaVaultWorkspace";
  ```

- [ ] **Step 4: Update `PwaShell` imports and account render**

  In `src/app/PwaShell.tsx`, replace:

  ```ts
  import { PwaVaultAccessView } from "../features/pwaVault/PwaVaultAccessView";
  import { PwaVaultWorkspace } from "../features/pwaVault/PwaVaultWorkspace";
  ```

  with:

  ```ts
  import { AccountsModule } from "../features/accounts/AccountsModule";
  import { PwaVaultAccessView } from "../features/accounts/PwaVaultAccessView";
  import { PwaVaultWorkspace } from "../features/accounts/PwaVaultWorkspace";
  ```

  Wrap both locked and unlocked return paths in `renderAccountsSection()` with:

  ```tsx
  <AccountsModule>...</AccountsModule>
  ```

- [ ] **Step 5: Update account tests for new heading**

  In `src/app/PwaShell.test.tsx`, after navigating to `账户库`, assert:

  ```ts
  expect(screen.getByRole("heading", { name: "账户库" })).toBeInTheDocument();
  ```

  Keep existing vault create/import/derive/lock assertions unchanged.

- [ ] **Step 6: Run focused verification**

  Run:

  ```bash
  npm test -- src/features/pwaVault/PwaVaultAccessView.test.tsx src/features/pwaVault/PwaVaultWorkspace.test.tsx src/app/PwaShell.test.tsx
  npm run typecheck
  git diff --check
  ```

  Expected: all commands pass.

- [ ] **Step 7: Controller commit and push**

  After review approval and fresh verification, controller runs:

  ```bash
  git add src/features/accounts src/features/pwaVault src/app/PwaShell.tsx src/app/PwaShell.test.tsx docs/superpowers/project-status.md
  git commit -m "refactor: migrate account vault feature"
  git push origin codex/p10d-clean-architecture-rebase
  ```

## Task 4: Settings Feature Migration

**Files:**
- Create: `src/features/settings/SettingsModule.tsx`
- Move/Create: `src/features/settings/PwaChainSettingsPanel.tsx`
- Move/Create: `src/features/settings/PwaFeePanel.tsx`
- Modify: `src/features/pwaSettings/PwaChainSettingsPanel.tsx`
- Modify: `src/features/pwaSettings/PwaFeePanel.tsx`
- Modify: `src/app/PwaShell.tsx`
- Modify: `src/app/PwaShell.test.tsx`

- [ ] **Step 1: Add settings module wrapper**

  Create `src/features/settings/SettingsModule.tsx`:

  ```tsx
  import type { ReactNode } from "react";

  export function SettingsModule({ children }: { children: ReactNode }) {
    return (
      <section className="settings-module" aria-labelledby="settings-module-title">
        <header className="module-header">
          <div>
            <p className="eyebrow">设置</p>
            <h2 id="settings-module-title">设置</h2>
            <p>链/RPC 配置保存在浏览器本地；fee 参数是当前页面 session-only 草稿。</p>
          </div>
        </header>
        {children}
      </section>
    );
  }
  ```

- [ ] **Step 2: Move settings view modules**

  Copy current contents of:

  - `src/features/pwaSettings/PwaChainSettingsPanel.tsx`
  - `src/features/pwaSettings/PwaFeePanel.tsx`

  into:

  - `src/features/settings/PwaChainSettingsPanel.tsx`
  - `src/features/settings/PwaFeePanel.tsx`

  Update imports in new files:

  ```ts
  import { getPrimaryRpcEndpoint, type BrowserChainRecord, type BrowserChainRecordInput, type BrowserRpcEndpoint } from "../../core/chains";
  import type { BrowserFeeDraft } from "../../core/fees";
  import { formatEstimatedNativeCost } from "../../shared/format/number";
  ```

- [ ] **Step 3: Keep old settings paths as compatibility re-exports**

  Replace `src/features/pwaSettings/PwaChainSettingsPanel.tsx` with:

  ```ts
  export { PwaChainSettingsPanel } from "../settings/PwaChainSettingsPanel";
  export type { PwaChainSettingsPanelProps } from "../settings/PwaChainSettingsPanel";
  ```

  Replace `src/features/pwaSettings/PwaFeePanel.tsx` with:

  ```ts
  export { PwaFeePanel } from "../settings/PwaFeePanel";
  export type { PwaFeePanelProps } from "../settings/PwaFeePanel";
  ```

- [ ] **Step 4: Update `PwaShell` settings imports and render**

  In `src/app/PwaShell.tsx`, replace:

  ```ts
  import { PwaChainSettingsPanel } from "../features/pwaSettings/PwaChainSettingsPanel";
  ```

  with:

  ```ts
  import { SettingsModule } from "../features/settings/SettingsModule";
  import { PwaChainSettingsPanel } from "../features/settings/PwaChainSettingsPanel";
  ```

  Wrap `renderSettingsSection()` with:

  ```tsx
  return (
    <SettingsModule>
      <PwaChainSettingsPanel
        activeChain={activeChain}
        busy={chainConfigBusy}
        chains={chainConfig?.chains ?? []}
        error={chainConfigError}
        onAddChain={(input) => updateChainConfig((state) => addBrowserChainRecord(state, input))}
        onSelectChain={(chainId) => updateChainConfig((state) => selectBrowserChain(state, chainId))}
        onUpdateChain={(chainId, updates) =>
          updateChainConfig((state) => updateBrowserChainRecord(state, chainId, updates))
        }
        onUpdateFeeDraft={(chainId, updates) =>
          updateFeeDraft((state) => updateBrowserFeeDraft(state, chainId, updates))
        }
        onUpdatePrimaryRpc={(chainId, updates) =>
          updateChainConfig((state) => updatePrimaryRpcEndpoint(state, chainId, updates))
        }
      />
    </SettingsModule>
  );
  ```

- [ ] **Step 5: Run focused verification**

  Run:

  ```bash
  npm test -- src/lib/browserChainConfig.test.ts src/core/browserChainConfig.test.ts src/app/PwaShell.test.tsx
  npm run typecheck
  git diff --check
  ```

  Expected: all commands pass. The PwaShell setting test must still prove RPC persists and fee draft resets.

- [ ] **Step 6: Controller commit and push**

  After review approval and fresh verification, controller runs:

  ```bash
  git add src/features/settings src/features/pwaSettings src/app/PwaShell.tsx src/app/PwaShell.test.tsx docs/superpowers/project-status.md
  git commit -m "refactor: migrate settings feature"
  git push origin codex/p10d-clean-architecture-rebase
  ```

## Task 5: Split Styles And Update Browser Smoke

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/base.css`
- Create: `src/styles/layout.css`
- Create: `src/styles/components.css`
- Create: `src/styles/features.css`
- Modify: `src/styles.css`
- Modify: `tests/browser/pwa-smoke.spec.ts`

- [ ] **Step 1: Split stylesheet files**

  Create `src/styles/tokens.css` with the current `:root` design tokens.

  Create `src/styles/base.css` with current base element rules:

  - `*`
  - `body`
  - `button`, `input`, `select`, `textarea`
  - `button`
  - `button:hover:not(:disabled)`
  - `button:disabled`
  - `input`, `select`, `textarea`
  - `textarea`
  - `label`
  - `table`, `th`, `td`

  Create `src/styles/layout.css` with new shell selectors:

  - `.app-shell`
  - `.app-navigation`
  - `.app-navigation-brand`
  - `.app-navigation-list`
  - `.app-nav-item`
  - `.app-nav-item-active`
  - `.app-shell-main`
  - `.app-topbar`
  - `.app-shell-content`
  - `.app-workspace`
  - `.app-preview-rail`
  - responsive rules for `max-width: 900px`

  Create `src/styles/components.css` with shared selectors:

  - `.status-badge`
  - `.notice-panel`
  - `.module-header`
  - `.module-grid`
  - `.module-placeholder`
  - existing card, button, form, error, badge, mono, muted selectors.

  Create `src/styles/features.css` with account and settings selectors:

  - `.accounts-module`
  - `.settings-module`
  - `.pwa-vault-workspace`
  - `.pwa-vault-workspace-grid`
  - `.pwa-account-list`
  - `.pwa-account-row`
  - `.pwa-settings-panel`
  - `.pwa-settings-grid`
  - `.pwa-fee-panel`
  - `.pwa-fee-summary`

  Replace `src/styles.css` with:

  ```css
  @import "./styles/tokens.css";
  @import "./styles/base.css";
  @import "./styles/layout.css";
  @import "./styles/components.css";
  @import "./styles/features.css";
  ```

- [ ] **Step 2: Update smoke navigation labels**

  In `tests/browser/pwa-smoke.spec.ts`, change:

  ```ts
  const navLabels = ["账户", "资产", "分发/归集", "铭文刻录", "合约调用", "历史", "设置"];
  ```

  to:

  ```ts
  const navLabels = ["总览", "账户库", "资产", "分发/归集", "铭文刻录", "合约调用", "队列/历史", "设置"];
  ```

  Update the first smoke test to assert:

  ```ts
  await expect(page.getByText("PWA 控制台")).toBeVisible();
  await expect(page.getByLabel("预览与风险")).toBeVisible();
  ```

  Update account navigation clicks from `账户` to `账户库`.

- [ ] **Step 3: Run focused verification**

  Run:

  ```bash
  npm test -- src/app/PwaShell.test.tsx
  npm run typecheck
  npm run smoke:browser
  git diff --check
  ```

  Expected: all commands pass on desktop and mobile production preview.

- [ ] **Step 4: Controller commit and push**

  After review approval and fresh verification, controller runs:

  ```bash
  git add src/styles.css src/styles tests/browser/pwa-smoke.spec.ts docs/superpowers/project-status.md
  git commit -m "refactor: split P10d styles and smoke coverage"
  git push origin codex/p10d-clean-architecture-rebase
  ```

## Task 6: Documentation, Status, And Full Release Gate

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/project-overview.md`
- Modify: `docs/superpowers/project-status.md`
- Modify: `docs/superpowers/roadmap.md`
- Modify: `docs/superpowers/specs/2026-05-13-clean-architecture-rebase-design.md`

- [ ] **Step 1: Update README current paths**

  In `README.md`, update key paths to include:

  ```text
  src/app/shell/                  Console shell layout
  src/app/state/                  Pure app navigation/session helpers
  src/features/accounts/          Account vault and local account library UI
  src/features/settings/          Chain/RPC and fee draft UI
  src/shared/                     Shared UI, formatting, validation, constants
  src/services/storage/           Browser storage service boundaries
  src/styles/                     Split design tokens, layout, components, features
  ```

  Remove wording that implies `src/app/PwaShell.tsx` is the full current shell; describe it as orchestration.

- [ ] **Step 2: Update project overview**

  In `docs/superpowers/project-overview.md`:

  - Mark P10d as complete after implementation.
  - Update key runtime files to the new architecture.
  - Keep the statement that no signing, broadcasting, balance scanning, distribution, ABI calls, reverse parsing, or real history exists yet.
  - Set next milestone to P11 account library expansion.

- [ ] **Step 3: Update roadmap**

  In `docs/superpowers/roadmap.md`, under P10d "Done when", ensure it states the architecture and shell are complete and still says P11-P17 behaviors are future milestones.

- [ ] **Step 4: Update status table**

  In `docs/superpowers/project-status.md`, add final P10d row:

  ```markdown
  | P10d | Clean architecture rebase implementation | `codex/p10d-clean-architecture-rebase` | output of `git rev-parse --short HEAD` after the final Task 6 commit | passed | `npm test`; `npm run typecheck`; `npm run build`; `npm run smoke:browser`; `git diff --check` | yes | no | Console shell, target source boundaries, migrated account/settings modules, split styles, and current-behavior preservation are complete on the milestone branch. |
  ```

  Use the exact short commit printed by `git rev-parse --short HEAD` after the final implementation commit exists.

- [ ] **Step 5: Run the full verification gate**

  Run:

  ```bash
  npm test
  npm run typecheck
  npm run build
  npm run smoke:browser
  git diff --check
  ```

  Expected:

  - all unit tests pass;
  - typecheck passes;
  - production build passes;
  - browser smoke passes in desktop and mobile projects;
  - diff check has no whitespace errors.

- [ ] **Step 6: Controller final commit and push**

  After final review approval and fresh verification, controller runs:

  ```bash
  git add README.md docs/superpowers/project-overview.md docs/superpowers/project-status.md docs/superpowers/roadmap.md docs/superpowers/specs/2026-05-13-clean-architecture-rebase-design.md
  git commit -m "docs: mark P10d architecture rebase ready"
  git push origin codex/p10d-clean-architecture-rebase
  ```

## Final Milestone Review And Merge

- [ ] **Step 1: Final whole-branch review**

  Dispatch final spec reviewer for the whole P10d branch. Reviewer checks:

  - P10d scope matches `docs/superpowers/specs/2026-05-13-clean-architecture-rebase-design.md`.
  - Product requirements from `docs/superpowers/specs/2026-05-13-wallet-benchmark-product-design.md` are only represented as future lanes, not fake current features.
  - Current vault, chain/RPC, fee draft, manifest, and smoke-tested behavior remain available.

- [ ] **Step 2: Final code quality review**

  Dispatch final code quality reviewer for the whole P10d branch. Reviewer checks:

  - Shell files do not accumulate wallet business logic.
  - Shared components are small and reusable.
  - Compatibility re-exports do not hide broken imports.
  - Tests cover desktop/mobile shell, unavailable future modules, vault, settings, and no send controls.

- [ ] **Step 3: Controller full verification**

  Run:

  ```bash
  npm test
  npm run typecheck
  npm run build
  npm run smoke:browser
  git diff --check
  ```

- [ ] **Step 4: Merge P10d to main**

  In `/Users/wukong/mylife/Defi-United`:

  ```bash
  git fetch origin
  git checkout main
  git pull --ff-only origin main
  git merge --no-ff codex/p10d-clean-architecture-rebase -m "merge: P10d clean architecture rebase"
  npm test
  npm run typecheck
  npm run build
  npm run smoke:browser
  git diff --check
  git push origin main
  ```

- [ ] **Step 5: Update main status**

  After merge, update `docs/superpowers/project-status.md` on `main` so the P10d implementation row has:

  - branch: `main`
  - commit: merge commit short SHA
  - pushed: `yes`
  - merged: `yes`

  Then run:

  ```bash
  git diff --check
  git add docs/superpowers/project-status.md
  git commit -m "docs: mark P10d merged"
  git push origin main
  ```

## Plan Self-Review

- Spec coverage: P10d purpose, goals, non-goals, shell structure, source layout, migration map, state/security boundaries, verification, acceptance criteria, and P11-P17 lane preservation are each mapped to tasks above.
- Placeholder scan: this plan contains no `TBD`, `TODO`, or unspecified implementation sections.
- Type consistency: module ids are consistently `dashboard`, `accounts`, `assets`, `distribution`, `inscriptions`, `contracts`, `queueHistory`, and `settings`.
- Scope check: this plan intentionally excludes live transaction features and reserves them for P11-P17.
