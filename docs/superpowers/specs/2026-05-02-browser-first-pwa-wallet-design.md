# Browser-First PWA Wallet Design

## 1. Purpose

本 spec 记录 EVM Wallet Workbench 的下一阶段产品方向：从当前 Tauri desktop-only 主线转向 **browser-first PWA 钱包工作台**。新方向要求 PC 和移动端都能通过 PWA 使用，并允许在前端完成账户解锁、交易签名和 RPC 广播。

这不是当前已完成能力说明。当前 README 和项目级 spec 仍描述已经合并的 Tauri desktop v1；本文件是后续 P10+ 架构转向和实施计划的设计输入。真正进入实施前，需要用 plan 拆分任务，并在完成后同步 README、项目级 spec、workflow、status 和 roadmap 的 current/future wording。

## 2. Product Direction

### 2.1 主线形态

- 第一主线：PWA/browser-first wallet。
- 支持形态：PC 浏览器、移动浏览器、可安装 PWA。
- 中文优先：主要 UI、错误、确认页、风险提示、批量结果和设置都默认中文。
- Tauri desktop 不再作为唯一前台主线；后续可以作为本地安全壳、调试壳或高级能力入口存在，但 PWA 是新产品体验的主线。

### 2.2 核心目标

- 在浏览器/PWA 内完成账户管理、资产查看、交易构建、签名和广播。
- 支持一套助记词对应一个账户组，每个组可派生任意数量 EVM 子账户。
- 支持快速机会场景：解锁后当前标签页内不反复输密码，不逐笔弹确认。
- 支持多账户、多目标、多次交易的批量执行队列。
- 在所有发送入口统一展示 latest base fee、base fee multiplier、priority fee/tip、max fee 和高风险提示。

### 2.3 非目标

- 不承诺云同步、服务端托管私钥或多人协作。
- 不默认把助记词、私钥、明文 vault 或签名材料上传到任何服务端。
- 不做浏览器扩展钱包。
- 不做消费级“极简钱包”；目标用户仍是懂 EVM、nonce、gas、RPC 和批量交易风险的高级用户。
- 不在第一阶段实现硬件钱包、MPC、社交恢复或跨设备自动同步。

## 3. Security Model

### 3.1 浏览器本地加密 vault

- vault 默认保存在浏览器本地存储中，具体实现优先使用 IndexedDB。
- vault 必须加密保存；浏览器持久化层不得保存明文助记词、明文私钥或 raw signed transaction。
- 支持导出加密 vault 文件，用于备份和跨设备迁移。
- 支持导入加密 vault 文件，导入后进入本地 vault 列表。
- 每个 vault 对应一个账户组；组内通过标准派生路径派生子账户。

### 3.2 解锁和热会话

- 用户输入密码解锁 vault 后，助记词/派生能力只保留在当前标签页运行时内存。
- 默认策略：当前标签页关闭即失效；不自动超时锁定。
- 提供手动锁定按钮；锁定后清除内存中的助记词、私钥派生缓存和待签名热状态。
- 页面刷新、PWA 进程被系统回收、浏览器崩溃或标签页关闭后，必须重新输入密码。
- 热会话期间允许快速签名和批量广播，不逐笔要求密码。

### 3.3 风险提示

- 创建/导入 vault、解锁、开启批量广播和导出加密 vault 时必须明确提示风险。
- 快速模式的风险说明必须写清：解锁后的当前标签页具备签名能力，用户应避免在不可信设备或被远程控制的环境中使用。
- 错误、日志、导出和诊断不得包含明文助记词、私钥、raw signed transaction、完整 RPC 凭据或密码。

## 4. Account Model

### 4.1 账户组

- 一套助记词对应一个账户组。
- 账户组有可编辑名称、创建时间、派生路径配置和账户列表。
- 初始版本可以只支持一个活跃账户组，但模型必须允许后续多个账户组并存。

### 4.2 派生账户

- 每个组可以按索引派生任意数量子账户。
- 子账户至少包含：索引、地址、显示名、是否选中、创建/派生时间、备注。
- 支持批量派生：例如一次增加 10 个、50 个或自定义数量。
- 所有交易页都使用统一的本地账户选择器。

### 4.3 地址来源

批量相关页面的地址来源必须统一支持：

- 手动逐条添加。
- 从本地派生账户中多选。
- 粘贴导入，支持一行一个地址或带金额/次数的文本。
- 文件导入，支持 CSV、JSON 和纯文本。

## 5. Chain And RPC Model

- 支持多条 EVM 链。
- RPC 是用户配置的链访问端点，不是链身份。
- 保存或使用 RPC 前必须探测 `chainId` 并与用户选择的链匹配。
- 每条链保留 native symbol、chainId、RPC URL、explorer URL、是否启用等配置。
- 批量广播时需要独立的 RPC rate limit 配置，不能只依赖并发数控制。

## 6. Shared Fee Panel

所有发送交易的页面必须使用同一套 fee 模型和 UI：

- 展示 latest block `baseFeePerGas`。
- `baseFee` 默认使用 latest base fee。
- `baseFeeMultiplier` 默认 `2`。
- `priorityFeePerGas` 默认使用 provider 建议值；缺失时使用安全 fallback。
- `maxFeePerGas` 默认按 `baseFee * multiplier + priorityFee` 计算。
- 支持手动调整 base fee、multiplier、priority fee 和 max fee override。
- 默认值不持久化；每次打开页面都重新从默认值开始。
- 页面打开期间的修改只在当前页面实例内有效。
- 构建计划和确认页必须展示最终 gas、fee、nonce、total cost 和风险提示。
- 如果用户设置的 fee 明显偏离 latest reference，例如 base fee 或 priority fee 过高，必须给出高风险提醒。

## 7. Fast Operation Model

### 7.1 标准流程

发送类页面统一采用：

```text
编辑参数 -> 生成计划 -> 集中预检查 -> 一次确认 -> 自动签名广播队列
```

不得设计成：

```text
每笔交易 -> 输密码 -> 确认 -> 下一笔
```

### 7.2 预检查

开始队列前必须尽量完成：

- RPC chainId 检查。
- 账户 native 余额检查。
- ERC-20 余额检查。
- nonce 起点读取。
- gas 估算或可解释的估算失败。
- fee 总成本估算。
- calldata 格式检查。
- 合约地址格式检查。
- 分发/归集合约地址固定为 `0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3`，展示时统一 checksum。

### 7.3 执行队列

- 默认全局并发数为 `20`，用户可调整。
- 多账户任务按账户平均分配并发额度。
- 每个账户至少 1 个执行槽。
- 同一账户内交易必须按 nonce 顺序签名和广播。
- 不同账户之间可以并发。
- RPC rate limit 独立可配置。
- 单笔失败默认继续跑后续任务。
- 失败记录必须包含账户、nonce、交易参数摘要、错误分类、RPC 错误和可重试状态。
- 重跑时支持从某个账户失败的 nonce 开始继续，不影响其他账户队列。

## 8. Main Product Areas

### 8.1 账户管理

目标：

- 创建或导入加密 vault。
- 解锁当前标签页热会话。
- 管理账户组和派生子账户。
- 批量派生账户。
- 查看每个账户在当前链上的 native 和 token 摘要。

验收标准：

- 用户可以创建一套助记词对应的账户组。
- 用户可以连续派生多个账户并命名。
- 用户可以选择部分账户作为后续批量页面的输入。
- 明文助记词只在创建/备份流程的明确安全上下文中展示；普通账户管理页不得显示明文助记词。

### 8.2 资产查看

目标：

- 查看选中账户在选中链上的 native 余额。
- 查看 ERC-20 token 余额。
- 支持 token watchlist 和手动添加 token contract。
- 为后续分发、归集和铭文刻录提供余额/nonce 预检查数据。

验收标准：

- 资产数据按 `account + chainId + tokenContract` 隔离。
- 余额刷新必须校验 RPC chainId。
- 失败、过期或不完整的数据不能显示成“余额为 0”。

### 8.3 分发 / 归集页面

一个页面内提供两个模式：分发和归集。

**分发模式**

- 单个发送账户调用固定分发合约。
- 分发合约地址为 `0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3`。
- 支持 native 和 ERC-20 分发。
- 单次分发是一笔链上交易，由发送账户签名。
- 接收地址来源支持手动、本地账户多选、粘贴和文件导入。
- 金额支持统一金额或每行自定义金额。

**归集模式**

- 多个发送账户向一个目标账户归集。
- 每个发送账户各自签名并广播一笔或多笔交易。
- 目标账户可以从本地账户选择，也可以手动输入外部地址。
- 支持 native 和 ERC-20 归集。
- 归集的每个账户按自己的 nonce 顺序执行；不同账户可并发。

验收标准：

- 分发模式显示为“一笔合约交易 + 多接收方”。
- 归集模式显示为“多账户各自转账 + 一个目标地址”。
- 两种模式都走统一 fee 面板、预检查、队列和历史模型。

### 8.4 铭文刻录页面

目标：

- 选择多个本地地址作为发送账户。
- 支持目标地址为自转，即每个账户转给自己。
- 支持目标地址为固定外部/本地地址，即所有发送账户转给同一目标。
- 支持 calldata 输入模式：
  - hex：例如 `0x646174613a2c7b2270223a2265646d74222c226f70223a22656d742d6d696e74222c227469636b223a22656e6174222c22626c6b223a223139363730393631227d`
  - txt：例如 `data:,{"p":"edmt","op":"emt-mint","tick":"enat","blk":"19670961"}`
- txt 模式必须按 UTF-8 转换为 hex calldata，并在预览中展示转换结果。
- 可配置每个地址发送次数。
- 每个发送账户生成 `次数` 笔独立交易。

验收标准：

- 用户可以选择 10 个地址、每地址 10 次，并生成 100 笔交易计划。
- 同一账户的多笔铭文交易 nonce 连续且顺序执行。
- 失败后可从该账户失败 nonce 继续重跑。
- 预览页显示每个账户、目标地址、次数、calldata 摘要、nonce 范围和预计费用。

### 8.5 合约调用页面

目标：

- 用户输入合约地址。
- 如果合约开源，尝试自动获取 ABI。
- 如果没有获取到 ABI，支持手动粘贴或导入 ABI JSON。
- 如果没有 ABI，支持尝试逆向解析 selector 和 calldata 结构，但必须标记为不确定结果。
- 对有 ABI 的函数，提供友好的参数输入控件。
- 地址、地址数组参数可以直接从本地账户选择器填入。
- 数组、tuple、bytes、uint、bool、string 等常见类型要有结构化输入。
- 支持 read-only call 和 write transaction。
- write transaction 走统一 fee 面板、预检查、确认和队列。

验收标准：

- ABI 获取失败时不会阻塞手动粘贴。
- 地址数组参数可以通过多选本地账户填充。
- 逆向解析结果不得伪装成确定 ABI。
- 每个 write call 都保留 typed intent、参数摘要、calldata 摘要和 history 记录。

## 9. Transaction History

- 每笔签名广播的交易都必须生成本地历史记录。
- 历史按 Intent、Submission、ChainOutcome 三层展示。
- 批量任务需要有 batch job 视图和单笔 transaction 视图。
- batch job 记录输入参数、生成计划、开始/结束时间、成功数、失败数、暂停/重跑记录。
- 单笔交易记录账户、chainId、nonce、to、value、calldata 摘要、fee、tx hash、状态和错误。
- 不保存 raw signed transaction。

## 10. UX And Information Architecture

### 10.1 导航

建议一级导航：

- 账户
- 资产
- 分发/归集
- 铭文刻录
- 合约调用
- 历史
- 设置

### 10.2 移动端原则

- 移动端优先保证账户选择、参数输入、预览确认和队列状态清晰。
- 大表格在手机上必须转为分组列表或横向可控视图。
- 关键按钮固定在底部操作区，避免长表单滚动后找不到执行入口。
- 所有高风险动作需要集中确认，但不能逐笔确认。

### 10.3 中文体验

- UI 默认中文。
- 专业术语保留必要英文，例如 nonce、gas、base fee、priority fee、calldata、ABI、RPC。
- 错误提示必须包含用户可操作建议，例如重试、降低并发、切换 RPC、补充余额、重建计划。

## 11. Data Storage

浏览器本地持久化至少分为：

- encrypted vault records。
- account group registry。
- chain/RPC config。
- token watchlist。
- asset snapshots。
- batch job records。
- transaction history。
- non-sensitive diagnostics。

敏感材料不得出现在 diagnostics、history、错误提示或导出日志中。

## 12. Migration From Current Tauri v1

当前 Tauri desktop v1 已有很多交易模型、历史语义和 draft/fee 经验，但安全边界不同：

- 旧主线：React 只表达意图，Rust/Tauri 签名广播。
- 新主线：PWA 前端在热会话内派生、签名并广播。

迁移时应该复用：

- typed intent / submission / chain outcome 概念。
- chainId 校验。
- fee reference / multiplier / tip 模型。
- history reconciliation 思路。
- ERC-20 metadata/watchlist 思路。
- ABI、raw calldata、batch 的已有业务理解。

不能直接复用：

- “React 不接触助记词/私钥”的旧安全不变量。
- 只面向 desktop 的 app data storage。
- 依赖 Rust command 的签名广播边界。

## 13. Implementation Decomposition

本 spec 涉及多个独立子系统，不能作为一个大任务一次性实现。推荐拆分为：

1. P10a PWA architecture baseline and Chinese shell。
2. P10b browser encrypted vault and account groups。
3. P10c chain/RPC config and shared fee panel。
4. P10d asset watchlist and balance snapshots。
5. P10e batch execution engine and history model。
6. P10f distribution/collection page。
7. P10g inscription minting page。
8. P10h contract call page with ABI input helpers。
9. P10i mobile/PWA install polish and release wording.

每个子任务必须按项目 workflow 走 implementer、spec reviewer、code quality reviewer、controller fresh verification、commit/push。里程碑完成后再 merge 到 `main`。

## 14. Acceptance Criteria For The Milestone

- PWA 能在 PC 和移动浏览器打开，并可安装到主屏/桌面。
- 用户可以创建/导入加密 vault、解锁当前标签页、派生账户。
- 用户可以查看 selected accounts 的 native 和 ERC-20 余额。
- 分发/归集页面按本 spec 的两种模式工作。
- 铭文刻录页面能生成多账户、多次数交易计划，并按队列签名广播。
- 合约调用页面支持 ABI 获取、粘贴、导入和不确定逆向解析入口。
- 所有发送页共用 fee 面板。
- 批量执行队列支持默认全局并发 20、可配置、账户间平均分配、失败继续和失败 nonce 重跑。
- 历史记录不保存 raw signed transaction。
- diagnostics / logs / exports 不泄露助记词、私钥、密码、raw signed tx 或完整 RPC secret。

## 15. Open Risks

- 浏览器前端签名显著改变安全边界，需要安全测试和清晰风险提示。
- PWA 在不同移动浏览器上的存储持久性、后台行为和安装能力不完全一致。
- 大批量交易可能遇到 RPC rate limit、nonce race、replacement semantics 和 provider mempool 差异。
- ABI 自动获取依赖 explorer/source provider，可用性受链和服务限制。
- 前端保存 encrypted vault 需要认真处理备份、丢失、导入、密码错误和浏览器清理数据的恢复体验。
