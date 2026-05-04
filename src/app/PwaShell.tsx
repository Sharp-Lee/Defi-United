import { useEffect, useState } from "react";
import {
  addBrowserVaultGroup,
  createInitialBrowserVaultState,
  deriveBrowserVaultAccounts,
  getActiveBrowserVaultGroup,
  renameBrowserVaultAccount,
  renameBrowserVaultGroup,
  selectBrowserVaultAccount,
  selectBrowserVaultGroup,
} from "../core/browserVault/accounts";
import { PwaVaultAccessView } from "../features/pwaVault/PwaVaultAccessView";
import { PwaVaultWorkspace } from "../features/pwaVault/PwaVaultWorkspace";
import {
  createBrowserVaultSession,
  hasBrowserVault,
  importBrowserVaultEnvelope,
  parseBrowserVaultEnvelope,
  saveBrowserVaultSession,
  serializeBrowserVaultEnvelope,
  unlockBrowserVaultSession,
  type BrowserVaultSession,
  type BrowserVaultStorage,
} from "../lib/browserVault";

type PwaSectionId =
  | "accounts"
  | "assets"
  | "orchestration"
  | "inscriptions"
  | "contracts"
  | "history"
  | "settings";

type PwaSection = {
  id: PwaSectionId;
  label: string;
  summary: string;
  planned: string[];
};

const pwaSections: PwaSection[] = [
  {
    id: "accounts",
    label: "账户",
    summary: "浏览器本地加密 vault、账户组、当前标签页热会话和派生账户。",
    planned: ["浏览器加密 vault", "账户组与地址标签", "当前标签页热会话"],
  },
  {
    id: "assets",
    label: "资产",
    summary: "规划承载原生币、ERC-20、NFT 和授权风险的浏览器侧资产视图。",
    planned: ["资产快照", "Token watchlist", "授权扫描与撤销入口"],
  },
  {
    id: "orchestration",
    label: "分发/归集",
    summary: "规划承载多账户分发、归集和批量执行队列。",
    planned: ["批量任务草稿", "共享 fee panel", "执行前确认与结果回执"],
  },
  {
    id: "inscriptions",
    label: "铭文刻录",
    summary: "规划承载 EVM calldata 铭文任务的模板、预览和批量刻录流程。",
    planned: ["铭文 payload 模板", "批量刻录预览", "gas 与 nonce 编排"],
  },
  {
    id: "contracts",
    label: "合约调用",
    summary: "规划承载 ABI 管理、只读调用、写入调用和 raw calldata 工作流。",
    planned: ["ABI 导入与缓存", "read/write 函数表单", "raw calldata 预览"],
  },
  {
    id: "history",
    label: "历史",
    summary: "规划承载本地交易历史、批量任务记录和可恢复诊断。",
    planned: ["本地历史记录", "pending/replaced/recovered 状态", "敏感字段脱敏诊断"],
  },
  {
    id: "settings",
    label: "设置",
    summary: "规划承载链配置、RPC 配置、PWA 安装提示和本地数据边界说明。",
    planned: ["链/RPC 注册表", "本地存储分区", "PWA 安装与移动端偏好"],
  },
];

function PwaSectionPanel({ section }: { section: PwaSection }) {
  return (
    <section className="pwa-panel" aria-labelledby={`pwa-section-${section.id}`}>
      <div className="pwa-panel-header">
        <div>
          <p className="pwa-kicker">P10c+ 页面骨架</p>
          <h2 id={`pwa-section-${section.id}`}>{section.label}</h2>
          <p>{section.summary}</p>
        </div>
        <span className="pwa-status-badge">当前未启用</span>
      </div>

      <div className="pwa-card-grid">
        <article className="pwa-card">
          <h3>计划能力</h3>
          <ul>
            {section.planned.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="pwa-card pwa-card-warning">
          <h3>安全边界</h3>
          <p>
            当前 P10b 只启用账户页的浏览器 encrypted vault 和账户组；本页仍不包含签名、广播、RPC 提交、余额扫描或真实交易历史写入。
          </p>
          <p>相关交易和链上能力待后续里程碑实现并完成专项安全评审后才会启用。</p>
        </article>
      </div>
    </section>
  );
}

export interface PwaShellProps {
  vaultStorage?: BrowserVaultStorage;
}

export function PwaShell({ vaultStorage }: PwaShellProps = {}) {
  const [activeSectionId, setActiveSectionId] = useState<PwaSectionId>("accounts");
  const [session, setSession] = useState<BrowserVaultSession | null>(null);
  const [vaultExists, setVaultExists] = useState(false);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const activeSection =
    pwaSections.find((section) => section.id === activeSectionId) ?? pwaSections[0];
  const activeGroup = session ? getActiveBrowserVaultGroup(session.state) : null;

  useEffect(() => {
    let cancelled = false;
    void hasBrowserVault(vaultStorage)
      .then((exists) => {
        if (!cancelled) setVaultExists(exists);
      })
      .catch((err) => {
        if (!cancelled) setVaultError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [vaultStorage]);

  async function updateSession(nextSessionPromise: Promise<BrowserVaultSession>) {
    setVaultBusy(true);
    setVaultError(null);
    try {
      const nextSession = await nextSessionPromise;
      setSession(nextSession);
      setVaultExists(true);
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : String(err));
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleCreateVault(password: string) {
    await updateSession(createBrowserVaultSession(password, createInitialBrowserVaultState(), vaultStorage));
  }

  async function handleUnlock(password: string) {
    await updateSession(unlockBrowserVaultSession(password, vaultStorage));
  }

  async function handleImportVault(serializedEnvelope: string) {
    setVaultBusy(true);
    setVaultError(null);
    try {
      await importBrowserVaultEnvelope(parseBrowserVaultEnvelope(serializedEnvelope), vaultStorage);
      setVaultExists(true);
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : String(err));
    } finally {
      setVaultBusy(false);
    }
  }

  async function persistVaultState(nextState: BrowserVaultSession["state"]) {
    if (!session) return;
    await updateSession(saveBrowserVaultSession(session, nextState, vaultStorage));
  }

  function handleExportVault() {
    if (!session) return;
    const serialized = serializeBrowserVaultEnvelope(session.envelope);
    const blob = new Blob([serialized], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "defi-united-encrypted-vault.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function renderAccountsSection() {
    if (!session) {
      return (
        <PwaVaultAccessView
          busy={vaultBusy}
          error={vaultError}
          hasVault={vaultExists}
          onCreateVault={handleCreateVault}
          onImportVault={handleImportVault}
          onUnlock={handleUnlock}
        />
      );
    }

    return (
      <PwaVaultWorkspace
        activeGroup={activeGroup}
        busy={vaultBusy}
        groups={session.state.groups}
        onAddGroup={() => void persistVaultState(addBrowserVaultGroup(session.state, `账户组 ${session.state.groups.length + 1}`))}
        onDeriveAccounts={(groupId, count) => void persistVaultState(deriveBrowserVaultAccounts(session.state, groupId, count))}
        onExportVault={handleExportVault}
        onLock={() => {
          setSession(null);
          setVaultError(null);
        }}
        onRenameAccount={(groupId, accountId, label) =>
          void persistVaultState(renameBrowserVaultAccount(session.state, groupId, accountId, label))
        }
        onRenameGroup={(groupId, name) => void persistVaultState(renameBrowserVaultGroup(session.state, groupId, name))}
        onSelectAccount={(groupId, accountId) =>
          void persistVaultState(selectBrowserVaultAccount(session.state, groupId, accountId))
        }
        onSelectGroup={(groupId) => void persistVaultState(selectBrowserVaultGroup(session.state, groupId))}
      />
    );
  }

  return (
    <main className="pwa-shell">
      <header className="pwa-hero">
        <div>
          <p className="pwa-kicker">Browser-first PWA mainline</p>
          <h1>DeFi United PWA 钱包工作台</h1>
          <p>
            面向 PC 浏览器、移动浏览器和可安装 PWA 的中文工作台基线。P10b 已启用浏览器本地 encrypted vault、当前标签页热会话和账户组。
          </p>
        </div>
        <div className="pwa-archive-callout" aria-label="归档桌面基线说明">
          <span>归档基线</span>
          <strong>Tauri desktop v1</strong>
          <p>保留为已验证实现参考和回归对照；新产品能力默认进入 PWA 主线。</p>
        </div>
      </header>

      <nav className="pwa-nav" aria-label="PWA 一级导航">
        {pwaSections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={section.id === activeSectionId ? "pwa-nav-item pwa-nav-item-active" : "pwa-nav-item"}
            aria-current={section.id === activeSectionId ? "page" : undefined}
            onClick={() => setActiveSectionId(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      {activeSection.id === "accounts" ? renderAccountsSection() : <PwaSectionPanel section={activeSection} />}
    </main>
  );
}
