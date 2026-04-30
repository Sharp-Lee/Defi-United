# EVM Wallet Workbench 项目级 Spec

## 1. 产品定位

EVM Wallet Workbench 是一个面向本地桌面使用的 EVM 钱包工作台。当前主线形态是 Tauri desktop app，前端使用 React/TypeScript 表达工作流和界面状态，Tauri/Rust 负责 vault、账户派生、交易签名、广播和本地持久化。

浏览器版本不再作为后续主线。后续产品、技术债治理、安全边界、测试和发布都以 Tauri desktop 形态为准；浏览器版本只作为历史参考或迁移来源，不承诺继续补齐功能。

## 2. 产品目标

- 提供一个长期自用、可审计、可恢复的 EVM 多账户工作台。
- 用单助记词 vault 管理多个派生账户，并在多条 EVM 链上查看账户状态。
- 支持专业模式原生币转账、ERC-20 转账、native/ERC-20 批量工作流和 managed ABI read/write 调用，提交前明确展示最终链、账户、nonce、gas、费用参数和交易类型摘要。
- 将交易历史持久化到本地，并追踪 pending 交易后续状态。
- 在桌面侧隔离敏感能力，避免助记词和私钥进入 React UI 或浏览器运行环境。

## 3. 非目标

- 不作为通用消费级移动钱包。
- 不追求浏览器插件钱包或网页钱包形态。
- v1 不支持多助记词 vault、私钥导入、硬件钱包、只读地址。
- 当前 v1 runtime 已提供受控 raw calldata sender/preview，但不作为通用链测试平台或安全解析器；资产/授权扫描、revoke、tx hash 逆向解析和 hot contract 分析仍是后续计划。
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
6. 构建 ERC-20 转账、native/ERC-20 批量或 managed ABI write draft，确认冻结参数后由 Rust 签名并广播。
7. 使用 ABI library/cache 执行 managed ABI read-only call，或为 managed ABI write 预览 selector、calldata 摘要和参数摘要。
8. 广播后写入本地 pending 历史，并在后续 reconcile 中更新状态。
9. 对 pending 交易执行 replace 或 cancel。
10. 运行 anvil smoke check 验证本地转账闭环。

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
- P4-8c ERC-20 transfer submission：标准 `transfer(address,uint256)` 最小发送闭环，保留 token contract 与 recipient 的历史展示区分。
- P4-9 token watchlist 与 ERC-20 余额扫描：按 `account + chainId + token contract` 维护 watchlist、metadata 和 balance snapshot。
- P4-10 多账户选择器与账户编排基础。
- P4-12 native batch 和 P4-13 ERC-20 batch：按固定 Disperse/EOA collection 模型开放受控批量分发/归集。
- P5-1 ABI 管理：按合约地址 fetch/import/paste ABI、缓存、validation、selector summary 和失败状态。
- P5-2 ABI read/write caller：基于已管理 ABI entry 执行 read-only call 和 managed ABI write transaction caller。
- P5-3 raw calldata sender/preview：面向高级用户提供 bounded preview、selector inference warnings、确认页和 Rust/Tauri submit path。

当前已可用交易/调用能力包括 native transfer、ERC-20 transfer、native batch、ERC-20 batch、managed ABI read-only call、managed ABI write caller 和 raw calldata sender/preview。
资产/授权扫描、revoke、tx hash 逆向解析、hot contract 分析和复杂资产组合展示仍属于后续/计划能力，不能列入当前能力。

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

v1 + P3/P4/P5 已将基础历史列表升级为可筛选、可分组、可审计的历史视图。当前 UI 能展示 Intent / Submission / ChainOutcome 三层、按 `account + chainId + nonce` 聚合 nonce thread、解释 replace/cancel/dropped 语义，并提供安全动作入口、禁用原因、恢复入口和 pending 老化提示。

当前真实可用交易/调用类型包括 native transfer、ERC-20 transfer、native batch、ERC-20 batch、managed ABI read/write caller 和 raw calldata sender/preview。
资产/授权扫描、revoke、tx hash 逆向解析和 hot contract 分析仍未完成。新增能力必须继续使用显式 typed Intent/Submission 契约，不能把不同交易类型塞进 native transfer 字段里伪装成已支持。

### 9.1 Typed transaction intent 后续设计

后续交易能力必须引入显式的 typed transaction intent，而不是继续假设所有交易都是原生币转账。推荐契约是 additive enum/union，例如 `transaction_type` 或 intent enum：

- `legacy`：旧记录或字段不足记录；UI 只能展示已知字段，不能补猜语义。
- `nativeTransfer`：当前真实可用的原生币转账。
- `erc20Transfer`：当前真实可用的最小 ERC-20 转账能力。
- `batch`：当前真实可用的 native/ERC-20 batch intent/submission 聚合能力。
- `contractCall`：当前真实可用的 managed ABI write caller intent/submission 能力。
- `rawCalldata`：当前真实可用的 raw calldata sender/preview intent/submission 能力。
- 后续可再扩展 `assetScan`、`revoke`、`txHashAnalysis` 等类型。

旧记录兼容要求：

- 已存在的 native transfer 历史必须继续可读。缺失 `transaction_type` 的记录按 legacy/nativeTransfer 兼容路径展示，不能因为新 enum 缺失而崩溃。
- `SubmissionKind` 可保留 `legacy`、`nativeTransfer`、`replacement`、`cancellation`，并通过 additive 类型表达普通 `erc20Transfer`、`batch` 和 `contractCall`；replacement/cancellation 仍是 nonce 线程动作，不应伪装成新的普通 ERC-20、batch 或 ABI call intent。
- Submission 仍保留通用交易字段：`chainId`、account/from、nonce、tx hash、to、native value wei、gas、fee、broadcast time、draft/frozen key。合约调用类交易以 additive extension 保存 contract/call metadata，避免破坏旧 native records。
- History UI 先看 typed intent 再渲染字段。未知类型必须显示 unknown/unsupported，而不是落回 native transfer 文案。

### 9.2 ERC-20 转账（P4-8c 已完成，保留设计约束）

本小节保留 P4-8/P4-8c 的设计契约。ERC-20 最小转账已在 Tauri desktop 主线可用；最终签名和广播仍必须通过 Rust/Tauri command 完成，React 只表达意图和展示冻结参数。

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
- `symbol`、`name`、`decimals` 是 metadata，可来自链上只读 call、P4-9 resolved metadata view 或用户确认输入；历史中必须记录 metadata source，例如 `onChainCall`、`cachedOnChain`、`userConfirmed`、`unknown`。
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

### 9.3 Token watchlist 与 ERC-20 余额扫描（P4-9 设计）

本小节定义 P4-9 的本地 token watchlist、metadata cache 和 ERC-20 balance snapshot。它复用 P4-8 的 `chainId + tokenContract` 身份、metadata source 和 ERC-20 read model，但不扩展发送能力本身。P4-9 的目标是让用户维护少量关心的 ERC-20，并按本地账户读取余额，为 ERC-20 transfer 的 token selector、后续多账户编排、批量分发/归集提供可靠输入。

**目标**

- 用户可维护本地 token watchlist。Token identity 固定为 `chainId + tokenContract`，`tokenContract` 必须是校验后的 EVM 地址；`symbol`、`name`、`decimals` 不是身份。
- 按 `account + chainId + tokenContract` 读取和保存 ERC-20 balance snapshot，供账户资产视图、token selector 和后续 batch 预检查使用。
- metadata 失败、非 ERC-20、RPC 失败、`decimals` 缺失或变化都必须进入可见、可恢复状态；失败不能静默隐藏，也不能污染用户已确认的 metadata。
- 只做只读扫描和本地状态更新；不签名、不广播、不写交易历史。

**非目标与边界**

- 不做 allowance/approve/revoke、permit、NFT、LP/portfolio 估值、价格、外部 indexer 发现未知资产或全链资产组合展示。
- 不做任意 ABI 调用器或 raw calldata；P4-9 只调用 ERC-20 标准只读方法 `decimals()`、`symbol()`、`name()`、`balanceOf(address)`，并允许方法缺失或返回 malformed。
- 不把 browser version 作为主线；Tauri desktop 是实现目标。
- 不要求用户必须通过 watchlist 才能发送 ERC-20。P4-8c 的手输 token contract 最小发送路径仍可独立存在，watchlist 只是更好的 token 来源。

**本地存储模型**

配置与扫描状态必须分离，避免一次 RPC 失败覆盖用户配置或已确认 metadata。

- `watchlist_tokens` 是用户本地配置，identity 为 `chain_id + token_contract`。建议字段：`chain_id`、`token_contract`、`label` 可选、`user_notes` 可选、`pinned`/`hidden` 可选、`created_at`、`updated_at`、`metadata_override` 可选。
- `metadata_override` 只保存用户显式确认或编辑的本地展示信息，例如 `symbol`、`name`、`decimals`、`source = userConfirmed`、`confirmed_at`。用户确认 `decimals` 必须带来源标记和时间；不能把系统猜测写成 user confirmed。
- `token_metadata_cache` 只保存链上只读 call 的 raw cache，identity 同为 `chain_id + token_contract`。它不得保存 user-confirmed override 或 watchlist local label。建议字段：`raw_symbol`、`raw_name`、`raw_decimals`、`source = onChainCall`、`status = ok | missingDecimals | malformed | callFailed | nonErc20 | decimalsChanged`、`last_checked_at`、`last_error_summary`、`observed_decimals`/`previous_decimals` 可选。
- `token_scan_state` 是 token 维度最近一次扫描状态，identity 为 `chain_id + token_contract`。建议字段：`status = idle | scanning | ok | partial | failed | chainMismatch | nonErc20 | malformed`、`last_started_at`、`last_finished_at`、`last_error_summary`、`rpc_profile_id` 或脱敏 RPC identity。
- `erc20_balance_snapshots` 是账户余额快照，identity 为 `account + chain_id + token_contract`。建议字段：`account`、`chain_id`、`token_contract`、`balance_raw`、`balance_status = ok | zero | balanceCallFailed | malformedBalance | rpcFailed | chainMismatch | stale`、`metadata_status_ref`、`last_scanned_at`、`last_error_summary`、`rpc_profile_id` 或脱敏 RPC identity。它可以冗余保存扫描时用于展示的 `resolved_symbol`、`resolved_name`、`resolved_decimals`、`resolved_metadata_source`，但不能把 metadata conflict 当成 balance status。
- `resolved_token_metadata` 是 UI/read model 的计算视图，不是 raw 链上 cache。它从 `watchlist_tokens.metadata_override` 和 `token_metadata_cache` 合成 effective metadata，建议字段：`effective_symbol`、`effective_name`、`effective_decimals`、`effective_source = onChainCall | cachedOnChain | userConfirmed | unknown`、`metadata_status = ok | missingDecimals | malformed | callFailed | nonErc20 | decimalsChanged | sourceConflict`、`conflict_summary`、`resolved_at`。若实现选择持久化该视图，也必须把它标记为 derived/read model，不能反写 raw cache 或用户 override。

`watchlist_tokens` 是用户意图，不能因为扫描失败被删除或降级。`token_metadata_cache` 是可丢弃、可重建的链上 raw cache；`resolved_token_metadata` 和 `erc20_balance_snapshots` 是可重建 read model。`balance_raw` 必须按链上原始整数保存；human amount 只能在展示层结合当次明确来源的 resolved `decimals` 格式化。

**Metadata 来源与 decimals 规则**

- metadata 优先级用于展示和 draft 辅助：最新成功 on-chain call 优先，其次用户确认 override，其次旧 cached-on-chain，最后 unknown。具体 UI 可以允许用户选择信任用户确认值，但必须展示来源；这个选择写入 `metadata_override`，不写入 `token_metadata_cache`。
- `decimals` 不可猜。`decimals()` 调用失败、返回非整数、超出合理范围或 malformed 时，metadata 状态为 `missingDecimals`/`malformed`，余额仍可保存 `balance_raw`，但 human amount 和 ERC-20 draft 需要用户重试或确认 decimals。
- 已有 user-confirmed decimals 遇到链上读取失败时，不能被失败清空；遇到链上成功但与用户确认值不同，resolved metadata 应标记 `sourceConflict`，链上 raw cache 可同时记录 `observed_decimals`。若新链上 decimals 与历史链上成功值不同，raw cache 标记 `decimalsChanged`。两种情况都必须展示 previous/current/source，不得静默改写已确认值，也不得用新 decimals 重解释旧 draft。
- `symbol`/`name` 失败不应阻止 `balanceOf` 读取；展示可退化为缩短合约地址。`symbol`/`name` 可能重复、伪造或变化，不能参与 token identity、去重或安全判断。
- 若合约非 ERC-20 或只实现部分方法，记录具体失败面：metadata `callFailed`/`missingDecimals`/`malformed`、balance `balanceCallFailed`/`malformedBalance`、`nonErc20` suspected。不要把 `symbol/name` 成功等同于 token 可转账。

**扫描流程与错误恢复**

- 每次扫描前必须对 RPC 做 `chainId` validation：expected `chainId` 来自 watchlist token；actual 不一致时拒绝扫描并写 `chainMismatch`，显示 expected/actual，不能把 RPC URL 当作 chain identity。
- Add token 时可先保存 watchlist 配置，再触发 metadata scan；metadata 失败不阻止用户保留 token，但 UI 必须显示失败和重试入口。
- Balance scan 输入是本地 account 集合、目标 `chainId`、watchlist token 集合和 RPC profile。每个 `account + chainId + tokenContract` 独立成功/失败，不能让一个账户或 token 的失败覆盖其他 snapshot。
- `nonErc20`：`decimals`/`balanceOf` 返回 revert、empty data、ABI decode error 或明显 malformed 时进入可恢复状态；用户可移除 token、编辑备注、重试或保留为失败项。
- `metadata call failure`：raw cache 记录 `callFailed` 和脱敏错误摘要，允许重试、使用已有 cached-on-chain 或 userConfirmed metadata 生成 resolved view；缺 decimals 时禁止构建可提交 ERC-20 draft。
- `balanceOf failure`：保留上一次成功 `balance_raw`，`balance_status` 标记为 `stale` 或 `balanceCallFailed` 并展示 last scanned/error；不能把失败显示成 0。
- `RPC failure` 或超时：扫描状态为 `failed`/`partial`，balance snapshot 标记 `rpcFailed` 或保留旧 snapshot 为 `stale`，并保留 error summary；用户可手动 retry，也可换 RPC profile 重新扫描。

**UI/UX 要求**

- Watchlist 管理支持 add/edit/remove。Add 至少输入 `chainId`、token contract 和 RPC profile；编辑只改本地 label/notes/metadata override，不能改变 identity，改 identity 等价于删除旧 token 再新增。
- Remove token 应说明只移除本地 watchlist 配置；可选择同时清理本地 cache/snapshots，但不得影响历史交易记录。
- 提供 manual scan/retry：按当前账户、选中 token、整条 watchlist 或某个失败项重试。扫描中、成功、失败、partial、stale 状态都必须可见。
- Account balances 视图按账户展示 watchlist token 的 `balance_raw`、human amount（仅当 resolved decimals 明确且 metadata status 非 conflict）、symbol/name/source、last scanned、`balance_status` 和错误摘要。失败状态不能因为余额未知而隐藏整行。
- ERC-20 transfer token selector 可从 watchlist/balance snapshot 选择 token，并把 `chainId`、token contract、resolved metadata source/status、decimals、当前账户余额带入 draft。若 metadata status 是 `missingDecimals | decimalsChanged | sourceConflict`，selector 可以选择 token，但进入 draft 时必须要求重试或用户确认，不能构建可提交 draft。
- 多账户/batch 后续会依赖这些 snapshots 做候选账户和余额预览；P4-9 只提供只读数据，不提供 batch plan、部分成功语义或交易聚合。

**安全与隐私**

- Watchlist 和 balance snapshot 不保存助记词、私钥、raw signed tx、签名材料、完整 RPC URL token、basic auth、query secret 或 explorer API key。
- `rpc_profile_id`、RPC identity 和错误摘要进入本地状态、日志或诊断前必须脱敏；RPC URL 只可保存已有配置引用或脱敏摘要。
- 扫描流程只做 JSON-RPC read call，不签名、不发送交易、不解锁私钥，不创建 pending history。
- 合约 metadata、receipt/log、RPC 返回值都是不可信输入。UI 不得把 token symbol/name 当作安全背书。

**后续边界**

- P4-10 多账户选择器可以消费 `erc20_balance_snapshots`，但账户集合选择、冻结摘要和外部地址管理不属于 P4-9。
- P4-11/P4-13 batch 分发/归集可以消费 watchlist token 和 account balance snapshots；每笔实际 transfer 仍必须走 P4-8 的 ERC-20 submit/history 模型。
- P5 资产/授权扫描可以在 P4-9 基础上扩展 token/NFT/allowance/indexer，但 P4-9 不引入外部 indexer 作为必需项，也不实现 revoke。

### 9.4 多账户选择与账户编排基础（P4-10 设计）

本小节定义 P4-10 的账户集合选择、预检查和冻结摘要基础。P4-10 的目标是为后续批量分发/归集准备可复用的本地账户选择器、外部地址输入、账户集合预览、余额/nonce 可用性检查和操作前冻结摘要。它只表达用户显式选择和当前只读快照状态，不创建可提交交易计划。

**数据结构**

- `LocalAccountReference`：`kind = localAccount`，包含 `accountIndex`、`address`、`label` 和按所选 `chainId` 计算的 `chainSnapshotStatus`。`chainSnapshotStatus` 至少包含 native balance 是否 present/missing、nonce 是否 present/missing、最近同步错误摘要。它不得包含助记词、私钥、seed、raw signed transaction 或任何签名材料。
- `ExternalAddressReference`：`kind = externalAddress`，包含校验并规范化后的 EVM `address`，以及可选 `label`、`notes`。外部地址必须始终以 `externalAddress` 类型存在，不得因为地址碰巧匹配某个本地账户而被静默转换为本地账户，也不得和本地账户目标混在同一未标记数组里。
- `AccountOrchestrationPreview`：按本地账户生成，只读展示 native balance present/missing、nonce present/missing、最近同步错误，以及 ERC-20 balance snapshot 计数。ERC-20 snapshot 计数至少区分 `ok`、`zero`、`stale`、`failure`、`missing`；缺失快照不得显示为 0 余额。
- `OrchestrationDraft`：包含 `selectedChainId`、用户显式选择的 source `LocalAccountReference[]`、用户显式选择的 local target `LocalAccountReference[]`、external target `ExternalAddressReference[]`、source account preview、`createdAt`。不得自动推断或默认选择所有本地账户。
- `FrozenOrchestrationSummary`：在 draft 基础上增加 `frozenAt` 和 deterministic `frozenKey`。`frozenKey` 覆盖 `chainId`、source/local/external target 地址、本地账户索引与标签、native/nonce availability、ERC-20 snapshot status counts 和同步错误摘要；不覆盖易变 UI 状态或时间戳。summary 和 key 都不得包含签名材料、raw signed tx、RPC secret、助记词、私钥或 seed。

**行为边界**

- P4-10 不发交易、不签名、不广播、不写 transaction history、不生成 batch plan，也不估算每笔交易费用。
- Source accounts 必须由用户显式多选；没有选择时 preview 显示空集合，不能自动把全部本地账户当作 source。
- Local targets 与 external targets 使用不同类型和不同 UI 控件。后续 batch 能力消费时必须继续保留目标来源类型，不能只拿裸地址数组。
- External address 输入必须使用 EVM address 校验和规范化；无效地址保持错误可见，重复 external 地址必须拒绝或去重。P4-10 不把 external address book 保存到磁盘。
- 冻结摘要是操作前只读快照。用户改变 `chainId`、source selection、local target selection 或 external target list 后，旧 summary 必须清空或明确失效，避免被误认为仍可使用。
- ERC-20 可用性只消费 P4-9 watchlist/balance snapshot read model。metadata、symbol、name 不能参与账户或 token 身份判断；缺失/失败/stale 状态必须可见，不能静默隐藏。

### 9.5 批量分发/归集模型（P4-11/P4-12/P4-13）

本小节定义 batch 分发/归集契约。P4-12 已开放 native batch 的最小路径；P4-13 已开放 ERC-20 batch 的最小路径。所有真实提交仍必须走 Rust/Tauri command，React 只表达意图、展示冻结参数和提交结果。

**目标**

- 定义 `distribute` 与 `collect` 两类 batch 的身份、冻结、子交易、历史聚合和失败恢复模型。
- 批量分发除外部地址外，必须支持选择本地账户作为接收方；source 必须是用户显式选择的本地账户。
- 批量归集必须支持 native 与 ERC-20，从部分或全部本地账户归集到一个指定目标账户；目标可以是本地账户，也可以是外部地址。
- Distribution 与 collection 的链上形态不同：distribution 必须通过固定/默认 Disperse 合约提交 parent transaction；collection 仍可由每个 source 发起普通 EOA sweep/transfer。Batch 只提供聚合摘要，不能隐藏 parent 或 child 的真实链上身份。

**非目标与边界**

- Native distribution 的 parent contract call 是一笔链上交易，receipt 层面原子成功或失败；recipient child rows 只是收款分配行，共享 parent nonce、tx hash、fee 和 outcome。Collection 的 per-source child transfer 仍允许部分成功、失败、pending、dropped 或 skipped。
- 不引入任意 multicall、relay 或用户可配置 batch contract。Distribution 使用固定/默认合约地址 `0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3`，native method 为 `disperseEther(address[],uint256[])`，selector `0xe63d38ed`；ERC-20 method 为 `disperseToken(address,address[],uint256[])`，selector `0xc73a2d60`。
- 不做 allowance/approve/permit/revoke、swap、bridge、资产发现、授权扫描或 fee-on-transfer token 的特殊保证。
- 不绕过 P4-8/P4-9/P4-10：ERC-20 child 必须沿用 P4-8 的 ERC-20 transfer/history 模型，token 与余额输入来自 P4-9 的 watchlist/snapshot，账户集合与冻结摘要来自 P4-10。

**Batch identity 与数据模型**

- `BatchPlan` 至少包含 `batchId`、`batchKind = distribute | collect`、`assetKind = native | erc20`、`chainId`、`createdAt`、可选 `frozenAt`、source account refs、target refs、per-item children、可选 parent contract transaction 和 batch-level summary。
- `batchId` 是本地历史聚合身份，不是链上身份。它不得依赖 RPC URL，也不得被用作 child nonce 或 tx hash 的替代。
- Source account refs 必须是 `LocalAccountReference[]`。Target refs 必须保留 `localAccount` 与 `externalAddress` 类型，不能只保存裸地址数组。
- ERC-20 batch 必须包含 token identity：`chainId + tokenContract`，以及冻结时使用的 `decimals`、metadata source 和 snapshot references。ERC-20 transfer 的 transaction `to` 仍是 `tokenContract`，recipient 是 calldata 参数。
- Distribution parent 必须包含 contract address、method、selector、source payer、recipients、values、total value wei、parent nonce、gas/fee、submission、tx hash、broadcast/write error、recovery hint 和 ChainOutcome。Recipient children 必须包含独立 child id、target ref、amount/value 和 visible status，但不得声称拥有独立 nonce 或独立链上 tx hash。
- Collection children 必须有独立 child id、source local account、target ref、amount rule 或 amount raw、intent snapshot、submission snapshot、chain outcome、nonce、tx hash、broadcast/write error、recovery hint 和 status。
- Batch summary 从 parent 与 children 聚合得出，例如 recipient/child counts、total planned amount、submitted count、confirmed count、failed count、skipped count、pending count 和 aggregate warnings。历史按 `batchId` 聚合展示时，绝不能隐藏 distribution parent 的 nonce/hash/outcome，也不能隐藏 collection child 的 nonce/hash/状态/失败原因。

**分发场景**

- Native distribution 支持 single local source -> many targets，通过一笔调用固定 Disperse 合约 `disperseEther(address[],uint256[])` 完成；transaction `to` 是合约地址，native `value` 是 `values` 总和，recipient child rows 共享 parent nonce、tx hash、fee 和 outcome。
- Native 与 ERC-20 distribution 当前都不支持 many-source -> many-target 的单 batch parent call。多个 source 分发必须拆成多个 single-source batch，或等待后续设计；UI 与 command 必须显式 gate 多 source distribution。
- ERC-20 distribution P4-13 使用固定 Disperse parent contract call：transaction `to = 0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3`，native `value = 0`，calldata 为 `disperseToken(tokenContract, recipients[], amountRaw[])`。Recipient rows 是 allocation rows，共享 parent nonce/hash/outcome，不是独立 ERC-20 transfers。
- ERC-20 distribution 必须冻结 token contract、decimals、metadata source/status、source token balance snapshot、native gas availability、recipient/order/value arrays、distribution contract、selector/method、allowance/preflight state、gas/fee 和 P4-10 frozen key。Rust preflight 在广播前校验 RPC chainId、signer、source token balance、allowance(owner, Disperse) 和 native gas；allowance 不足时不得广播。
- 分发计划必须拒绝或显式处理 source 与 target 相同的 recipient、重复 target、零金额、总额/余额不足、parent nonce 不可用、snapshot missing/stale/failure 等情况；具体策略可以是 blocked 或 skipped，但必须进入 parent 或 recipient row 的可见状态。

**归集 / sweep 场景**

- Native collection 从用户选择的部分或全部本地账户归集到一个目标。目标可以是本地账户，也可以是外部地址。
- Native collection 每个 source 都必须预留 native gas；不能承诺“扫空全余额”而不扣除 gas reserve。冻结时必须展示 per-source 可归集金额、gas 上限、max fee 上限和剩余 reserve。
- ERC-20 collection 从用户选择的部分或全部本地账户归集指定 token 到一个目标。每个 source 发送标准 ERC-20 `transfer(address,uint256)`，transaction `to = tokenContract`，recipient 是 calldata 参数，native gas 由该 source 支付。
- ERC-20 collection 必须依赖 P4-9 的 token balance snapshot 和 native gas availability。`ok` 正余额生成可提交 child；`zero` 生成可见 skipped child；`missing`、`stale`、`balanceCallFailed`、`malformedBalance`、`rpcFailed`、`chainMismatch` 等生成可见 blocked child。缺失 snapshot 不能当作 0 余额。
- Collection 的目标账户即使是本地账户，也只是 recipient；它不替 source 支付 gas，不改变 source nonce。

**Preflight / freeze / safety**

- Batch preflight 通用部分必须消费 P4-10 `FrozenOrchestrationSummary`，并在 submit 前重新验证 RPC `chainId`、source/target identity、native account snapshot refs/availability、nonce availability、pending local history conflicts、gas/fee references 和 P4-10 frozen key。
- 当 `assetKind = erc20` 时，preflight 还必须消费 P4-9 token/balance snapshots，并额外验证 token contract、decimals、metadata source/status、token balance snapshot freshness 和每个 source 的 native gas availability。
- Native distribution freeze key 至少覆盖 `chainId`、`batchKind`、`assetKind`、source ref、target refs、distribution contract address、selector、method、recipients/values/order、total value wei、parent nonce、parent gas/fee inputs、native account snapshot refs/availability、P4-10 frozen key、recipient count 和 ordering。
- Native collection freeze key 至少覆盖 `chainId`、`batchKind`、`assetKind`、source refs、target ref、per-source amount rules/raw wei、per-source nonce plan、gas/fee inputs、native account snapshot refs/availability、P4-10 frozen key、child count 和 child ordering。
- 当 `assetKind = erc20` 时，freeze key 还必须覆盖 token contract、decimals、metadata source、token amount rules 或 amount raw、ERC-20 snapshot references、source token balance snapshot status、allowance/preflight result 和 native gas availability snapshot references。
- 用户改变 chain、RPC identity、source/target selection、amount、fee/gas、distribution contract、selector、recipient order/value、nonce plan、native account snapshot reference/availability 或 child count/order 后，旧 freeze 必须失效并要求重建；ERC-20 batch 还必须在 token、decimals、metadata source、allowance/preflight 或 ERC-20 snapshot reference 改变时失效。
- 高风险确认至少覆盖 child 数量多、总 gas 上限高、native account snapshot stale、外部目标、归集接近全余额、存在 skipped/blocked child 等情况；ERC-20 batch 还必须覆盖 token snapshot stale 和 metadata 非 on-chain fresh。

**失败、部分成功与恢复**

- Collection partial success 是预期状态。Collection child status 至少要能表达 `notSubmitted`、`skipped`、`pending`、`confirmed`、`failed`、`replaced`、`cancelled`、`dropped`；batch-level status 从 children 派生，例如 `allConfirmed`、`partial`、`failed`、`pending`、`cancelled`。
- Native distribution 是 parent transaction 粒度的 pending/confirmed/reverted/dropped。Recipient rows 共享 parent outcome；不能把同一 parent receipt 拆写成多个独立链上成功/失败。
- 广播成功但历史写入失败时，distribution 必须返回 parent tx hash、chainId、source、parent nonce、contract address、selector、total value、fee/gas、frozen params 和写入错误；collection 必须按 child 返回 tx hash、chainId、source、nonce、目标、amount、fee/gas、frozen params 和写入错误。恢复入口只能基于已知 tx hash 与 frozen params 补录，不能重新签名或重新广播。
- 广播失败、签名前失败、preflight 失败和用户取消必须落到对应 parent、child 或 batch recovery intent。未知广播状态不得被静默重试。
- Retry 必须创建新的 parent/child attempt，或只作用于 `skipped`、`failed`、`notSubmitted` 且状态明确的 row；不得对 unknown tx hash 或状态不明的 row 做隐式 rebroadcast。

**History 与 UI 展示契约**

- History 可以提供 batch list/detail：list 展示 batch summary，detail 展示 distribution parent + recipient rows 或 collection child rows。Distribution parent 必须能进入普通历史详情，继续展示 Intent / Submission / ChainOutcome 三层。
- Batch status 是派生摘要，不能替代 parent/child status。用户必须能看到 distribution parent 的 source、contract address、selector、method、total value、nonce、tx hash、gas/fee、当前状态和失败原因；recipient rows 展示 target 类型、本地/外部标记和 amount，并明确共享 parent tx。Collection child rows 展示 source、target、amount、nonce、tx hash、gas/fee、当前状态和失败原因。
- 本地目标与外部目标必须视觉和文本上区分。外部地址不得因地址匹配本地账户而被静默改写为本地目标。
- ERC-20 batch history 必须清楚展示 transaction `to = tokenContract`，recipient 是 calldata 参数；列表摘要可以写分发/归集到 recipient，但详情必须保留 token contract 与 recipient 的差异。

**安全与隐私**

- React、docs、history、diagnostics 和日志不得包含助记词、私钥、seed、raw signed tx、签名材料、完整 RPC secret 或 external API key。
- Diagnostic/logs 中的 RPC URL、explorer URL、错误消息和外部 API 配置必须脱敏；batch 失败摘要只记录排障所需的非敏感元数据。
- Batch 不应默认自动全选账户。全选本地账户只能来自用户显式动作，且确认页必须展示账户数量、child 数量、外部目标数量和最大 gas 暴露。

**验收与实现拆分**

- P4-12 native minimal implementation 应实现 single-source native distribution 的 fixed Disperse contract parent call，以及 native collection 的 per-source EOA sweep/transfer；多 source distribution 必须在 UI/command 层显式 gate。
- P4-13 ERC-20 implementation 已复用同一 distribution contract 模型，补充 token contract、decimals、metadata source/status、balance snapshot、native gas availability、allowance/preflight 和 batch history 展示。
- P4-13 非目标：不实现 approve、permit、revoke、自动授权交易或 allowance 修改；不保证 fee-on-transfer/rebasing token 的分配结果；不支持 many-source distribution；不支持 `disperseTokenSimple`、用户自定义 batch contract、raw calldata、任意 ABI、swap/bridge/relay。
- P4-11 作为 doc-only 任务的验证命令为 `git diff --check`。

### 9.6 ABI 管理 fetch/import/paste/cache（P5-1 设计）

本小节定义 P5-1 的 ABI 来源、验证、缓存和失败状态契约。P5-1 只输出 ABI source/cache/read model，本身不实现 ABI read/write 调用器、raw calldata、revoke、hot 交易解析、代理自动解析完整方案或任意交易广播。P5-2 与 P5-3 已消费这里的 ABI read model 和 selector summary；P6 后续也可以消费这些 read model，但不得把调用器、raw calldata 或 hot parsing 归入 P5-1 范围。

**目标**

- 支持按合约地址 fetch ABI、导入 ABI 文件、粘贴 ABI JSON，并把通过验证的 ABI 写入本地缓存。
- 明确普通 JSON-RPC 通常拿不到合约 ABI；按地址 fetch 必须通过 chain-specific explorer、indexer 或类似数据源配置完成。
- 让 ABI 的来源、fingerprint/hash、函数/事件/error 数量、selector 摘要、缓存时间、刷新状态和失败原因都可见。
- 为后续 ABI 调用器、selector 解析和交易解析提供可审计的 ABI read model，但不在 P5-1 中创建签名、广播或任意 calldata 发送路径。

**数据源配置模型**

- `AbiDataSourceConfig` 至少包含：`chain_id`、`provider_kind`、`base_url`、可选 `api_key_ref` 或 secret label、rate-limit metadata、failure metadata、`created_at`、`updated_at`、`enabled`。
- 字段命名示例中 snake_case 表示 Rust/storage schema；TS/read model/UI 可以使用 camelCase，但语义必须一一对应。
- `provider_kind` 可以是 `etherscanCompatible`、`blockscoutCompatible`、`customIndexer`、`localOnly` 或后续 additive enum。未知 provider kind 必须显示 unsupported，不能猜请求格式。
- `base_url` 只保存服务基址或配置引用；示例只能使用占位值，例如 `https://api.example-explorer.local/api`、`api_key_ref = "ETHERSCAN_MAINNET_KEY"`，不得包含真实 key。
- Data source config 只能保存 secret reference/label。真实 API key/secret value 必须来自 OS keychain、secure secret store、环境变量或用户会话输入，不能随 app config/export 输出，也不能进入普通 cache/config/history/diagnostics。
- API key、认证 URL、query token、basic auth、bearer token 或带 secret 的完整 URL 不得进入 diagnostics、history、export、前端状态快照或测试快照。日志和导出只能保留非敏感摘要，例如 provider kind、chainId、host 摘要、配置 id、key label/hash suffix、rate-limit status 和错误分类。
- Rate-limit/failure metadata 至少能表达 last success、last failure、failure count、cooldown until、`rateLimited` hint 和脱敏 error summary。它是排障状态，不是 ABI identity。

**ABI cache identity 与元数据**

- ABI logical source key 至少由 `chain_id + contract_address + source_kind + provider_config_id/user_source_id` 组成。`contract_address` 必须先通过 EVM 地址校验，并按统一 checksum/normalized 策略保存。这个 key 表示同一合约同一来源的逻辑 source slot。
- `abi_hash`、`source_fingerprint`、provider result version、response fingerprint、fetch/import attempt id 是 immutable cache version/attempt、conflict detection 和 selected source pointer 的材料，不应被当作唯一的逻辑 source slot。相同 logical source 下 ABI 内容变化时应产生新的 version/attempt，并让当前 selected version 明确可见。
- `source_kind` 至少包含 `explorerFetched`、`userImported`、`userPasted`，后续可扩展 `indexerFetched`、`systemKnown`。用户导入/粘贴不得自动标记为 verified explorer ABI。
- `source_fingerprint` 建议为 canonicalized ABI JSON 的 hash；fetch 来源还应记录 provider config id、provider kind、脱敏 endpoint 摘要、explorer result version 或 response fingerprint。用户导入/粘贴还应记录 user source id、文件名摘要或 paste session id 摘要，但不得保存本地绝对路径中的敏感部分。
- Cache entry 建议字段：`chain_id`、`contract_address`、`source_kind`、`provider_config_id` 或 `user_source_id`、`source_fingerprint`、`abi_hash`、`version_id`、`attempt_id`、`selected`、`status`、`metadata`、`function_count`、`event_count`、`error_count`、`selector_summary`、`fetched_at` 可选、`imported_at` 可选、`updated_at`、`last_validated_at`、`stale_after` 可选、`last_error_summary` 可选。
- Metadata/source/status 必须在 UI/read model 可见。缺失 ABI 是 `notConfigured`、`notVerified`、`fetchFailed` 等显式状态之一，不能当作空 ABI。
- Provider 返回 proxy ABI、implementation ABI、proxy implementation address 或类似线索时，只能记录为 `providerProxyHint`、`proxyDetected` 等非身份 metadata；不得暗示该 ABI 一定对应 current address runtime，也不得因此改写 logical source key。

**ABI validation**

- 必须接受 standard JSON ABI array。Explorer 常见返回是 JSON string 包在响应字段里，允许 parse 后再按 ABI array 验证。
- 必须拒绝 malformed JSON、非 array、array 中无 `function`/`event`/`error` 项、超过大小上限的 payload，以及明显 malformed 的 ABI item。
- Validation 应生成 selector summary：function selector、event topic hash、error selector 的数量和冲突摘要。重复/冲突 selector 必须可见；实现可先允许保存但标为 `selectorConflict`，或阻止作为默认 ABI，不能静默吞掉。
- ABI item 的 name、inputs、outputs、stateMutability、anonymous 等字段来自不可信来源；UI 可展示但不得把 explorer metadata 当作安全背书。
- 过大 payload 必须在 Rust/Tauri command 层尽早拒绝，避免 React 持有大响应或日志误写完整 ABI。

**失败状态与刷新**

- P5-1 状态 taxonomy 分层如下，UI/read model 必须能同时展示相关层级，不能用一个空 ABI 或单一 unknown 状态吞掉细节。
- Fetch/source status：`notConfigured`、`unsupportedChain`、`fetchFailed`、`rateLimited`、`notVerified`、`malformedResponse`。其中 `notConfigured` 表示当前 chain 没有可用 ABI data source；`unsupportedChain` 表示配置或 provider 明确不支持该 chain；两者不能混成普通 fetch failure。
- Parse/validation status：`parseFailed`、`malformedAbi`、`emptyAbiItems`、`payloadTooLarge`、`ok`、`selectorConflict`。`selectorConflict` 表示 ABI 可解析但存在重复/冲突 selector 或 topic，必须在 validation summary 和 UI 中可见。
- Cache status：`cacheFresh`、`cacheStale`、`refreshing`、`refreshFailed`、`versionSuperseded`。失败刷新应保留旧可用 version，并标记 stale/failure。
- Source selection/conflict status：`selected`、`unselected`、`sourceConflict`、`needsUserChoice`。不同 provider/user source 的 ABI hash 或 selector summary 冲突时，必须进入 `sourceConflict`/`needsUserChoice`，不能静默覆盖 selected version。
- P5-1 至少需要可见状态：`notConfigured`、`fetchFailed`、`rateLimited`、`notVerified`、`malformedResponse`、`parseFailed`、`sourceConflict`、`cacheStale`、`unsupportedChain`、`selectorConflict`。
- `notConfigured` 表示当前 chain 没有可用 ABI data source；`unsupportedChain` 表示配置或 provider 明确不支持该 chain；两者不能混成普通 fetch failure。
- `notVerified` 表示 explorer/indexer 找到了合约但没有 verified ABI 或只返回 placeholder；不能写成空 ABI。
- `malformedResponse` 表示 provider 响应结构不符合预期；`parseFailed` 表示 ABI JSON 或 ABI string 解析失败。错误摘要必须脱敏。
- Cache invalidation/refresh 至少覆盖 manual refresh、TTL/staleness、source changed、contract address changed、chain changed。旧 ABI 不应静默覆盖新来源；不同 source fingerprint 或 provider 结果冲突时必须进入 `sourceConflict` 并要求用户确认采用哪个来源。
- Manual refresh 应生成新的 cache attempt 和状态摘要；失败时保留旧可用 ABI 但标记 stale/failure，不能把旧 ABI 删除后表现为空。

**Import / paste 行为**

- 用户导入文件或粘贴 ABI JSON 时，source 必须分别保存为 `userImported` 或 `userPasted`，并显示 fingerprint/hash、函数/事件/error 数量、selector summary、导入/粘贴时间和 validation status。
- 文件导入只接受 ABI JSON 内容，不把文件路径作为可信来源。路径、文件名和错误消息进入诊断前必须最小化或脱敏。实现可以让 React 用固定小上限做预检后把内容短暂传入 command，也可以走 Rust file path/stream import；无论哪种路径，完整解析、validation、canonicalization、hash、最终 size limit 和缓存写入都以 Rust/Tauri 为准。
- Paste 输入同样可以在前端固定小上限预检并短暂传入 command，但不得持久化到 React state、local storage、diagnostics、export、history、日志或 test snapshot。Paste 的完整 parse/validate/size limit/selector summary 仍由 Rust/Tauri command 执行；失败状态可见，不能把 malformed ABI 保存成可用 cache。
- 用户来源 ABI 可以作为后续调用器的显式选择，但不能自动提升为 verified explorer ABI，也不能覆盖 explorer fetched ABI，除非用户确认 source conflict。

**Rust/Tauri 边界**

- React 只表达 fetch/import/paste/refresh/choose source 的意图，并展示 ABI read model、validation summary 和失败状态。
- Fetch response 永不进入 React；网络请求、API key 引用解析、URL 组装、脱敏、fetch payload size limit、parse/validate、cache 存储应在 Rust/Tauri command 层处理。敏感配置不得进入 React state、日志、history 或 diagnostics export。
- Paste/import 是用户主动输入，前端可以短暂接触 ABI 内容用于小上限预检或 file picker，但不得长期保存、记录、导出或写入测试快照；Rust/Tauri command 仍是最终安全边界和真相来源。
- ABI cache 是可重建的本地数据，不得与 vault、助记词、私钥、签名材料混存。P5-1 不创建交易历史，也不签名、不广播。
- 后续 write transaction 仍必须走 Rust/Tauri command 签名广播；ABI 管理只提供 ABI 和 selector/read model 输入，不提供前端签名出口。

**后续关系**

- P5-2 ABI read/write 调用器已消费 ABI source/cache/read model，并在 write path 中复用 Intent/Submission/ChainOutcome、确认页和 Rust 签名广播边界。
- P5-3 raw calldata 可以使用 selector summary 辅助解释 calldata，但未匹配或冲突 selector 必须显示 unknown/conflict。
- P6 tx hash/contract hot 解析可以消费 ABI cache 和 source metadata，但解析结果仍是依赖数据源的推断，不能把未验证 ABI 或冲突 selector 展示为确定事实。

### 9.7 ABI read/write 调用器（P5-2 已完成/可用）

本小节定义并保留 P5-2 的已实现设计约束。P5-2 ABI read/write 调用器已在 Tauri desktop 主线可用，基于 P5-1 的 ABI source/cache/read model 提供只读 ABI call 和 managed ABI write transaction caller。Browser 版本不是主线；任何 write path 都必须复用现有 Rust/Tauri 签名、广播、确认页和交易历史边界。

**范围与非目标**

- P5-2 支持基于已管理 ABI 的 read-only call 和 write transaction caller：用户选择 `chain_id + contract_address + selected source` 下的 ABI entry，再按函数签名编辑参数、预览 calldata 摘要，并执行只读调用或进入写交易确认。
- P5-2 不提供 raw calldata sender；raw calldata 的输入、发送和高级预览由 P5-3 单独设计。
- P5-2 不实现 revoke、allowance/asset scanning、hot tx parsing、代理自动解析完整方案、任意合约风险评级或 selector 数据库。
- P5-2 不提供前端签名或广播出口。写交易提交必须通过 Rust/Tauri command 重新校验、签名、广播并按既有交易历史模式落盘。
- Selector match 不是安全保证。selector summary 只能说明 ABI 文本中的编码匹配关系；ABI stale、source conflict、unknown ABI、selector conflict、链/RPC 不一致等状态必须阻塞或要求显式解决，不能被函数名或 selector 匹配静默覆盖。

**ABI read model 消费**

- 调用器只消费 P5-1 输出的 selected ABI entry，定位条件至少是 `chain_id + contract_address + selected source + version_id/source_fingerprint/abi_hash`。`contract_address` 必须使用 P5-1 的 normalized/checksum 策略。
- 可调用的 ABI entry 必须满足：`selected`、validation `ok`、cache status 为 `cacheFresh`、无 `sourceConflict`、无 `needsUserChoice`、无未解决的 provider/user source 冲突。任何 stale/conflict/unknown 状态都必须阻塞，除非后续 backend/domain command 明确定义 resolution 并在 draft/submit 中冻结 resolution 结果。
- `selectorConflict` 是 P5-1 validation status，不等同于 validation `ok`。P5-2 默认把 `selectorConflict` ABI entry 视为 non-callable：React 只能展示冲突摘要和阻塞原因，不能通过本地选择、函数名匹配或 warning acknowledge 把它提升为 callable。未来若支持冲突 resolution，必须由 Rust/Tauri backend/domain command 产出具体已解析的 callable source/version/signature/selector identity，并在 read call 或 write draft/submit 中冻结该 resolved identity。
- `cacheStale`、`notConfigured`、`notVerified`、`fetchFailed`、`rateLimited`、`malformedResponse`、`unsupportedChain`、`parseFailed`、`malformedAbi`、`emptyAbiItems`、`payloadTooLarge`、`refreshing`、`refreshFailed`、`versionSuperseded`、`sourceConflict`、`needsUserChoice`、`selectorConflict` 和 selected ABI missing 必须在调用器入口可见并明确映射。`refreshing` 映射为 loading/temporarily blocked；`refreshFailed` 映射为 recoverable blocked，除非仍有 fresh prior version 被选中；`cacheStale` blocks calls/submission until refreshed or explicitly resolved by backend/domain flow；其他 non-`ok` validation/source/cache states 也必须阻塞调用/提交，除非 backend/domain resolution flow 明确返回 frozen resolved callable identity。`notVerified` 至少需要显式警告，写交易默认阻塞或要求后续设计中的明确用户确认和后台复验。
- Artifact/ABI body 加载、canonicalization、hash/fingerprint 校验和 source/version resolution 应在 Rust/Tauri command 或受控 read-model 路径完成。React 可以短暂持有当前表单参数和函数摘要，但不得把 raw ABI body 持久化到 local storage、diagnostics、history、export、日志或测试快照。

**函数分类与选择**

- `view`、`pure` 函数进入 read-only call 路径。缺失 `stateMutability` 的 legacy ABI item 需要按 `constant/payable` 做保守兼容；无法可靠分类时不得自动当作可写或可读。
- `nonpayable` 和 `payable` 函数进入 write transaction draft 路径。`payable` 允许 native value；`nonpayable` 默认 value 必须为零，非零 value 直接校验失败。
- 构造函数不在 P5-2 调用器范围内。`fallback` 和 `receive` 不作为普通 ABI 函数调用；P5-2 可展示为 unsupported/blocked，后续若支持也必须走单独确认模型。
- 重载函数必须按完整 signature 选择，例如 `transfer(address,uint256)`，不能只按 name 选择。UI、draft、history、diagnostics 都应保存 signature 和 selector 摘要，避免重载歧义。

**参数模型与 calldata 预览**

- 参数编辑器必须覆盖常见 ABI 类型：address、bool、string、bytes、fixed bytes、int/uint 及 bounds、arrays、fixed arrays、tuple 和 nested tuple/tuple arrays。展示层可以提供人类可读输入，但 canonical value 必须能按 ABI 类型无歧义编码。
- Parse/validate 失败必须显示具体字段和错误类别，例如 malformed address、bytes length mismatch、integer out of bounds、array length mismatch、tuple field missing、unsupported type。失败值不得被自动改成零地址、0、false、空 bytes 或其他看似安全的默认值。
- 预览应展示 encoded calldata 的 function signature、selector、参数摘要、calldata length、calldata hash，以及 value/gas/fee/nonce 的 draft 状态。预览不应把 semantic decode 当作安全保证；它只是基于当前 selected ABI 和 canonical params 的编码结果。
- Canonical parameter values 可在 React 表单状态、Rust command 入参、submit-time revalidation 和 calldata 编码过程中短暂存在；这个 in-memory/submit-time 边界不同于持久化边界。Draft persistence、history、diagnostics、export、日志和测试快照只能保存 bounded summary、argument/calldata hash、长度、类型路径和必要的 redacted display value；不得保存完整且无上限的 tuple/string/bytes/array 参数或 raw calldata。大型 bytes/string/array 参数在 UI、history、diagnostics 中应摘要化显示。完整参数值和 calldata 的持久化规则必须由 write draft/history schema 明确限制。

**Read-only call 行为**

- Read call 执行前必须用 selected RPC profile 校验 actual `chainId` 与 expected `chain_id` 一致，并确认目标 contract address、ABI entry version/fingerprint 和函数 signature 未漂移。
- `from` account 对 read call 是可选上下文：若用户选择账户，则作为 `eth_call.from` 传入并在结果中展示；未选择时不伪造账户。read call 不签名、不广播、不创建普通交易历史记录。
- Read call 默认不携带 native value。若 ABI 标记为 `payable view/pure` 这类少见组合，P5-2 初版仍应保守地不提供 value 输入；后续如支持 value-bearing `eth_call`，必须显式展示风险和失败语义，且不得复用写交易 value 默认。
- 返回值按 selected ABI decode；空返回、malformed return、revert data、RPC failure、timeout、chain mismatch 和 ABI decode error 都必须可见且脱敏。可记录有限 diagnostic event，但不能把 read call 伪装成已提交交易，也不能写入普通 tx history。

**Write transaction draft 与提交**

- 写交易 draft 必须冻结身份与版本：`chain_id`、from account、to contract、ABI source identity、`version_id`、`abi_hash`、`source_fingerprint`、function signature、selector、canonical params summary/hash、native value、gas/fee/nonce、selected RPC identity、warning/blocking statuses 和 draft creation time。完整 canonical params 只能作为 submit-time command input 或受控内存状态参与重新编码/复验，不作为 unbounded durable draft/history payload。
- 确认页必须显示 contract、chain、from、function signature、selector、decoded args 摘要、native value、gas limit、fee cap/max fee、priority fee、base fee、fee multiplier、nonce、selected RPC identity、ABI source/status、cache/source warnings 和风险提示。复杂参数必须能展开查看摘要，但不能在普通日志或 diagnostics 中泄漏大 payload。
- Write submit 必须调用 Rust/Tauri command。Command 需要重新校验 actual chainId/RPC、signer/from、account availability、ABI entry version/fingerprint/hash、function signature/selector、canonical params/call data、value、gas/fee/nonce、source conflict/`cacheStale` 状态和 pending warning resolution，再签名广播。
- 提交流程应复用既有 signing/broadcast/history pattern：在广播前后按现有可恢复策略持久化 typed intent/submission/outcome，记录 tx hash、broadcast attempt、RPC identity、chain outcome、replacement/cancel 关系等恢复材料。
- 历史模型需要扩展 arbitrary ABI write call intent/submission/outcome，不能伪装成 native/ERC-20/batch。建议字段包括 typed intent kind、contract、function signature、selector、argument summary、argument hash、calldata length/hash、value、fee/nonce、ABI source identity/version/fingerprint、submission status、chain outcome、recovery metadata。历史不得保存 raw ABI body、secret、mnemonic/private key、完整 unbounded tuple/string/bytes/array 参数或未经明确边界允许的巨大 raw calldata。

**Diagnostics 与安全**

- Diagnostics、history、export、日志和测试快照不得包含 private keys、mnemonics、signed tx secret material、API keys、认证 URL、query token、raw large ABI body 或用户敏感路径。
- RPC URL、explorer URL、provider error、ABI/cache error 和 revert/RPC error 都必须脱敏。可保留 chainId、provider kind、host/config 摘要、error class、status code、rate-limit hint、selector、calldata length/hash 等排障信息。
- Full calldata 的持久化必须有明确安全边界。P5-2 初版默认只持久化 selector、length、hash 和参数/intent摘要；若后续为了恢复需要保存完整 calldata，也必须限定在本地 history schema、脱敏导出策略和用户可见说明中。

**测试与验收方向**

- Rust 测试建议覆盖 ABI source/version resolution、signature-level overload selection、tuple arrays/nested tuple encoding、selector conflict blocking、`cacheStale` blocking、source conflict blocking、chain mismatch、payable/nonpayable value validation、gas estimation failure、submit revalidation 和 history recovery metadata。
- Frontend 测试建议覆盖参数编辑器校验、预览摘要、read call result/revert/decode error 展示、write confirmation warnings、blocking states、large payload summary、重载函数选择和不把 raw ABI body 写入 snapshot。
- 端到端验收应包含：overloaded functions、tuple arrays、selector conflicts、stale ABI、chain mismatch、decode errors、reverts、payable value、gas estimation failure、broadcast failure/retry 和 history recovery。

### 9.8 Raw calldata 发送与预览（P5-3 已完成）

本小节定义 P5-3 的 raw calldata sender/preview 设计，能力已在 Tauri desktop 主线完成并合入 main。P5-3 面向高级用户，允许在明确高风险边界下提交用户提供的 calldata；它不是 P5-2 managed ABI 参数编辑器的替代，也不能把 selector/ABI 推断展示为安全保证。Browser 版本不是主线；最终签名、广播、history 写入和恢复仍必须走 Rust/Tauri command。

**范围与非目标**

- P5-3 提供 raw calldata draft、预览、确认和提交路径，输入直接是用户提供的 calldata hex。
- P5-3 可以消费 P5-1/P5-2 的 ABI cache、selector summary 或已知 managed ABI read model 做辅助推断，但推断结果只能显示为 `matched`、`unknown`、`conflict`、`stale` 或类似不确定状态，不能当作安全背书。
- P5-3 不提供 ABI 参数编辑器，不从任意外部源自动 fetch ABI，不实现 revoke/approve helper，不实现 selector risk scoring database，不实现 hot tx parsing 或 tx hash 逆向解析。
- P5-3 不实现前端签名、前端广播或 raw signed transaction 出口；React 只表达用户意图、展示 bounded preview 和传递 submit-time command input。

**输入模型**

- Draft 输入至少包含：expected `chainId`、selected RPC profile/RPC identity、from local account、`to` address、native `value_wei` 和/或 human amount、raw calldata hex、gas limit、base fee reference/used、base fee multiplier、priority fee、max fee/fee cap、nonce。
- `to` 必须是校验后的 EVM 地址。`value` 必须按 wei 保存为最终提交单位；human amount 只是展示/输入层，冻结时必须有 canonical `value_wei`。
- Raw calldata normalization 必须固定：只接受 `0x` 前缀、偶数长度、hex 字符串；拒绝缺失前缀、奇数字符、非 hex 字符和超过实现上限的 payload。Canonical display 一律使用 lowercase `0x...`。
- P5-3 初版最大接受 normalized decoded calldata byte length 为 128 KiB。该上限同时用于 UI、history、diagnostics/export 和测试 fixture；超过上限必须在 draft 阶段拒绝，不能截断后提交。
- 空 calldata `0x` 允许作为 raw calldata intent，但必须显示 `emptyCalldata` warning。空 calldata + nonzero value 仍是 native-value contract/EOA transaction，不应被伪装成 native transfer；历史类型仍应是 raw calldata intent，除非用户明确走 native transfer workflow。
- Gas/fee/nonce 可以复用现有 native/ERC-20/P5-2 的 fee reference、base fee customization、priority fee、max fee override 和 nonce 规则；estimate failure 不得静默填危险默认值。

**Preview 与 selector inference**

- Calldata hash 必须使用 `calldata_hash_version = keccak256-v1`：对 normalized decoded calldata bytes 计算 keccak256。空 calldata `0x` 对 0 bytes 计算 hash。Draft、history、recovery 和 diagnostics/export 中凡保存 hash 都必须同时保存 hash version。
- Preview 必须展示 selector（calldata 前 4 bytes；长度小于 4 bytes 时为 `none/short`）、calldata byte length、`calldata_hash_version`、calldata hash、bounded calldata preview、`to`、native value、gas/fee/nonce 和 selected RPC identity。
- Bounded calldata preview 格式必须可测试：保存 canonical lowercase hex 的 prefix/suffix 摘要，默认 `preview_prefix_bytes = 32`、`preview_suffix_bytes = 32`。当 calldata length 超过 64 bytes 时，展示 `0x<prefix>...<suffix>` 并带显式 `truncated = true`、`omitted_bytes`；小于等于 64 bytes 时可完整展示但仍标记 `truncated = false`。history/diagnostics/export/logs 不得保存完整 calldata 字段，只保存 selector、byte length、hash version、hash、prefix/suffix preview 和 truncation metadata。
- Human preview rows/summaries 初版最多展示 12 行结构化摘要；每行 display text 最多 160 字符，超过部分必须截断并标记 `truncated = true`。测试 snapshot 只能包含这些 bounded summaries。
- 若 P5-1/P5-2 cache 中存在同 `chainId + to` 的 selected ABI source，并且 selector 唯一匹配，可展示函数 signature、source identity、version/fingerprint/hash 和 inference status `matched`。
- 若无 ABI、无 selector、cache stale、source conflict、selector conflict、多个 ABI source 匹配不同 signature 或 selector 重载无法唯一判断，必须显示 `unknown`/`conflict`/`stale`，并把 semantic decode 标记为不可信或不可用。
- Selector match 只表示当前本地 ABI/cache 文本可解释该 selector，不表示目标合约 runtime 一定匹配、不表示参数语义正确、不表示调用安全。
- 当 selector inference 影响 warning 或 acknowledgement 时，inference state 必须进入 frozen key 和 history：`inference_status = unknown | matched | conflict | stale | unavailable`、matched ABI source identity、version/fingerprint/hash、selector match count、conflict summary、stale/source status 和 acknowledgement state。若 inference 只是纯 UI 辅助且不影响 warning，则 submit 不依赖它；P5-3 初版采用前一种更保守路径，即影响 warning 的 inference 必须冻结。

**Safety / diagnostics / export**

- Raw calldata 不能被完整语义信任。即使 selector 匹配，参数、代理合约、fallback、delegatecall、合约升级、ABI stale、链/RPC 错误和用户复制错误都可能让实际效果不同。
- Unknown selector 或 conflict selector 允许继续，但必须要求显式 high-risk acknowledgement；acknowledgement 应冻结进 draft key，并在 submit-time 重新校验仍存在。
- Full calldata 不得无边界写入 logs、diagnostics、export、history、test snapshots 或错误消息。历史默认只保存 selector、length、hash、bounded preview 和人工摘要；diagnostics/export 也只能保留同等或更少信息。
- Diagnostics 不得包含助记词、私钥、seed、明文密码、签名材料、raw signed transaction、完整 RPC 认证凭据、API key、query token、完整认证 URL 或未脱敏路径。

**Draft / frozen key**

- Frozen key 必须覆盖：expected `chainId`、RPC identity、from account/address、本地 account identity、`to`、`value_wei`、calldata hash version、calldata hash、calldata length、selector、prefix/suffix preview metadata、gas limit、base fee reference/used、base fee multiplier、priority fee、max fee/fee cap、nonce、warning acknowledgements、影响 warning 的 selector inference state、draft creation time 或 version。
- Frozen key 不保存完整无上限 calldata；submit command 可以在内存/入参中接收 actual calldata 并重算 hash/length/selector，与 frozen key 对比。
- 用户改变 chain、RPC profile、from、to、value、calldata、gas、fee、nonce、warning acknowledgement 或 selector inference resolution 后，旧 draft 必须失效并要求重建。

**Submit / Rust/Tauri command**

- Submit 必须调用 Rust/Tauri command。Command 在签名前重新校验 actual RPC `chainId`、selected RPC identity、from/signer/account availability、nonce、fee/gas、`to`、`value_wei`、actual calldata normalization、128 KiB byte length limit、hash version/hash、length、selector、frozen key 和 warning acknowledgements。
- Command 重新计算 calldata hash/length/selector，确认与 frozen draft 一致；不允许 React 只传 selector/summary 让 Rust 自行猜 calldata。
- 若用户 acknowledge 的 warning 依赖 selector inference，Command 必须重新读取或复验对应 ABI source identity/version/fingerprint/hash、selector match count/conflict summary 和 inference status；复验结果与 frozen state 不一致时必须拒绝提交并要求重建 draft。
- Command 只在所有校验通过后签名广播，并按既有 signing/broadcast/history pattern 写入 typed raw calldata intent/submission/outcome。广播和 history 写入失败必须进入可恢复错误模型。
- P5-3 submit 不应复用 P5-2 managed ABI write command 的语义字段来伪装参数来源；它可以复用底层 signer/RPC/history helpers，但 intent kind 必须是 raw calldata。

**History typed metadata**

- History 必须新增显式 raw calldata intent/submission metadata，不能伪装成 native/ERC-20/ABI/batch。建议 intent 字段包括 `transaction_type = rawCalldata`、chainId、from account/address、to、value_wei、calldata selector、calldata length、`calldata_hash_version = keccak256-v1`、calldata hash、bounded prefix/suffix preview、truncation metadata、selector inference status、optional matched ABI source identity/version/fingerprint、selector match count/conflict summary、warning acknowledgements 和用户摘要。
- Submission 字段包括 tx hash、nonce、gas/fee、RPC identity、broadcast time、frozen key、actual calldata selector/length/hash version/hash、history write/recovery metadata。
- ChainOutcome 沿用 pending/confirmed/failed/replaced/cancelled/dropped 语义。receipt/revert 摘要必须脱敏，不能把 raw calldata 或 raw signed tx 写入 history/export。

**Failure / recovery**

- `chain mismatch`：draft、estimate、submit 前都必须拒绝，展示 expected/actual chainId；RPC URL 不能覆盖真实 chain identity。
- `malformed calldata`：非 `0x` hex、奇数字符、不合法 hex、超过实现上限或与 frozen hash/length 不一致时阻塞提交。
- `estimate failure`：显示 RPC/contract/revert/insufficient funds/unknown 分类摘要；允许用户重试或显式手动 gas，但手动 gas 仍必须进入 high-risk acknowledgement 和 frozen key。
- `high-risk warnings`：unknown/conflict selector、nonzero value、large calldata、high fee/gas、manual gas、stale ABI inference 等 warning 必须可见；需要 acknowledge 的 warning 未冻结时不得提交。
- `broadcast failure`：不创建 confirmed/pending 假象；保留脱敏错误摘要和 frozen params 供用户重试或重建 draft。
- `history write failure after broadcast`：必须返回 tx hash、chainId、from、to、nonce、value_wei、fee/gas、calldata selector/length/hash version/hash、bounded prefix/suffix preview、truncation metadata、selector inference state、warning acknowledgements、frozen key 和写入错误。恢复入口只能用 tx hash + frozen params 补录，不能重新签名或重新广播。
- `recovery without rebroadcast`：补录路径必须重查链上 tx/receipt 或按已知 tx hash 恢复本地 record，不得因为本地 history 缺失而再次发送同一 calldata。

**测试与验收方向**

- Rust 测试建议覆盖 calldata hex validation、128 KiB limit、keccak256-v1 hash/length/selector recompute、chain mismatch、from mismatch、nonce/fee/gas mismatch、unknown selector acknowledgement、inference-state revalidation、history write failure recovery metadata 和 diagnostics/export redaction。
- Frontend 测试建议覆盖 preview selector/length/hash version/hash、unknown/conflict/stale ABI inference、prefix/suffix bounded preview、12 行/160 字符 summary cap、draft invalidation、manual gas/high fee warnings、full calldata 不进入 snapshot。
- 端到端验收应包含 matched ABI selector、unknown selector、selector conflict、empty calldata、nonzero value、malformed calldata、estimate failure、broadcast failure、history write failure after broadcast 和 recovery without rebroadcast。

### 9.9 资产/授权扫描与 revoke 工作流（P5-4 计划/设计）

P5-4 目标是提供只读资产/授权扫描视图，以及针对明确 active approval 的受控 revoke 工作流。扫描结果用于帮助用户理解本地账户在某条链上的已知资产与授权状态；revoke 属于写交易，必须复用 Intent -> Submission -> ChainOutcome、确认页、Rust/Tauri command 签名广播、history/recovery 和诊断脱敏边界。P5-4 不承诺普通 RPC 能全量发现资产、NFT 或授权，也不把 explorer/indexer 结果当作交易真相。

**Asset / approval types**

- ERC-20 balances 复用 P4-9 token watchlist 与 ERC-20 balance scan。稳定身份是 `chainId + owner/local account + token contract`；`symbol`、`name` 和用户展示标签不能作为 identity 或安全背书。
- ERC-20 allowance scan 可扩展为 point queries：`owner local account`、`spender address`、`token contract`、`allowance raw`、`decimals/source`、`status`、`source metadata`、`last checked at` 和错误摘要。RPC `allowance(owner, spender)` 是被支持 point query 的 truth；候选 token/spender 可以来自用户配置、watchlist、history、ABI/known contract hints 或 explorer/indexer。
- ERC-721/ERC-1155：普通 RPC 通常不能枚举某 owner 的所有 NFT contract、token IDs 或所有 operator approvals。初版只支持用户/watchlist/indexer-provided contracts/token IDs 的只读展示，并把 discovery source、staleness 和 failure 明确标记。
- ERC-721/ERC-1155 operator approvals 使用 `isApprovedForAll(owner, operator)`。ERC-721 token-specific approval 只有在 snapshot/tokenId 明确时才使用 `getApproved(tokenId)` 展示。
- Native balance 继续作为已有 account snapshot 展示，不把 P5-4 写成新的 native asset scan truth，也不从 native balance 推导未知资产组合。

**数据源边界**

- RPC read calls 是 supported point queries 的 truth：ERC-20 `balanceOf`/`allowance`、ERC-721/1155 `isApprovedForAll`、ERC-721 `getApproved(tokenId)`、已支持 metadata/decimals 读取和 native account snapshot。
- Explorer/indexer 可以辅助发现 token、NFT、spender/operator、tokenId 或 allowance candidates，但每条候选和结果必须标记 `source`、`source identity`、`observed at`、`staleness`、`confidence/status` 和失败原因。
- 没有 indexer 或用户/watchlist/history 候选时，UI 和文档不能承诺全量资产发现、全量 NFT 发现或全量授权发现。Scan result 应显示 `not configured`、`candidate source unavailable`、`unknown coverage` 或类似状态，而不是静默空列表。
- Explorer/indexer/RPC URL、API key、query token、provider secret、认证 URL 和 provider error 必须脱敏；React state、diagnostics、history 和 export 不得持有真实 secret value。

**存储 / read model**

- 建议新增 approval watchlist/config：按 `chainId` 记录 owner local accounts、token/NFT contracts、spender/operator addresses、tokenIds（如适用）、candidate source、user labels、enabled 状态和 scan cadence。地址必须 canonicalized；identity 不得依赖 symbol/name。
- 建议新增 asset/approval scan jobs：记录 `scanJobId`、expected `chainId`、RPC identity、requested owners/contracts/spenders/operators/tokenIds、started/finished at、per-item status、source coverage、stale policy 和脱敏错误摘要。
- 建议新增 asset snapshots：表达 ERC-20 balance snapshot 与 NFT known holding/display snapshot，至少包含 `chainId`、owner/local account、contract、asset type、tokenId（如适用）、balance raw 或 holding status、decimals/source、metadata source/status、snapshot at、stale/failure 状态。
- 建议新增 allowance snapshots：至少包含 `chainId`、owner/local account、token contract、spender、allowance raw、decimals/source、metadata source/status、active/zero/unknown/stale/error status、source metadata 和 last successful read。
- 建议新增 NFT approval snapshots：至少包含 `chainId`、owner/local account、NFT contract、operator 或 tokenId、approval kind (`operatorAll`/`erc721TokenSpecific`)、approved/status、source metadata、last successful read 和 stale/failure 状态。
- Source metadata/status 应能区分 `rpcPointRead`、`userWatchlist`、`historyDerivedCandidate`、`explorerCandidate`、`indexerCandidate`、`manualImport`、`unavailable`，并保存 bounded failure summary。Identity 至少覆盖 `chainId`、owner/local account、contract、spender/operator、tokenId（如适用）；不得用 `symbol`、`name`、图标、explorer label 或 verified badge 做 identity。

**扫描流程**

- 每次 scan job 开始前必须 probe RPC `chainId` 并与 expected `chainId` 匹配；RPC URL 不能覆盖真实 chain identity。Chain mismatch 阻塞整个 job，并只输出脱敏错误摘要。
- 每个 owner + contract + spender/operator/tokenId 是独立 read item，独立成功/失败/timeout/rate-limit。单项失败不能让其他项伪失败，也不能把旧 snapshot 批量清零。
- 失败时保留 last successful snapshot 并标记 `stale`、`readFailed`、`sourceUnavailable`、`rateLimited` 或 `unknown`；不得把 RPC/indexer 失败解释为 `0 allowance`、`false approval`、`not owned` 或 `no asset`。
- Decimals/metadata 失败时仍可保留 raw allowance/balance，但 amount human display 必须显示 decimals unknown/source failed；不得用 symbol/name 判断 contract identity。
- Error summaries 必须脱敏并有上限，保留 chainId、contract、owner local account ref、spender/operator、tokenId、error class、status code/rate-limit hint 和 source kind 即可。

**Revoke workflow**

- ERC-20 revoke 使用 `approve(spender, 0)`，transaction `to = token contract`，`spender` 与 `amount = 0` 是 calldata 参数。UI 和 history 必须清楚展示 token contract 与 spender 的差异。
- ERC-721/ERC-1155 operator revoke 使用 `setApprovalForAll(operator, false)`，transaction `to = NFT contract`，operator/false 是 calldata 参数。
- ERC-721 token-specific approval revoke 可用 `approve(address(0), tokenId)`，只在 snapshot/tokenId 明确、approval kind 为 token-specific 且当前 status 支持时开放。
- 所有 revoke 都是 write transaction，必须走 Intent -> Submission -> ChainOutcome、确认页、Rust/Tauri command 签名广播、history/recovery；React 不签名、不广播、不接收 raw signed tx 或签名材料。
- Draft/frozen key 至少覆盖 expected `chainId`、RPC identity、from owner/local account、approval snapshot identity/status/ref、approval kind、token/approval contract、spender/operator、tokenId（如适用）、method、selector、canonical calldata args、gas/fee/nonce、warning acknowledgements、frozen at/version 和 source/staleness status。
- Submit-time 必须重新校验 actual RPC `chainId`、selected RPC identity、from/signer/local account availability、approval snapshot identity/status、token/approval contract、spender/operator、tokenId、calldata selector/method/args、fee/gas/nonce、warning acknowledgements 和 frozen key。校验失败必须拒绝并要求重建 draft。
- Submit 前应重新读取当前 approval point query；若 allowance 已为 0、operator approval 已 false、token-specific approval 已 address(0) 或 snapshot identity 不匹配，应显示 already revoked/changed，不广播 revoke。若 spender/operator/tokenId 或 contract 与 frozen identity 不一致，必须阻塞。
- 广播和 history 写入沿用已有可恢复模型。History record 应显示 typed revoke intent/submission/outcome，不能伪装成 ERC-20 transfer、managed ABI write 或 raw calldata。

**UI / UX**

- 提供资产/授权扫描视图，支持按账户、链、contract、spender/operator、asset/approval kind、status、source 和 stale/failure 状态筛选。
- `stale`、`failure`、`unknown coverage`、`indexer candidate not verified by RPC`、`metadata unknown` 必须显式显示；空状态要说明 coverage 边界，不能暗示全量安全。
- Revoke 只对明确 active approval 开启：ERC-20 allowance raw > 0、operator approval true、ERC-721 token-specific approval 指向非零地址且 tokenId 明确。Stale、unknown、failed、zero/false approval 默认禁用 revoke，允许用户重新扫描。
- 确认页必须展示 chain、from、contract、spender/operator、tokenId、method/selector、current snapshot/status、source/staleness、gas/fee/nonce 和 warning acknowledgements。
- 批量 revoke 暂不做或作为后续任务；若未来支持，必须逐笔确认/冻结、逐笔 history/recovery、逐笔 chainId/from/approval identity revalidation，不能用一次 blanket acknowledgement 覆盖多笔高风险交易。

**Safety / privacy**

- 不保存助记词、private key、seed、明文密码、raw signed tx、签名材料、RPC secret、API key、query token 或完整认证 URL。
- 不把 explorer/indexer 结果当交易真相；它们只能提出 candidates 或补充 metadata，最终 revoke 前必须由 RPC point read 和 submit-time revalidation 确认。
- `symbol`、`name`、logo、verified badge、explorer label 和 token list label 不能作为安全背书，也不能替代 contract address、chainId、owner/spender/operator/tokenId identity。
- Revoke 高风险确认至少覆盖 unlimited allowance、unknown token metadata/decimals、stale snapshot、external spender/operator、contract not verified、spender/operator not in local address book、indexer-only candidate、manual gas/high fee、chain mismatch history 和 proxy/upgradeable/unknown contract hints。

**Failure / recovery**

- `broadcast failure`：不创建 pending/confirmed 假象；保留 frozen params、snapshot identity 和脱敏 RPC error，允许重试或重建 draft。
- `history write failure after broadcast`：必须返回 tx hash、chainId、from、contract、spender/operator、tokenId、method/selector、fee/gas/nonce、snapshot identity/status、frozen key 和写入错误；恢复入口只能按 tx hash + frozen params 补录，不得重新签名或重新广播。
- `snapshot stale`：禁止直接 revoke，提示重新扫描；用户 acknowledgement 不能把 stale snapshot 单独提升为 active truth。
- `chain mismatch`：scan、draft、estimate、submit 均阻塞并显示 expected/actual chainId。
- `spender changed / allowance already zero`：submit-time 重新读取发现 active approval 已改变或归零时，不广播；记录为 changed/alreadyRevoked 状态并提示重新扫描。
- `RPC/indexer unavailable`：保留旧 snapshot 为 stale，不推导 zero/false；scan job 显示 source unavailable 或 partial results。

**测试与验收方向**

- Rust 测试建议覆盖 scan command chainId 校验、ERC-20 allowance point read、ERC-721/1155 operator approval point read、ERC-721 token-specific `getApproved`、per-item failure isolation、stale snapshot retention、revoke submit revalidation、already zero/false blocking、history write failure recovery metadata 和 diagnostics/export redaction。
- TS/frontend 测试建议覆盖 scan read model selectors、filtering、stale/failure/unknown coverage UI、revoke button gating、draft invalidation、confirmation warnings、symbol/name 不作为 identity、batch revoke absent/gated 和 snapshot 不泄漏 secrets。
- Command 建议按任务拆分：先做 storage/read model/redaction tests，再做 read-only scan commands，再做 desktop scanner UI，再做 revoke draft/frozen confirmation，再做 revoke submit command/history/recovery，最后做 integration/security regressions。
- Doc-only 验证命令：`git diff --check`，并用 `rg` 检查 README 与本 spec 中的 P5-3 状态措辞，同时确认 P5-4/P6 没被写成已完成能力。

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

P4-1 到 P4-13 已包含诊断/恢复、ERC-20 transfer、token watchlist/balance scanning、account orchestration、native batch 和 ERC-20 batch。P4 不包含全量账户链上扫描来推导未知历史，也不包含 raw calldata、asset/allowance scanning、revoke 或 hot tx parsing。

### 10.3 P4-1 到 P4-13 诊断、恢复与交易能力基线已完成

P4-1 到 P4-13 已在主线完成，作为后续 P5/P6 探索任务的诊断、恢复和交易能力基线。当前完成范围包括原生币转账、ERC-20 转账、token watchlist/balance scanning、多账户编排、native/ERC-20 batch、历史恢复、诊断导出、dropped 复核、pending 老化和 anvil smoke 回归，不等同于通用链测试平台、raw calldata 钱包、资产授权扫描工具或 hot contract 分析工具。

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
- 对需要跨账户或跨链扫描的未知历史恢复先做设计，不在已完成的 P4-1 到 P4-13 范围内承诺。
- 继续改善 nonce 冲突、replacement underpriced、insufficient funds 等常见错误的用户指导。

### 10.5 后续 P4+ 可观测性

后续/计划：

- 在不引入远程监控服务的前提下，继续优化本地诊断事件的筛选、定位和说明。
- 为关键命令增加更细的本地失败摘要，但仍不得输出敏感材料。

### 10.6 当前能力与后续 P5/P6 扩展

当前已完成：

- ERC-20 转账：已完成最小标准 `transfer(address,uint256)` 发送闭环；最终签名/广播仍走 Rust/Tauri command，React 只表达意图和展示冻结参数。
- Token watchlist 与 ERC-20 余额扫描：已支持用户维护 token watchlist，并按 `account + chainId + token contract` 读取余额；token metadata、decimals、symbol 只能作为可验证或可回退的展示信息，不能作为合约身份。
- 多账户选择与账户编排：已提供本地账户选择器、外部地址输入、账户集合预览、余额/nonce 可用性检查和操作前冻结摘要。
- 批量分发：Native 与 ERC-20 分发已通过固定/默认 Disperse 类合约开放受控路径；recipient rows 共享 parent nonce/hash/outcome。
- 批量归集：已支持 native + ERC-20 归集，场景为部分或全部本地账户批量归集到一个指定目标账户；native 归集预留 gas，ERC-20 归集处理 token decimals、余额不足、gas 由源账户支付和部分成功状态。
- ABI 管理与调用器：ABI 可以按合约地址获取，也可以由用户导入文件或粘贴 ABI JSON。仅靠普通 RPC 通常拿不到合约 ABI；按合约地址获取 ABI 需要 explorer/indexer API 或类似数据源，并需要 chain-specific 配置、失败处理、缓存策略和敏感配置脱敏。ABI 调用器已区分 read-only call 与 write transaction，write transaction 仍由 Rust/Tauri command 签名广播。
- Raw calldata 发送：已提供面向高级用户的 calldata 预览、确认和发送路径，展示 chainId、from、to、value、calldata 摘要/长度、selector、gas/fee、nonce 和高风险确认；不得在日志、历史或诊断中记录完整敏感认证凭据、签名材料或无边界 calldata。

后续/计划：

- 资产/授权扫描：先做只读扫描设计，覆盖 token/NFT/allowance 等资产与授权视图；revoke 属于交易工作流，必须走同样的 Intent/Submission/ChainOutcome、Rust 签名广播和安全确认。
- Hot 交易逆向解析：入口至少支持交易 hash 和合约地址。tx hash 入口依赖 RPC/explorer 能取回交易、receipt、logs 和相关合约 metadata，用于解析已发生交易的 to、value、input selector、事件和 outcome；contract address 入口依赖 explorer/indexer、ABI/selector 数据库或采样交易数据，用于分析热门 selector、交互模式和风险提示。两者都存在数据源缺失、代理合约、未验证合约、selector 冲突和链特异性边界，不能把推断结果展示为确定事实。

后续/计划能力尚未作为当前 v1 可用能力承诺。

## 11. 验收原则

- 不破坏 RPC chainId 匹配、`account + chain` 状态隔离、pending 历史恢复和敏感信息隔离。
- 不把浏览器版本重新设为主线。
- 新功能必须明确属于当前已实现、后续/计划或非目标，不能在文档和 UI 中混淆。
- 涉及交易提交、replace/cancel、reconcile 的改动必须覆盖关键状态迁移和错误路径。
