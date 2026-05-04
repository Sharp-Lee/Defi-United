# Roadmap

## Current Baseline

- P10 起活跃产品主线是 browser-first PWA 版 EVM Wallet Workbench，目标覆盖 PC 浏览器、移动浏览器和可安装 PWA。
- 当前已合并、可验证的 runtime/source baseline 是归档 Tauri desktop v1；它保留为实现参考、回归基线和安全边界对照，不再作为新产品能力的默认主线。
- 当前稳定事实来源是 `README.md`、`docs/specs/evm-wallet-workbench.md`、`docs/superpowers/development-workflow.md` 和 `docs/superpowers/project-status.md`。
- PWA 方向的详细设计输入是 `docs/superpowers/specs/2026-05-02-browser-first-pwa-wallet-design.md`；roadmap 只保留里程碑摘要，避免和 spec / plan 重复维护。
- P9 仓库清理已经完成并合并；当前仓库应继续保持“只保留高信号、可持续维护的文档”和干净的 main 分支状态。

## PWA Mainline Roadmap

### P10 Browser-First PWA Wallet Direction And Documentation Convergence

把项目文档体系从“当前主线是 Tauri desktop”收口为“PWA 是活跃主线，Tauri desktop v1 是归档 baseline”。本步骤只改文档，不改变 runtime 行为。

**Done when**

- README、项目级 spec、workflow、status 和 roadmap 都明确 PWA 是 P10+ 活跃主线。
- Tauri desktop v1 在文档中被标记为 archived / 归档 baseline。
- 状态表记录 P10 文档收口，并且 `git diff --check` 通过。

### P10a PWA Architecture Baseline And Chinese Shell

建立 PWA-first app shell、中文一级导航、移动端布局基线和 PWA installability 基线；不实现真实 vault 解锁、签名或广播。

**Done when**

- 浏览器打开时有清晰的中文 PWA shell 和主要页面入口。
- 移动端关键导航和操作区有可验证的 responsive 基线。
- PWA manifest / installability 基线存在，且没有伪造未实现的钱包能力。

### P10b Browser Encrypted Vault And Account Groups

实现浏览器本地 encrypted vault、当前标签页热会话、账户组和派生账户模型。

**Done when**

- 浏览器持久化层不保存明文助记词、私钥、密码或 raw signed transaction。
- 页面刷新、标签页关闭或 PWA 进程回收后需要重新输入密码。
- 用户可以创建/导入 encrypted vault，并派生可命名账户。

### P10c Chain/RPC Config And Shared Fee Panel

建立 PWA 多链 RPC 配置和所有发送页共用的 fee model / fee panel。

**Done when**

- RPC URL 只作为访问端点，不作为链身份。
- 保存或使用 RPC 前必须探测并匹配远端 `chainId`。
- 发送计划和确认页展示最终 gas、fee、nonce、total cost 和风险提示。

### P10d Asset Watchlist And Balance Snapshots

为 PWA 建立账户资产查看基础，覆盖 native balance、ERC-20 watchlist 和按 account + chainId + token 隔离的 snapshot。

**Done when**

- 用户可以查看 selected accounts 的 native 和 watched ERC-20 余额。
- 余额刷新必须校验 RPC chainId。
- 失败、过期或覆盖不完整的数据有明确状态，不显示成“余额为 0”。

### P10e Batch Execution Engine And History Model

建立 PWA 批量执行队列、本地 transaction history 和 batch job history。

**Done when**

- 批量任务有 job 视图和单笔 transaction 视图。
- 同一账户内按 nonce 顺序签名和广播，不同账户之间可并发。
- 失败记录包含账户、nonce、交易参数摘要、错误分类、RPC 错误和可重试状态。

### P10f Distribution And Collection Page

实现 PWA 分发/归集页面，复用 shared fee panel、预检查、队列和历史模型。

**Done when**

- 分发模式显示为“一笔合约交易 + 多接收方”。
- 归集模式显示为“多账户各自转账 + 一个目标地址”。
- 两种模式都走统一 fee panel、预检查、队列和历史模型。

### P10g Inscription Minting Page

实现多账户、多次数的铭文刻录计划、预览和队列执行页面。

**Done when**

- 用户可以选择多个地址、设置每地址次数，并生成多笔交易计划。
- 同一账户多笔交易 nonce 连续且顺序执行。
- txt calldata 会按 UTF-8 转 hex，并在预览中展示转换结果。

### P10h Contract Call Page With ABI Input Helpers

实现 PWA 合约调用页面，支持 ABI 获取、粘贴、导入、参数输入和 read/write 调用计划。

**Done when**

- ABI 获取失败不阻塞手动 ABI 输入。
- 常见 ABI 类型有结构化输入，地址和地址数组可从本地账户选择器填入。
- 每个 write call 保留 typed intent、参数摘要、calldata 摘要和 history 记录。

### P10i Mobile/PWA Install Polish And Release Wording

完成 PWA 安装、移动端体验和 release/current wording 收口。

**Done when**

- PC 和移动浏览器都能完成 PWA 主流程。
- README 只写已完成且验证通过的 PWA 能力。
- 未完成能力仍留在 future / roadmap，不写成 current capability。

## Deferred Governance Backlog

### Branch And Worktree Hygiene Automation

把“查看哪些分支可删、哪些 worktree 可删、哪些远端分支必须保留”变成可重复执行的日常流程，而不是人工记忆。

### Documentation Lifecycle Convergence

继续收束已完成里程碑的历史设计/计划，只保留 durable truth，并减少 README、spec、workflow、status 和 roadmap 的重复内容。

### Status And Release Sync Guardrails

把“当前做到了哪”“什么时候可发布”“如何复核 main 是否真是最新”变成可检查的约束，而不是口头约定。

## Later Product Candidates

- Expanded portfolio and NFT discovery: 在 PWA asset snapshot 之上扩展 portfolio 可见性，但不承诺全量链上索引。
- Expanded authorization discovery: 扩展 ERC-20 / ERC-721 / ERC-1155 等常见授权形态的发现能力。
- Approval decisioning and conditional revoke expansion: 增强授权处理建议，但不做无脑一键撤销。
- Risk scoring and advisory surface: 组合 tx analysis、hot contract analysis、authorization 和 history 信号，输出 advisory 而不是安全结论。
- Wallet recovery automation: 改善 encrypted vault 的备份、导入、恢复和故障路径，但不默认暴露明文助记词 UI。
- Broader contract interaction tooling: 在 PWA contract call 基线之上扩展更广的 ABI / calldata 工具链。

## Non-Goals And Safety Boundaries

- roadmap 不把 PWA 未来候选写成当前已完成能力。
- roadmap 不把旧 browser donor source 恢复成可维护主线。
- roadmap 不承诺浏览器扩展钱包、云同步、服务端托管私钥或多人协作。
- roadmap 不突破敏感信息边界：助记词、私钥、密码、raw signed tx 和完整 RPC secret 都不能进入日志、diagnostics、history 或导出材料。
- roadmap 不替代 spec；真正进入实现前，必须先有对应 spec / plan / status 收口。
- roadmap 不删除仍需保留的历史上下文、未合并分支或带变更 worktree。

## Status Sync Rules

- 每个里程碑完成后，都要更新 `docs/superpowers/project-status.md` 的对应行。
- README 只写当前已完成能力；未来能力、探索项和候选里程碑留在 spec / plan / roadmap。
- 如果产品能力边界变化，先改 spec，再改 README，再改 status，最后再回填 roadmap。
- PWA 子任务完成前，只能把相关内容写为 design input、future direction 或 implementation plan。
- 任何 roadmap 调整都必须和当前 main 的真实状态一致，不能用路线图假装已实现。
- 任何任务收口前，都要保持 `git diff --check` 为绿色。
