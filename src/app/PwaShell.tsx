import { useState } from "react";

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
    summary: "规划承载浏览器本地加密 vault、账户组、解锁状态和链上账户概览。",
    planned: ["浏览器加密 vault", "账户组与地址标签", "链/RPC 选择后的只读账户快照"],
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
          <p className="pwa-kicker">P10a 页面骨架</p>
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
            P10a 只提供 PWA 信息架构和响应式壳；当前不包含 vault 解锁、助记词处理、私钥派生、签名、广播、RPC
            提交或真实交易历史写入。
          </p>
          <p>相关敏感能力待后续里程碑实现并完成专项安全评审后才会启用。</p>
        </article>
      </div>
    </section>
  );
}

export function PwaShell() {
  const [activeSectionId, setActiveSectionId] = useState<PwaSectionId>("accounts");
  const activeSection =
    pwaSections.find((section) => section.id === activeSectionId) ?? pwaSections[0];

  return (
    <main className="pwa-shell">
      <header className="pwa-hero">
        <div>
          <p className="pwa-kicker">Browser-first PWA mainline</p>
          <h1>DeFi United PWA 钱包工作台</h1>
          <p>
            面向 PC 浏览器、移动浏览器和可安装 PWA 的中文工作台基线。P10a 只建立导航、布局和 installability
            元数据，不启用真实钱包敏感操作。
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

      <PwaSectionPanel section={activeSection} />
    </main>
  );
}
