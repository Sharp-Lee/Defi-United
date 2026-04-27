# EVM Wallet Workbench 项目级 Spec

## 1. 产品定位

EVM Wallet Workbench 是一个面向本地桌面使用的 EVM 钱包工作台。当前主线形态是 Tauri desktop app，前端使用 React/TypeScript 表达工作流和界面状态，Tauri/Rust 负责 vault、账户派生、交易签名、广播和本地持久化。

浏览器版本不再作为后续主线。后续产品、技术债治理、安全边界、测试和发布都以 Tauri desktop 形态为准；浏览器版本只作为历史参考或迁移来源，不承诺继续补齐功能。

## 2. 产品目标

- 提供一个长期自用、可审计、可恢复的 EVM 多账户工作台。
- 用单助记词 vault 管理多个派生账户，并在多条 EVM 链上查看账户状态。
- 支持专业模式原生币转账，提交前明确展示最终链、账户、nonce、gas 和费用参数。
- 将交易历史持久化到本地，并追踪 pending 交易后续状态。
- 在桌面侧隔离敏感能力，避免助记词和私钥进入 React UI 或浏览器运行环境。

## 3. 非目标

- 不作为通用消费级移动钱包。
- 不追求浏览器插件钱包或网页钱包形态。
- v1 不支持多助记词 vault、私钥导入、硬件钱包、只读地址。
- v1 不支持 ERC-20 转账、批量分发、合约 ABI 调用器、任意 calldata 发送。
- v1 不提供云同步、多人协作或跨设备状态同步。
- v1 不承诺 Windows/Linux 发布支持；当前目标平台优先为 macOS desktop。

## 4. 目标用户

- 熟悉 EVM、nonce、gas、RPC、pending/replacement 语义的高级用户。
- 需要在多条 EVM 链之间管理同一组派生账户的个人用户。
- 需要比普通钱包更透明地查看提交参数、历史记录和错误状态的使用者。
- 开发或运维场景下需要本地 anvil smoke check 辅助验证的钱包工作流使用者。

## 5. 核心场景

1. 创建或解锁本地 vault。
2. 从单助记词按标准 EVM 路径派生账户。
3. 为账户扫描指定链上的原生币余额和 nonce。
4. 验证并保存 RPC 配置，切换默认链或自定义 RPC。
5. 构建原生币转账 draft，确认冻结参数后由 Rust 签名并广播。
6. 广播后写入本地 pending 历史，并在后续 reconcile 中更新状态。
7. 对 pending 交易执行 replace 或 cancel。
8. 运行 anvil smoke check 验证本地转账闭环。

## 6. 当前 v1 能力边界

当前已合并 v1 是 Tauri EVM Wallet Workbench，已包含：

- vault/mnemonic 的本地创建、解锁和会话使用。
- desktop 创建 vault 时由 Rust 内部生成助记词；React 不接收、不显示、不校验明文助记词。
- 账户派生与链上扫描。
- RPC chainId 验证与 app-config 持久化。
- native transfer draft/submit。
- pending history 持久化和 reconcile。
- pending 交易 replace/cancel。
- anvil smoke check。

v1 的交易能力仅覆盖原生币转账。ERC-20、合约调用、批处理、策略编排、交易解析、复杂资产组合展示均属于后续/计划能力。

P3 desktop 不提供明文助记词 import/export/backup UI。当前恢复边界是保护本地 encrypted vault file 和对应密码；更完整的 native secure recovery workflow 属于后续设计，不应在 P3 文档或 UI 中写成已完成。

## 7. 架构边界

- React/TypeScript 负责 UI、表单、视图状态、只读查询和用户意图表达。
- Tauri/Rust 负责 vault 解密、助记词使用、账户派生、签名、广播和本地文件持久化。
- 最终交易广播必须走 Rust 命令层，不允许出现前端和 Rust 双广播出口。
- 本地持久化至少按 vault、app config、account registry、chain snapshots、tx history 的职责分离。

## 8. 核心安全/正确性不变量

### 8.1 RPC chainId 必须匹配

- 保存 RPC 前必须主动探测远端 `chainId`。
- 远端 `chainId` 必须与用户选择或请求的 `chainId` 一致。
- 如果 RPC 返回的 `chainId` 与期望值不一致，必须拒绝保存或拒绝提交。
- UI 展示名称不能覆盖真实 `chainId` 身份。

### 8.2 账户快照按 account + chain 隔离

- 账户本体是链无关实体。
- 余额、nonce、同步时间、同步错误等链上状态必须按 `account + chain` 维度存储和读取。
- 不同链上的同一地址不能共享 nonce 或余额快照。
- 不同账户在同一链上的状态也不能互相覆盖。

### 8.3 交易提交前本地历史恢复策略

- 提交新交易前必须能读取本地历史；历史文件损坏或不可读时，不应继续盲目广播。
- 应用重启后，本地 nonce 预留必须从持久化 pending 历史中恢复，而不是只依赖内存状态。
- 计算下一笔 nonce 时，必须同时考虑链上 nonce 和本地仍为 pending 的历史记录。
- 如果广播成功但本地历史写入失败，必须把 tx hash 和本地写入错误清楚返回给用户，避免交易已上链但本地无记录的静默失败。

### 8.4 交易状态含义

- `pending`：交易已广播或已进入本地追踪，但尚未看到终态 receipt，也未被判定为替换、取消或丢弃。
- `confirmed`：链上 receipt 状态表示成功。
- `failed`：链上 receipt 存在但状态表示失败或 reverted。
- `replaced`：同一 `account + chain + nonce` 的 pending 交易被另一笔交易取代，且取代交易不是取消模型。
- `cancelled`：同一 nonce 被取消交易取代。取消模型为向自身发送 0 值交易，并使用更高费用让原交易失效。
- `dropped`：本地 pending 交易没有确认 receipt，也未被明确识别为 replaced/cancelled，但链上 nonce 已推进到其 nonce 之后，或 RPC/mempool 视角已无法继续追踪，系统将其视为终态丢弃。

### 8.5 replace/cancel nonce 约束

- replace/cancel 必须绑定一笔现有 pending submission。
- replace/cancel 必须沿用原交易的 `chainId`、`from`、`account` 和 `nonce`。
- replace 可在同 nonce 下提高费用，并按产品定义调整交易内容。
- cancel 必须使用同 nonce、向自身发送 0 值交易的取消模型。
- replace/cancel 不是新的普通转账草稿，不能分配新 nonce。

### 8.6 敏感信息和助记词本地处理

- 助记词只在 Rust 侧解密、派生和签名流程中使用。
- desktop 创建 vault 时助记词必须在 Rust command 内部生成并直接加密写入 vault，不通过 Tauri 返回给 React。
- React UI 不接触明文助记词或派生私钥。
- 敏感信息不得写入日志、历史记录、错误消息或 app-config。
- vault 数据必须保存在本地应用数据目录，不能与可重建缓存混存。
- 应用不默认导出明文助记词、私钥或签名材料。

## 9. 交易三层模型

交易历史应按三层理解和展示：

- Intent：用户最初表达的操作意图，包括链、账户、目标地址、金额、nonce 和 fee 输入。
- Submission：最终冻结并提交给 Rust 的参数，包括不可变 draft key、交易 hash 和实际广播参数。
- ChainOutcome：链上或本地 reconcile 得到的结果，包括 pending、confirmed、failed、replaced、cancelled、dropped。

v1 + P3 已将基础历史列表升级为可筛选、可分组、可审计的历史视图。当前 UI 能展示 Intent / Submission / ChainOutcome 三层、按 `account + chainId + nonce` 聚合 nonce thread、解释 replace/cancel/dropped 语义，并提供当前 P3 范围内的安全动作入口与禁用原因。

## 10. P3 完成范围与后续 P4 方向

### 10.1 P3 History UX hardening 已完成

当前已完成：

- 历史记录可按账户、`chainId`、状态、nonce 和 nonce thread 筛选。
- 详情视图明确展示 Intent、Submission、ChainOutcome 三层信息。
- nonce thread 展示普通提交、replacement、cancellation 之间的关系。
- pending、confirmed、failed、replaced、cancelled、dropped 有明确状态解释和视觉区分。
- pending 记录的 replace/cancel 入口只对当前 nonce thread 的可操作 submission 开启；禁用原因必须可见。
- RPC、history storage、nonce、chain identity、reconcile/dropped 等常见错误会显示分类摘要和恢复提示。

### 10.2 P3 仍不包含的恢复能力

P3 只提供安全入口、解释和禁用原因，不承诺完成以下 P4 能力：

- dropped 记录的人工复核或手动重新 reconcile 操作。
- 广播成功但历史写入失败后的本地补录入口。
- 损坏 history/app-config 的交互式修复工具。
- 全量账户链上扫描来推导未知历史。
- 结构化诊断导出面板。

### 10.3 后续 P4 错误恢复

后续/计划：

- 历史文件损坏、app-config 损坏、RPC 不可用、chainId 不匹配时提供更明确的恢复路径。
- 对广播成功但历史写入失败的情况提供本地补录或重新扫描入口。
- 对 dropped 判定提供人工复核和重新 reconcile 能力。
- 改善 nonce 冲突、replacement underpriced、insufficient funds 等常见错误的用户指导。

### 10.4 后续 P4 可观测性

后续/计划：

- 增加本地结构化日志，但必须排除助记词、私钥和敏感签名材料。
- 为 RPC 探测、交易提交、历史写入、reconcile 更新提供可诊断事件。
- 在 UI 中提供只含非敏感信息的诊断面板或导出能力。
- 为 anvil smoke check 和关键命令增加更稳定的失败摘要。

### 10.5 后续 P4+ 能力扩展

后续/计划：

- ERC-20 转账。
- 批量原生币或 ERC-20 分发。
- 合约 ABI 调用器。
- 原始 calldata 发送。
- 更强的资产/授权/交互记录扫描。

以上能力尚未作为当前 v1 可用能力承诺。

## 11. 验收原则

- 不破坏 RPC chainId 匹配、`account + chain` 状态隔离、pending 历史恢复和敏感信息隔离。
- 不把浏览器版本重新设为主线。
- 新功能必须明确属于当前已实现、后续/计划或非目标，不能在文档和 UI 中混淆。
- 涉及交易提交、replace/cancel、reconcile 的改动必须覆盖关键状态迁移和错误路径。
