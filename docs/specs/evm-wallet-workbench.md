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
- native transfer draft/submit，包括 latest block `baseFeePerGas` 参考、可编辑 base fee 假设值、base fee multiplier、priority fee 和可选 max fee override。
- pending history 持久化和 reconcile。
- pending 交易 replace/cancel。
- anvil smoke check。
- P4-1 诊断事件与本地结构化日志：RPC 探测、交易提交、历史写入、reconcile 等关键路径已具备本地非敏感诊断事件基线。
- P4-2 诊断面板/导出：desktop UI 可查看、筛选和导出非敏感诊断事件。
- P4-3 历史文件损坏恢复：不可读历史有分类摘要、隔离/重建入口，并继续阻止盲目广播。
- P4-4 广播成功但历史写入失败补录：基于已知 tx hash 和冻结参数恢复本地记录，不重新签名或广播。
- P4-5 dropped 复核与重新 reconcile：保留原 dropped 判定并追加复核结果。
- P4-6 pending 老化策略：为长时间 pending 提供保守风险提示和适用动作建议。
- P4-7 anvil smoke check 诊断增强与 P4 回归：smoke check 失败摘要按环境、RPC/chainId、前端、vault/session、签名/广播、history、reconcile 和 Rust 回归分类。

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

### 8.6 原生币转账 fee reference

- Transfer draft 构建必须从当前 RPC 的 latest block 读取 `baseFeePerGas`，作为费用计算参考；这是交易构建假设值，不改变链上协议 base fee。
- 如果用户未手动输入 Base fee，且 latest block 提供 `baseFeePerGas`，UI 必须用该值回填 Base fee 输入；如果 latest block 不提供 base fee 且用户未输入，必须拒绝 build 并要求手动输入。
- 默认 `maxFeePerGas` 按 `baseFeePerGas * baseFeeMultiplier + maxPriorityFeePerGas` 计算，其中 multiplier 默认 `2`，十进制 multiplier 必须用整数/定点方式参与 wei 计算以避免浮点误差。
- Priority fee 留空时使用 `provider.getFeeData().maxPriorityFeePerGas`；缺失时使用 `1_500_000_000` wei fallback。
- Max fee override 是可选输入；留空代表使用自动计算值，自动计算值不得写回 override 输入。提交给 Rust 的仍然只有最终 `max_fee_per_gas` 和 `max_priority_fee_per_gas` 等既有字段。
- Confirmation 必须展示 latest base fee reference、base fee used、base fee multiplier、priority fee、最终 max fee、gas/total cost 和 frozen key。
- draft 冻结/失效必须覆盖 base fee、multiplier、priority fee、max fee override、nonce、gas、to、amount、chain/RPC/from 的变化。
- 保留 max fee、priority fee、gas limit 的高风险判断；当 `baseFeePerGas` used 超过 latest base fee reference 3 倍且 latest base fee 大于 0 时，也必须标记 high fee risk 并要求二次确认。

### 8.7 敏感信息和助记词本地处理

- 助记词只在 Rust 侧解密、派生和签名流程中使用。
- desktop 创建 vault 时助记词必须在 Rust command 内部生成并直接加密写入 vault，不通过 Tauri 返回给 React。
- React UI 不接触明文助记词或派生私钥。
- 敏感信息不得写入日志、历史记录、错误消息或 app-config。
- vault 数据必须保存在本地应用数据目录，不能与可重建缓存混存。
- 应用不默认导出明文助记词、私钥或签名材料。

### 8.8 诊断事件与本地结构化日志

- 诊断事件只记录排查所需的非敏感元数据，例如事件类型、时间、chainId、account/address 摘要、nonce、tx hash、错误分类、阶段和可恢复提示。
- 诊断事件不得包含助记词、私钥、seed、明文密码、签名原文、raw signed transaction、完整 RPC 认证凭据或其他签名材料。
- RPC URL、文件路径和错误消息进入日志前必须经过最小化或脱敏处理；含 token、basic auth、query secret 的端点不能原样写入。
- 诊断日志是本地排障材料，不是交易真相来源；交易状态仍以历史记录和链上 reconcile/receipt 为准。
- 诊断导出必须默认排除敏感材料，并在 UI 中明确展示导出内容范围。
- P4-1 已提供本地结构化日志基线；P4-2 已提供只含非敏感信息的诊断面板和导出入口。

### 8.9 恢复与补录边界

- 历史文件不可读或疑似损坏时，提交新交易前必须停止并给出明确恢复路径，不能为了保持 UI 可用而绕过本地历史读取。
- 损坏恢复应优先隔离原文件、保留可审计副本、生成用户可理解的错误摘要，再允许用户选择修复或重建索引。
- 广播成功但历史写入失败时，系统必须把 tx hash、chainId、account/from、nonce 和写入错误返回给用户；P4-4 已提供基于已知 tx hash 和冻结参数的补录入口，但不能假装已经自动补齐。
- 手动补录不得重新签名或重新广播原交易；它只能基于已知 tx hash、冻结参数和链上查询结果恢复本地历史记录。
- dropped 复核/重新 reconcile 必须保留 dropped 的原判定历史，并追加新的复核结果，不能静默改写成 confirmed/failed。
- pending 老化策略只能提供风险提示和适用动作建议；是否 replace/cancel/reconcile 仍需遵守原 nonce、account、chainId 和 Rust command 约束。

## 9. 交易三层模型

交易历史应按三层理解和展示：

- Intent：用户最初表达的操作意图，包括链、账户、目标地址、金额、nonce 和 fee 输入。
- Submission：最终冻结并提交给 Rust 的参数，包括不可变 draft key、交易 hash 和实际广播参数。
- ChainOutcome：链上或本地 reconcile 得到的结果，包括 pending、confirmed、failed、replaced、cancelled、dropped。

v1 + P3/P4 已将基础历史列表升级为可筛选、可分组、可审计的历史视图。当前 UI 能展示 Intent / Submission / ChainOutcome 三层、按 `account + chainId + nonce` 聚合 nonce thread、解释 replace/cancel/dropped 语义，并提供安全动作入口、禁用原因、恢复入口和 pending 老化提示。

## 10. P3/P4 已完成范围与后续 P4+ 方向

### 10.1 P3 History UX hardening 已完成

当前已完成：

- 历史记录可按账户、`chainId`、状态、nonce 和 nonce thread 筛选。
- 详情视图明确展示 Intent、Submission、ChainOutcome 三层信息。
- nonce thread 展示普通提交、replacement、cancellation 之间的关系。
- pending、confirmed、failed、replaced、cancelled、dropped 有明确状态解释和视觉区分。
- pending 记录的 replace/cancel 入口只对当前 nonce thread 的可操作 submission 开启；禁用原因必须可见。
- RPC、history storage、nonce、chain identity、reconcile/dropped 等常见错误会显示分类摘要和恢复提示。

### 10.2 P4 诊断与恢复能力已完成

P4-1 到 P4-7 已完成以下诊断、恢复和回归能力：

- 非敏感结构化诊断事件、诊断面板、筛选和导出。
- 损坏 history storage 的检测、分类、隔离和空历史重建入口。
- 广播成功但历史写入失败后的本地补录入口。
- dropped 记录的人工复核和重新 reconcile。
- pending 老化提示、最近 reconcile 信息和动作建议。
- anvil smoke check 的阶段化失败摘要和 P4 回归路径。

P4 不包含全量账户链上扫描来推导未知历史，也不包含 ERC-20、ABI 调用或批量发送能力。

### 10.3 P4-1 到 P4-7 诊断、恢复与回归已完成

P4-1 到 P4-7 已在当前分支完成，作为后续 P4+ 探索任务的诊断和恢复基线。当前完成范围是原生币转账、历史恢复、诊断导出、dropped 复核、pending 老化和 anvil smoke 回归，不等同于通用链测试平台或复杂合约交互工具。

已完成：

- 为 RPC 探测、交易提交、历史写入、reconcile 等关键路径记录本地诊断事件。
- 诊断事件按错误来源或阶段保留可排查摘要。
- 日志设计遵守敏感信息排除要求，不记录助记词、私钥、seed、明文密码或签名材料。
- 诊断面板和诊断导出 UI。
- 历史文件损坏的交互式恢复。
- 广播成功但历史写入失败后的本地补录入口。
- dropped 人工复核/重新 reconcile。
- pending 老化策略和提示。
- anvil smoke check 的诊断增强与 P4 回归。

### 10.4 后续 P4+ 错误恢复

后续/计划：

- 对 app-config 损坏提供更完整的交互式恢复路径。
- 对需要跨账户或跨链扫描的未知历史恢复先做设计，不在当前 P4-1 到 P4-7 范围内承诺。
- 继续改善 nonce 冲突、replacement underpriced、insufficient funds 等常见错误的用户指导。

### 10.5 后续 P4+ 可观测性

后续/计划：

- 在不引入远程监控服务的前提下，继续优化本地诊断事件的筛选、定位和说明。
- 为关键命令增加更细的本地失败摘要，但仍不得输出敏感材料。

### 10.6 后续 P4+ 能力扩展

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
