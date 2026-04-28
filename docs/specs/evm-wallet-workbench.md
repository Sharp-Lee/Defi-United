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

当前真实可用交易类型仍只有原生币转账。Rust `HistoryRecord.intent` 当前仍以 `NativeTransferIntent` 为主，`SubmissionKind` 当前只覆盖 legacy、nativeTransfer、replacement、cancellation。ERC-20、批量、ABI 调用、raw calldata 等后续能力必须先扩展 Intent/Submission 的类型契约和历史展示契约，不能把不同交易类型塞进 native transfer 字段里伪装成已支持。

### 9.1 Typed transaction intent 后续设计

后续交易能力必须引入显式的 typed transaction intent，而不是继续假设所有交易都是原生币转账。推荐契约是 additive enum/union，例如 `transaction_type` 或 intent enum：

- `legacy`：旧记录或字段不足记录；UI 只能展示已知字段，不能补猜语义。
- `nativeTransfer`：当前真实可用的原生币转账。
- `erc20Transfer`：后续最小 ERC-20 转账能力。
- 后续可再扩展 `contractCall`、`rawCalldata`、`batch` 等类型。

旧记录兼容要求：

- 已存在的 native transfer 历史必须继续可读。缺失 `transaction_type` 的记录按 legacy/nativeTransfer 兼容路径展示，不能因为新 enum 缺失而崩溃。
- `SubmissionKind` 可保留 `legacy`、`nativeTransfer`、`replacement`、`cancellation`，并新增普通 `erc20Transfer`；replacement/cancellation 仍是 nonce 线程动作，不应伪装成新的普通 ERC-20 intent。
- Submission 仍保留通用交易字段：`chainId`、account/from、nonce、tx hash、to、native value wei、gas、fee、broadcast time、draft/frozen key。合约调用类交易以 additive extension 保存 contract/call metadata，避免破坏旧 native records。
- History UI 先看 typed intent 再渲染字段。未知类型必须显示 unknown/unsupported，而不是落回 native transfer 文案。

### 9.2 ERC-20 转账后续设计（尚未实现）

本小节只是 P4-8 后续设计契约，不表示当前应用已经支持 ERC-20 转账。当前真实可用交易类型仍只有 native transfer；ERC-20 最终签名和广播实现必须在后续任务中通过 Rust/Tauri command 完成。

**目标**

- 支持最小 ERC-20 `transfer(address,uint256)` 普通转账：单 token、单 sender、单 recipient、单笔提交。
- 用稳定身份 `chainId + tokenContract` 表示 token。`symbol`、`name`、`decimals` 只属于 metadata，不参与 token 身份判断。
- 在 draft/confirm/submit/history 中清楚区分 token contract 与 recipient。ERC-20 transfer 是合约调用：transaction `to` 是 token contract，recipient 是 calldata 参数。
- 沿用 native transfer 已有的 fee reference/base fee customization、nonce、pending history、reconcile、replace/cancel、diagnostics 和 history write failure recovery 边界。

**非目标**

- 不做 allowance/approve、permit、revoke、swap、bridge、fee-on-transfer 特判或 batch。
- 不做任意 ABI 调用器或 raw calldata 发送；ERC-20 最小实现只构造标准 selector `0xa9059cbb` 的 `transfer(address,uint256)` calldata。
- 不做 token watchlist UI、全账户余额扫描、资产组合展示或授权扫描；这些保留给后续 P4-9/P5 任务。
- 不为浏览器版补主线能力；Tauri desktop 仍是主线。

**安全边界**

- React 只表达用户意图、只读展示 metadata、展示冻结参数和命令返回结果；不得接触助记词、私钥、raw signed transaction 或签名材料。
- ERC-20 calldata 构建、nonce/fee 最终冻结、签名、广播和历史写入必须走 Rust/Tauri command。
- 日志、诊断、历史、导出不得包含助记词、私钥、raw signed tx、完整 RPC token、explorer API key 或签名材料。RPC URL 和错误消息进入诊断前必须脱敏。
- Metadata、receipt log、explorer/indexer 返回数据都不是签名材料，但仍不能把包含认证凭据的端点或完整 secret 写入日志。

**身份键与 metadata/decimals**

- Token 稳定身份是 `chainId + tokenContract`。`tokenContract` 必须是校验后的 EVM 地址，并按统一大小写/校验显示策略保存。
- `symbol`、`name`、`decimals` 是 metadata，可来自链上只读 call、用户 watchlist/cache 或用户确认输入；历史中必须记录 metadata source，例如 `onChainCall`、`watchlistCache`、`userConfirmed`、`unknown`。
- `decimals` 影响用户输入金额到 `amount_raw` 的解析，必须在 draft 中冻结。用户确认页和历史详情必须同时展示 human amount、`amount_raw`、decimals 和 metadata source。
- metadata call failure 不能让系统猜 decimals。最小实现应要求用户选择可恢复路径：重试、从可信 watchlist/cache 使用已知 decimals，或显式输入/确认 decimals；无法确定 decimals 时不得构建可提交 draft。
- 如果 draft 构建后 metadata 重新读取发现 decimals 改变或来源冲突，已冻结 draft 必须失效并要求重建，不能用新 decimals 静默重解释旧 amount。

**Draft / freeze / submit**

- Draft 输入包括：sender account/from、chainId、RPC profile、token contract、recipient、human amount、decimals、amount raw、fee inputs、nonce/gas 估算结果和 metadata source。
- Draft key 必须覆盖 chainId、RPC identity/expected chain、sender、token contract、recipient、amount raw、decimals、fee fields、gas limit、nonce、calldata selector/method name 和 native value wei。
- Freeze 后确认页展示：transaction `to = tokenContract`、method `transfer(address,uint256)`、selector `0xa9059cbb`、recipient calldata 参数、amount raw、decimals、symbol/name metadata source、native value wei 通常为 `0`、gas/fee/nonce、total native gas cost 和 token balance/gas balance 检查结果。
- Submit 时 Rust 必须重新验证 chainId、from、nonce/fee/gas、token contract、recipient、amount raw、decimals/frozen key 是否与 frozen draft 一致；验证失败应拒绝提交，不能局部修正后继续广播。

**History 三层模型**

- Intent：`transaction_type = erc20Transfer`、chainId、sender account/from、token_contract、recipient、human amount、amount_raw、decimals、symbol/name、metadata source、fee 输入/偏好、用户选择的 RPC profile。
- Submission：通用 tx 字段加 ERC-20 call metadata。通用字段包括 tx hash、nonce、gas、fee、transaction `to = token_contract`、native `value_wei = 0`、broadcast time、draft/frozen key。call metadata 包括 token_contract、recipient、amount_raw、decimals、selector `0xa9059cbb`、method name `transfer`、calldata length/summary。历史不得保存 raw signed tx。
- ChainOutcome：pending、confirmed、failed/reverted、replaced、cancelled、dropped 与 native transfer 保持同一状态语义。receipt 成功时可记录非敏感 receipt 摘要和 Transfer log 摘要；log 缺失或非标准不应把 confirmed 改写为 failed，receipt `status = 0` 才表示链上失败/reverted。
- History UI 必须把 token contract、recipient、transaction to 分开展示。列表摘要可以写“ERC-20 transfer to recipient”，但详情必须明确“transaction to token contract”。

**错误与恢复路径**

- `chainId mismatch`：保存 RPC、读取 metadata、估算 gas、submit 前都必须拒绝，并显示 expected/actual chainId；不能把 RPC URL 当作 chain identity。
- `metadata call failure`：允许重试或使用明确来源的 cached/user-confirmed metadata；缺 decimals 时不得提交。
- `decimals missing/changed`：missing 阻止 draft；changed 使 frozen draft 失效并要求重建。
- `token balance insufficient`：按 `balanceOf(sender)` 与 frozen `amount_raw` 比较，阻止或在确认页高亮不可提交；余额检查失败不能被 symbol/name 替代。
- `native gas insufficient`：ERC-20 gas 仍由 sender 支付 native coin；必须独立检查 native balance 是否覆盖 gas/fee 上限。
- `estimate gas failure`：给出合约调用/余额/recipient/paused token/RPC 等分类摘要；允许用户重试或在后续高级任务中手动 gas override，但最小实现可先拒绝提交。
- `receipt reverted/failed`：receipt `status = 0` 进入 failed，记录非敏感 revert/receipt 摘要；不得重试签名或广播。
- `history write failed after broadcast`：必须返回 tx hash、chainId、account/from、nonce、token contract、recipient、amount_raw、decimals、selector/method、frozen draft key 和写入错误；恢复入口只能用 tx hash + frozen params 补录，不能重新签名或广播。
- `replacement/cancel relationship`：ERC-20 pending 沿用 same account + chainId + nonce 的 nonce thread 语义。cancel 仍是同 nonce、向自身发送 0 native value 的 self-transfer，目的只是取代 pending；它不是 ERC-20 transfer。最小 replace 实现应收窄为保持同 token contract、recipient、amount_raw、decimals 和 calldata，仅提高费用；是否允许修改 recipient/amount 留给后续任务重新设计。

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

- ERC-20 转账：先完成 spec/design，明确 token contract、decimals、recipient、amount、allowance 无关边界、gas/fee、nonce、history 三层模型和失败路径；实现时最终签名/广播仍必须走 Rust/Tauri command，React 只表达意图和展示冻结参数。
- Token watchlist 与 ERC-20 余额扫描：支持用户维护 token watchlist，并按 `account + chainId + token contract` 读取余额；token metadata、decimals、symbol 只能作为可验证或可回退的展示信息，不能作为合约身份。
- 多账户选择与账户编排：为后续批量能力提供本地账户选择器、外部地址输入、账户集合预览、余额/nonce 可用性检查和操作前冻结摘要。
- 批量分发：除分发给外部账户外，必须支持选择本地账户作为接收方，把一个或多个本地账户的 native 或 ERC-20 资产分发给其他本地账户；每笔子交易必须有独立 Intent/Submission/ChainOutcome，可按 batch id 聚合展示，但不能丢失单笔 nonce、hash 和失败原因。
- 批量归集：必须支持 native + ERC-20 归集，场景为部分或全部本地账户批量归集到一个指定目标账户；目标账户既可以从本地账户中选择，也可以填写外部账户。native 归集必须预留 gas，ERC-20 归集必须处理 token decimals、余额不足、gas 由源账户支付和部分成功状态。
- ABI 管理与调用器：ABI 可以按合约地址获取，也可以由用户导入文件或粘贴 ABI JSON。仅靠普通 RPC 通常拿不到合约 ABI；按合约地址获取 ABI 需要 explorer/indexer API 或类似数据源，并需要 chain-specific 配置、失败处理、缓存策略和敏感配置脱敏。ABI 调用器必须区分 read-only call 与 write transaction，write transaction 仍由 Rust/Tauri command 签名广播。
- Raw calldata 发送：提供面向高级用户的 calldata 预览和发送路径，必须展示 chainId、from、to、value、calldata 摘要/长度、selector、gas/fee、nonce 和高风险确认；不得在日志、历史或诊断中记录完整敏感认证凭据或签名材料。
- 资产/授权扫描：先做只读扫描设计，覆盖 token/NFT/allowance 等资产与授权视图；revoke 属于交易工作流，必须走同样的 Intent/Submission/ChainOutcome、Rust 签名广播和安全确认。
- Hot 交易逆向解析：入口至少支持交易 hash 和合约地址。tx hash 入口依赖 RPC/explorer 能取回交易、receipt、logs 和相关合约 metadata，用于解析已发生交易的 to、value、input selector、事件和 outcome；contract address 入口依赖 explorer/indexer、ABI/selector 数据库或采样交易数据，用于分析热门 selector、交互模式和风险提示。两者都存在数据源缺失、代理合约、未验证合约、selector 冲突和链特异性边界，不能把推断结果展示为确定事实。

以上能力尚未作为当前 v1 可用能力承诺。

## 11. 验收原则

- 不破坏 RPC chainId 匹配、`account + chain` 状态隔离、pending 历史恢复和敏感信息隔离。
- 不把浏览器版本重新设为主线。
- 新功能必须明确属于当前已实现、后续/计划或非目标，不能在文档和 UI 中混淆。
- 涉及交易提交、replace/cancel、reconcile 的改动必须覆盖关键状态迁移和错误路径。
