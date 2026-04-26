# DeFi United · Local Donor

**纯本地**的 DeFi United 捐款账户管理工具。  
一根助记词 → BIP-44 派生无限子账户 → 通过 Disperse 合约**单笔**分发 ETH 到所有子账户 → 每个子账户独立向目标地址捐款 → 一键扫回残余 ETH。

## 用途

针对 2026-04-18 rsETH 事件后由 Aave 服务商发起的 DeFi United 救助捐款（地址 `0x0fCa5194baA59a362a835031d9C4A25970effE68`），便于本地管理多账户参与流程。

## 技术栈

- React 18 + TypeScript + Vite
- ethers v6（BIP-39 / BIP-44 / EIP-1559）
- Web Crypto（PBKDF2 + AES-GCM）—— 助记词加密存浏览器 localStorage
- 无后端、无第三方钱包扩展依赖

## 安装与启动

```bash
npm install
npm run dev
# 浏览器打开 http://127.0.0.1:5173
```

构建生产版（可用 `npm run preview` 起静态服务）：

```bash
npm run build
npm run preview
```

## 使用流程

1. **首次启动**：选择「生成新助记词」或「导入已有助记词」，设置 ≥8 位密码，填入主网 RPC URL（推荐 Alchemy / Infura 免费档或自建节点）。**离线备份助记词**——丢失无法找回。
2. **检查 Settings**：确认 chainId = 1（主网）、Disperse 合约 selector 匹配。任一不通过，所有 Execute 按钮自动禁用。
3. **充值 Root**：从你的主钱包给 Root 地址打入足够的 ETH（含分发金额 + gas）。
4. **新增子账户**：「Child 账户」面板里输入 N，点「新增 N 个子账户」（可重复，索引单调递增并加密持久化）。
5. **Distribute**：选中要分发的子账户、填入每个金额，点「Simulate」预估 gas 与总成本，确认后「Execute」→ 主网弹窗二次确认 → 单笔 tx 通过 Disperse 合约批量分发。
6. **Donate**：每个选中子账户独立向目标地址发起捐款（限流 8 并发）。
7. **Sweep**（可选）：把子账户残余 ETH 全部扫回 Root（自动跳过余额不足以付 gas 的账户）。
8. **锁定**：右上角「锁定」清空内存中的助记词，下次需要密码解锁。

## 关键文件

```
src/
├── App.tsx                     # 顶层路由：Setup / Unlock / Dashboard
├── types.ts                    # 全局类型 + 默认值
├── state/
│   ├── crypto.ts               # AES-GCM + PBKDF2 (Web Crypto)
│   ├── vault.ts                # localStorage 加密包读写
│   └── store.ts                # Context + reducer
├── wallet/
│   ├── hd.ts                   # 助记词生成 + BIP-44 派生 m/44'/60'/0'/0/i
│   ├── provider.ts             # JsonRpcProvider + chainId 探测
│   ├── gas.ts                  # 费用估算 + 格式化
│   ├── pLimit.ts               # 极简并发限流
│   └── actions.ts              # distribute / donate / sweep
└── components/
    ├── SetupScreen.tsx
    ├── UnlockScreen.tsx
    ├── Dashboard.tsx
    ├── SettingsPanel.tsx
    ├── RootPanel.tsx
    ├── ChildAccountsTable.tsx
    ├── DistributeForm.tsx
    ├── DonateForm.tsx
    ├── SweepForm.tsx
    ├── ActivityLog.tsx
    └── ConfirmModal.tsx
```

## Disperse 合约

默认地址：`0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3`  
ABI：`disperseEther(address[] recipients, uint256[] values) payable` (selector `0xe63d38ed`)  
合约源码（Solidity ^0.4.25）：

```solidity
function disperseEther(address[] recipients, uint256[] values) external payable {
    for (uint256 i = 0; i < recipients.length; i++)
        recipients[i].transfer(values[i]);
    uint256 balance = address(this).balance;
    if (balance > 0)
        msg.sender.transfer(balance);
}
```

剩余 ETH 自动退回调用者；收款方均为 EOA，不存在合约 revert 风险。  
若你想改用其他批量分发合约（同 ABI），可在 Settings 里替换地址；selector 不匹配时 UI 会红字警告，但不阻断（用户自负）。

## 安全提示

1. **不要在不可信电脑上使用** —— 助记词解锁后存在浏览器内存。
2. **RPC 提供商能看到你所有的地址与交易** —— 介意隐私用本地节点。
3. **同一助记词派生的子账户链上完全可关联**，本工具不能改变这一事实。任何稍微正经的 sybil 过滤都能识别出来。
4. **gas 经济性** —— 主网即便 5 gwei 也意味着每笔约 \$0.20–0.50。批量做 100 子账户 + 每个 \$0.02 捐款，总 gas 远高于"捐款"本身。
5. **官方零承诺** —— DeFi United 至今没有任何关于代币 / 空投的官方表态，所有"博空投"的预期都是社区自发行为。

## 风险免责

本工具仅供本地学习与个人资金管理使用。不保证任何空投/收益。链上交易不可逆，使用者自负后果。
