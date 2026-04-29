# EVM Wallet Workbench P3/P4 后续执行计划

> 面向 subagent-driven-development：本文件同时保留 P3、P4-1 到 P4-13、P5-1 到 P5-3 的完成记录，以及 P5-4/P6 backlog。只有标记为未完成、探索或后续计划的条目表示待执行任务，不代表能力已经完成；后续任务仍由 controller 按任务串行派发和收口。

## 1. 基线与方向

- 基线：从当前已合并到 `main` 的 EVM Wallet Workbench v1（Tauri 2 技术栈）开始推进；P3、P4-1 到 P4-13、P5-1、P5-2 和 P5-3 已完成。
- 主线：后续产品、测试、发布和技术债治理都以 Tauri desktop app 为准。
- 非主线：浏览器版只作为历史参考或迁移来源，不继续投入功能补齐。
- 已有 v1 能力：vault/mnemonic、账户派生与链上扫描、RPC 验证和 app-config、native transfer draft/submit、ERC-20 transfer、token watchlist/ERC-20 balances、account orchestration、native batch、ERC-20 batch、ABI management、ABI read/write caller、raw calldata sender/preview、native transfer fee reference/base fee customization、pending history/reconcile、replace/cancel、anvil smoke check。
- 后续重点：P5-4+ 按 spec/design -> 最小实现 -> 扩展能力的顺序推进，不把资产/授权扫描、revoke、tx hash 逆向解析或 hot contract 分析列入当前能力。

## 2. 执行规则

- 每个任务按 `implementer -> spec reviewer -> code quality reviewer` 串行执行。
- implementer 只完成当前任务范围内的文件修改，不顺手实现后续任务。
- subagent 不提交 commit、不 push。
- spec reviewer 检查实现是否符合 `docs/specs/evm-wallet-workbench.md`、本计划验收标准和非目标。
- code quality reviewer 检查可维护性、测试覆盖、风险路径和是否误改无关代码。
- 每个任务收口后由 controller 执行一次 commit + push。
- 每个里程碑完成后由 controller 合并到主线。
- 同一时间可能有其他 agent 在代码库工作；每个任务开始前必须检查工作区状态，不还原他人改动。
- 只改 Markdown 的任务至少运行 `git diff --check`；涉及前端/Rust 代码的任务按任务卡建议命令验证。
- 如果任务新增测试文件不在建议命令覆盖路径内，验证命令必须额外包含新增测试文件或对应目录。

## 3. 领域约定

- Chain 的稳定身份是 `chainId`。RPC URL 只是访问端点，不能作为 chain 身份，也不能覆盖远端探测到的 `chainId`。
- `pending` 当前语义：交易已广播并进入本地追踪，但尚未看到终态 receipt，也未被判定为 replaced、cancelled 或 dropped。
- Intent 与 Submission 必须区分：
  - Intent 是用户在 UI 中表达的意图输入，例如接收地址、金额、费用偏好、目标链和目标账户。
  - Submission 是确认时冻结并交给 Rust 提交的最终参数，例如不可变 draft key、最终 `chainId`、from、to、value、nonce、gas/fee 参数和 tx hash。
- ChainOutcome 表示 reconcile 或链上 receipt 得出的结果，包括 pending、confirmed、failed、replaced、cancelled、dropped。
- replace/cancel 必须绑定现有 pending submission，沿用原 `chainId`、account/from 和 nonce；cancel 使用同 nonce 向自身发送 0 值交易。
- 原生币转账 fee reference：draft build 从 latest block 读取 `baseFeePerGas`，支持用户覆盖 base fee 假设值、编辑 multiplier 和 priority fee，并在 max fee override 为空时按 `baseFeePerGas * multiplier + priority fee` 自动计算最终 max fee；Rust command 接口仍只接收最终 gas/fee 字段。

## 4. 里程碑划分

### P3: History UX Hardening（已完成并合并）

目标是把 v1 的基础历史列表升级为可审计、可解释、可恢复的交易历史工作流。P3 不扩展 ERC-20、ABI 调用、批量发送等大能力，优先把原生币转账、replace/cancel 和 reconcile 的用户体验做稳。

建议完成顺序：

1. 历史 schema 差距盘点与最小字段契约
2. 历史数据读取模型与分组 selector
3. 历史过滤和分组 UI
4. Intent / Submission / ChainOutcome 三层详情
5. replace/cancel 关系和 nonce 线程展示
6. 错误分类、文案和状态可见性
7. 适用动作入口与 gating 测试
8. P3 回归测试与文档收口

### P4: Recovery, Observability, and Focused Extensions（P4-1 到 P4-13 已完成）

目标是在 P3 稳定历史体验之后，补强诊断、恢复和少量明确依赖 P3 的能力。P4-1 到 P4-7 已完成诊断事件、诊断导出、历史恢复、广播补录、dropped 复核、pending 老化和 anvil smoke 回归。P4-8 到 P4-13 已完成 ERC-20 transfer、token watchlist/ERC-20 balances、account orchestration、native batch 和 ERC-20 batch。后续 P5/P6 任务仍必须先做 spec/design 和历史模型契约收口，再拆最小实现；任何实现任务都不得绕过 Rust/Tauri command 签名广播边界。

### P4+ 已收口: Native transfer fee reference / base fee customization

**目标**

为 Tauri 主线原生币转账 draft 增加可审计的 EIP-1559 fee reference 控制，让用户能看见 latest base fee reference、调整用于构建交易的 base fee 假设值和 multiplier，并在必要时显式覆盖最终 max fee。

**完成范围**

- Transfer 面板展示并可编辑 Base fee (gwei)、Base fee multiplier、Priority fee (gwei) 和可选 Max fee override (gwei)。
- Build Draft 从当前 RPC latest block 读取 `baseFeePerGas`；Base fee 为空时回填 latest value，latest block 不提供 base fee 且用户未输入时阻止 build。
- Priority fee 留空时使用 `provider.getFeeData().maxPriorityFeePerGas`，缺失时沿用 `1_500_000_000` wei fallback。
- Max fee 默认按 `baseFeePerGas * baseFeeMultiplier + maxPriorityFeePerGas` 自动计算；override 非空时才使用用户输入作为最终 `maxFeePerGas`，自动值不写回 override 输入。
- Confirmation 展示 latest base fee reference、base fee used、multiplier、priority fee、最终 max fee、gas/total cost 和 frozen key。
- Draft frozen key 覆盖 base fee、multiplier、priority fee、max fee override、nonce、gas、to、amount、chain/RPC/from 变化；最终提交 Rust 的字段保持既有接口。
- 高风险判断保留 max fee、priority fee、gas limit 规则，并新增 base fee used 超过 latest base fee reference 3 倍时的二次确认。

**安全边界**

- React、日志、history 和文档示例仍不得包含助记词、私钥、raw signed tx 或敏感 RPC 凭据。
- Base fee customization 只改变本地交易构建假设值，不改变链上协议 base fee。

## 5. P3 任务卡（历史记录，状态：已完成）

### Task P3-0: 历史 schema 差距盘点与最小字段契约

**目标**

在 UI hardening 之前先确认历史持久化与 Tauri command 返回模型能支撑 P3 展示，形成稳定数据契约；必要时做最小 additive 字段适配，并保证旧 EVM Wallet Workbench v1 历史文件可读取。

**改动范围**

- 盘点现有 Rust history 模型、序列化/反序列化逻辑、前端 TypeScript 类型和测试 fixture。
- 明确 P3 所需最小字段：Intent 输入快照、Submission 冻结参数、tx hash、广播时间、ChainOutcome、receipt 摘要、终态时间、reconcile 摘要、错误摘要、nonce 线程关系。
- 若现有字段不足，优先以 additive schema 补齐；旧记录缺失字段时使用 legacy/unknown/null 显示契约。
- 更新前端类型和 Tauri command 类型映射，使后续 selector 与详情 UI 依赖稳定契约。
- 增加 Rust 和 TypeScript 测试覆盖旧记录、新记录和混合记录。

**非目标**

- 不迁移 vault 格式。
- 不重写整个 storage 层。
- 不引入云同步或数据库。
- 不实现历史详情 UI 或恢复动作。

**验收标准**

- v1 历史文件样例可以读取，缺失字段显示为 legacy/unknown/null，而不是崩溃。
- 新提交记录包含 P3 UI 所需的三层信息，或明确记录该字段当前不可得。
- 历史写入失败仍能把 tx hash 和本地写入错误清楚返回给 UI。
- pending 恢复仍从持久化历史中计算，不退回内存状态。
- 后续 P3-1/P3-3 可以基于稳定类型契约实现，不需要各自临时猜字段。

**建议测试/验证命令**

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm test -- src/core/history`
- `npm run typecheck`
- `git diff --check`

**风险点**

- 持久化模型变更有数据兼容风险，应优先 additive schema。
- 不应把 RPC URL 当作 chain identity 写入关系 key。
- 不应为补齐 UI 而编造历史中不存在的用户意图输入。

### Task P3-1: 历史读取模型与分组 selector

**目标**

基于 P3-0 的稳定数据契约，为历史记录建立前端可复用的读取/分组模型，让后续 UI 能稳定按 `account + chainId + nonce` 聚合交易，并能区分普通提交、replace 和 cancel。

**改动范围**

- 新增或调整前端 selector/helper，输出按 account、`chainId`、status、nonce 的过滤和分组结果。
- 明确分组 key 使用 `account + chainId + nonce`，不使用 RPC URL。
- 补充 selector 单元测试，覆盖 pending、confirmed、failed、replaced、cancelled、dropped 以及同 nonce 多 submission。

**非目标**

- 不改交易提交行为。
- 不新增历史详情 UI。
- 不改变链上 reconcile 判定策略。
- 不再临时扩展历史 schema；若 P3-0 后仍发现契约缺口，应回到 P3-0 补充或开独立修正任务。

**验收标准**

- 给定多账户、多链、多 nonce 的历史样例时，分组结果稳定且不串链。
- 同一 `account + chainId + nonce` 下的原提交、replace、cancel 能被聚合到同一线程。
- RPC URL 变化不会改变历史记录的链身份。
- 单元测试覆盖核心状态和混合链场景。

**建议测试/验证命令**

- `npm test -- src/core/history`
- `npm run typecheck`
- `git diff --check`

**风险点**

- 即使存在 legacy/unknown 字段，selector 也必须输出稳定结构，避免组件层到处写兼容分支。
- 前端 selector 不应偷偷修正 Rust 历史语义，避免状态来源变得不清晰。

### Task P3-2: 历史过滤与分组 UI

**目标**

把历史列表升级为可筛选、可扫描的工作台视图，支持按账户、chain、状态、nonce 或线程查看记录。

**改动范围**

- 更新 HistoryView 或相邻组件。
- 增加 account、chainId、status、nonce/thread 过滤控件。
- 在列表中显示清晰的 chainId、账户、nonce、状态、tx hash 摘要和更新时间。
- 使用 P3-1 selector 的输出，不在组件中重复实现复杂分组逻辑。
- 增加前端组件测试。

**非目标**

- 不实现完整详情抽屉或弹窗。
- 不实现恢复动作。
- 不新增 ERC-20 或合约调用历史类型。

**验收标准**

- 用户可以只看某账户、某 chainId、某状态或某 nonce 线程。
- 列表能区分 pending、confirmed、failed、replaced、cancelled、dropped。
- chain 展示以 `chainId` 为稳定身份，RPC URL 只作为端点信息出现在必要位置。
- 空状态、无匹配结果、加载/错误状态都有可理解展示。

**建议测试/验证命令**

- `npm test -- src/features/history`
- `npm run typecheck`
- `git diff --check`

**风险点**

- 筛选控件过多会挤压桌面布局，需要保持工作台密度但避免信息重叠。
- status 文案必须与 spec 状态语义一致，不能把 dropped 说成链上失败。

### Task P3-3: Intent / Submission / ChainOutcome 三层详情

**目标**

基于 P3-0/P3-1 的稳定数据契约，为单笔交易或 nonce 线程提供详情视图，把用户意图输入、最终冻结提交参数和链上结果分开展示，减少只看到 hash 时的审计盲区。

**改动范围**

- 新增历史详情组件或详情面板。
- 展示 Intent：用户选择的账户、chainId、接收地址、金额、费用输入/偏好。
- 展示 Submission：冻结的最终参数、draft key、nonce、gas/fee、tx hash、广播时间。
- 展示 ChainOutcome：当前状态、receipt 摘要、确认/失败/替换/取消/丢弃时间、reconcile 摘要。
- 对 legacy/unknown/null 字段使用 P3-0 定义的显示契约，不在 UI 中猜测缺失数据。
- 补充组件测试和展示样例。

**非目标**

- 不改变 submit API。
- 不实现手动补录或重新广播。
- 不展示助记词、私钥、签名原文等敏感材料。

**验收标准**

- 详情视图清楚区分 Intent 和 Submission，用户能看出“输入过什么”和“最终提交了什么”。
- pending 详情体现“已广播并进入本地追踪”的当前语义。
- confirmed/failed/replaced/cancelled/dropped 的 outcome 解释与 spec 一致。
- 敏感信息不会进入 UI、日志或测试快照。

**建议测试/验证命令**

- `npm test -- src/features/history`
- `npm run typecheck`
- `git diff --check`

**风险点**

- v1 历史记录可能没有完整保存 Intent 字段，需要沿用 P3-0 的 unknown/legacy 契约，而不是编造数据。
- 详情视图不能把用户输入和链上事实混成同一层。

### Task P3-4: replace/cancel 关系与 nonce 线程展示

**目标**

让同一 nonce 下的普通提交、replace、cancel 和最终结果形成一条可审计线程，帮助用户理解哪个 hash 取代了哪个 hash。

**改动范围**

- 在历史列表或详情中增加 nonce thread 展示。
- 明确显示原 pending submission、后续 replacement/cancel submission、最终 ChainOutcome。
- 对 cancel 显示“同 nonce 向自身发送 0 值交易”的模型说明。
- 增加针对多次 replace、cancel 后确认、原交易 dropped 等场景的测试。

**非目标**

- 不新增 replace/cancel 提交能力。
- 不修改 nonce 分配策略，除非仅为 UI 关系字段做兼容读取。
- 不做 mempool 深度分析。

**验收标准**

- 同一 `account + chainId + nonce` 的相关记录能稳定连成线程。
- replaced 与 cancelled 在视觉和文案上有明确区分。
- 用户能看出当前可操作对象是哪一笔 pending submission。
- 多链同 nonce 不会被错误合并。

**建议测试/验证命令**

- `npm test -- src/core/history src/features/history`
- `npm run typecheck`
- `git diff --check`

**风险点**

- 如果历史模型缺少 parent/replacedBy 关系，需要先用稳定 key 推导；若仍不足，应回到 P3-0 补充字段契约或开独立修正任务。
- 多次 replacement 的时间排序必须可靠，不能只按 hash 排序。

### Task P3-5: 交易错误分类、文案和状态可见性

**目标**

把常见错误状态分类并展示为稳定、可理解、不可误导的错误摘要，让 pending 卡住、广播成功但历史写入失败、RPC 错误、chainId 不匹配、nonce 冲突等情况有清晰状态可见性。

**改动范围**

- 梳理现有 Rust/前端错误模型。
- 定义错误分类，例如 RPC、history、nonce、broadcast、reconcile、chain identity。
- 在 HistoryView/详情中增加错误摘要、状态解释和最近失败记录展示。
- 对长时间 pending、dropped、history write failed、chainId mismatch 等状态提供解释性提示。
- 对本地历史不可读、历史写入失败、RPC 不可用、chainId 不匹配提供明确错误文案。
- 补充单元测试或组件测试覆盖错误分类和文案。

**非目标**

- 不实现复杂自动恢复策略。
- 不新增 reconcile、replace、cancel、手动复核等动作入口；这些由 P3-6 或 P4 处理。
- 不绕过“提交前必须能读取本地历史”的安全边界。
- 不在前端保存或展示敏感签名材料。

**验收标准**

- 用户能从错误卡片或详情中知道错误来源属于 RPC、history、nonce、broadcast 还是 reconcile。
- `replacement underpriced`、`insufficient funds`、nonce conflict 等常见错误有对应解释。
- chainId mismatch 明确指出稳定身份是 chainId，RPC URL 只是端点。
- dropped 明确展示为本地 reconcile 判定的终态丢弃，不等同于链上 failed。
- 文案只描述当前状态和下一步建议，不承诺尚未实现的自动修复。

**建议测试/验证命令**

- `npm test -- src/features/history`
- `npm run typecheck`
- `git diff --check`

**风险点**

- 错误文案不能承诺系统尚未实现的自动修复。
- 错误摘要不能包含助记词、私钥、签名材料或完整敏感请求体。

### Task P3-6: 适用动作入口与 gating 测试

**目标**

在 P3-5 的错误分类基础上，为确实适用的状态提供动作入口，并用 gating 测试防止错误状态开放错误动作。dropped 在 P3 只允许提示复核建议；真正的手动复核/重新 reconcile 动作留到 P4。

**改动范围**

- 在 HistoryView/详情中为 pending 且符合条件的 submission 显示 reconcile、replace、cancel 入口或入口提示。
- 为 history write failed、RPC unavailable、chainId mismatch、nonce conflict 等状态定义可显示动作和禁用原因。
- 对非 pending、已终态、跨 chainId、缺少 account/from/nonce 的记录隐藏或禁用不适用动作。
- dropped 仅展示“可在 P4 复核/重新 reconcile”的提示，不实现真实复核动作。
- 补充组件测试或 helper 测试，覆盖动作显示、禁用原因和 gating 矩阵。

**非目标**

- 不实现 dropped 手动复核或重新 reconcile。
- 不新增前端广播出口。
- 不改变 replace/cancel 的 Rust 安全约束。
- 不实现复杂自动恢复策略。

**验收标准**

- 只有符合现有安全约束的 pending submission 才出现 replace/cancel 入口。
- reconcile 入口或提示只对可追踪记录出现，缺少 chainId/account/hash 时给出禁用原因。
- dropped 在 P3 没有真实复核按钮，只显示后续能力提示。
- gating 测试覆盖 pending、confirmed、failed、replaced、cancelled、dropped、chainId mismatch、history write failed。

**建议测试/验证命令**

- `npm test -- src/features/history src/core/history`
- `npm run typecheck`
- `git diff --check`

**风险点**

- 动作入口必须复用现有安全路径，不能新增前端广播出口。
- 禁用原因要解释清楚，但不能把未实现能力伪装成可用功能。

### Task P3-7: P3 回归测试与文档收口

**目标**

在 P3 功能任务完成后做一次集中回归，确保历史 UX、状态语义、错误恢复入口和安全不变量一致，并更新必要文档。

**改动范围**

- 补齐缺失的前端单元/组件测试。
- 补齐 Rust 历史/reconcile/transaction 相关测试。
- 运行 anvil smoke check，确认 native transfer 到 pending/reconcile 的闭环仍可用。
- 更新 README 或 spec 附近的用户可见说明，但不改写已确认的项目级 spec 语义。

**非目标**

- 不新增 P4 能力。
- 不做大规模 UI redesign。
- 不重构与 P3 无关的旧组件。

**验收标准**

- P3 核心用户路径：查看历史、筛选、打开详情、理解 replace/cancel、看到错误恢复入口。
- 安全不变量仍成立：Rust 负责签名广播，React 不接触助记词/私钥，chainId 匹配不可绕过。
- anvil smoke check 通过，或失败原因被记录为环境问题并可复现。
- 文档没有把 P4 能力写成已完成。

**建议测试/验证命令**

- `npm test`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `scripts/run-anvil-check.sh`
- `git diff --check`

**风险点**

- 回归任务容易扩大范围，发现的非阻断问题应进入 P4 或 bug backlog。
- anvil 环境依赖可能导致非代码失败，需要记录版本和启动方式。

## 6. P4 任务卡

### Task P4-1: 诊断事件与本地结构化日志（状态：已完成，commit `85d5f10`）

**目标**

为 RPC 探测、交易提交、历史写入、reconcile 等关键路径产出本地非敏感诊断事件，作为后续诊断面板、导出和恢复任务的基础。

**已完成范围**

- 本地结构化诊断事件基线。
- 关键路径的阶段、错误分类和排障摘要。
- 敏感信息排除约束：不记录助记词、私钥、seed、明文密码、签名材料或 raw signed transaction。

**后续注意**

- P4-1 不是完整诊断 UI，不提供导出入口。
- 后续任务只能消费或扩展非敏感诊断事件，不能放宽敏感信息约束。

### Task P4-2: 诊断面板/导出（状态：已完成）

**目标**

基于 P4-1 的本地结构化日志，在 Tauri desktop UI 中提供诊断查看与导出能力，帮助用户排查 RPC、chainId、history、nonce、broadcast、reconcile 问题，同时确保导出内容只包含非敏感信息。

**改动范围**

- 新增或扩展诊断面板入口，展示近期诊断事件、事件分类、时间、chainId、account/address 摘要、nonce、tx hash、阶段和错误摘要。
- 增加事件过滤：按类别、时间、chainId、account、tx hash 或状态筛选。
- 提供本地导出功能，导出前展示导出范围和敏感信息排除说明。
- Rust/Tauri command 只返回脱敏后的诊断事件；前端不自行读取原始日志文件。
- 补充脱敏、导出、空状态、读取失败和权限失败测试。

**非目标**

- 不新增远程上报、云同步或自动上传。
- 不导出 vault、app-config 原文、历史文件原文或完整 RPC URL secret。
- 不实现历史损坏修复、补录或 dropped 复核；这些分别属于 P4-3、P4-4、P4-5。
- 不让诊断日志成为交易状态真相来源。

**验收标准**

- 用户能在 UI 中查看近期非敏感诊断事件并按常见维度过滤。
- 导出文件不包含助记词、私钥、seed、明文密码、签名材料、raw signed transaction 或完整认证凭据。
- RPC URL 中的 token、basic auth、query secret 等在展示和导出前已脱敏。
- 诊断面板能解释事件来源，但不会把日志事件显示为链上确认事实。
- 读取或导出失败时有明确错误摘要，不崩溃、不吞错。

**建议测试/验证命令**

- `npm test -- src/features/diagnostics src/core/diagnostics`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml diagnostics`
- `git diff --check`

**风险点**

- 最大风险是误导出敏感信息；测试应包含带 token 的 RPC URL、长错误消息和伪签名材料样例。
- 大量日志可能影响 UI 性能，应限制默认读取窗口或分页。
- 导出路径和文件权限错误要走用户可理解的错误路径。

### Task P4-3: 历史文件损坏恢复（状态：已完成）

**目标**

当已有 tx history 文件不可读、JSON 损坏、schema 不兼容、权限/IO 错误或部分记录异常时，提供可审计的检测、隔离和恢复路径；历史不可读时仍必须阻止新交易盲目广播。

**改动范围**

- 在 Rust history 读取层增加损坏类型分类：权限错误、IO 错误、JSON 解析失败、schema 不兼容、部分记录无效。
- `NotFound` 仍应按首次运行/空历史处理，除非后续新增 sentinel/manifest 能证明历史文件缺失代表数据丢失。
- 对损坏历史提供只读诊断摘要和隔离建议，必要时将原文件移动或复制为带时间戳的隔离副本。
- UI 展示损坏状态、影响范围、可执行恢复动作和禁用原因。
- 恢复动作至少覆盖：重新尝试读取、隔离损坏文件并启动空历史、从隔离副本查看诊断摘要。
- 交易提交前继续强制读取历史；历史不可读时 submit/replace/cancel 必须被禁用或拒绝。
- 补充 Rust storage 测试和前端状态/gating 测试。

**非目标**

- 不从链上全量重建未知历史。
- 不自动删除用户原始历史文件。
- 不修改 vault 格式或 app-config 格式。
- 不绕过 pending nonce 恢复约束来允许提交。

**验收标准**

- 损坏历史文件不会导致应用崩溃，用户能看到明确错误分类和恢复建议。
- tx-history 文件不存在时按 empty history 读取，不展示为损坏恢复流程。
- 原损坏文件在任何破坏性恢复前被保留为可审计副本。
- 历史不可读时，新普通转账、replace、cancel 不能广播。
- 恢复为空历史后，UI 明确说明本地历史已重建且旧文件已隔离，不伪造旧记录。
- 诊断事件记录损坏类型和恢复动作，但不记录敏感材料。

**建议测试/验证命令**

- `cargo test --manifest-path src-tauri/Cargo.toml history`
- `npm test -- src/features/history src/core/history`
- `npm run typecheck`
- `git diff --check`

**风险点**

- 恢复为空历史会影响 nonce 预留，需要强提示并重新依赖链上 nonce。
- 文件移动/复制在不同平台路径和权限下可能失败，应有可恢复错误。
- 部分记录损坏时要避免静默丢弃有效记录，除非用户明确选择隔离或重建。

### Task P4-4: 广播成功但历史写入失败补录（状态：已完成）

**目标**

为“交易已广播并返回 tx hash，但本地历史写入失败”的场景提供补录入口，使用户能把已知提交恢复进本地历史，而不是只靠错误消息手工记忆。

**改动范围**

- 扩展错误/诊断模型，确保广播成功但写入失败时保留 tx hash、chainId、account/from、nonce、to、value、fee 摘要、广播时间和写入错误。
- 在 UI 中为该错误状态提供补录入口，展示待补录参数和风险提示。
- Rust command 根据 tx hash 与 chainId 查询 receipt 或交易详情，并生成本地 history record。
- 补录必须使用已知 frozen submission 参数；无法确认的字段显示 unknown/legacy，不能编造 Intent。
- 补录后触发或提示 reconcile，更新 ChainOutcome。
- 补充测试覆盖写入失败模拟、补录成功、链上查无交易、字段不足、重复补录。

**非目标**

- 不重新签名或重新广播交易。
- 不做全链历史扫描。
- 不允许前端构造签名材料或绕过 Rust submit 路径。
- 不把补录入口用于普通手工导入任意历史，除非另开设计任务。

**验收标准**

- 广播成功但写入失败时，用户能看到 tx hash 和本地写入失败原因。
- 补录入口只在具备 chainId、account/from、nonce、tx hash 等最低字段时开放，否则显示禁用原因。
- 重复补录同一 `account + chainId + nonce + tx hash` 不会产生重复 submission。
- 链上查无交易时不会写入 confirmed/failed，只保留可解释的 pending 或补录失败结果。
- 补录流程产生诊断事件，并遵守敏感信息排除约束。

**建议测试/验证命令**

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm test -- src/features/history src/core/history`
- `npm run typecheck`
- `scripts/run-anvil-check.sh`
- `git diff --check`

**风险点**

- 需要区分“历史没写成”和“交易没广播成”，不能把失败交易补录为 pending。
- 补录字段不足时最容易误造审计信息，应沿用 unknown/legacy 契约。
- 重复补录和 replacement/cancel thread 关系需要保持稳定。

### Task P4-5: dropped 复核与重新 reconcile（状态：已完成）

**目标**

对已被本地判定为 dropped 的记录提供人工复核和重新 reconcile 能力，允许用户在 RPC 状态变化、节点切换或延迟 receipt 出现后重新确认结果，同时保留原 dropped 判定的审计轨迹。

**改动范围**

- 为 dropped 记录增加可用性判断和复核入口。
- Rust command 基于原 submission 的 chainId、account/from、nonce、tx hash 重新查询 receipt、transaction、链上 nonce 和同 nonce 关系。
- UI 展示原 dropped 判定原因、复核时间、使用的 RPC/chainId 摘要、新结果和下一步建议。
- 复核结果以追加事件或追加 outcome 的方式保存，不能静默覆盖历史。
- 覆盖 confirmed after dropped、still dropped、replaced/cancelled after dropped、RPC unavailable、chainId mismatch 等测试。

**非目标**

- 不把 dropped 等同于链上 failed。
- 不自动循环 reconcile 所有 dropped 记录。
- 不允许修改原 submission 的 chainId、from、nonce 或 tx hash。
- 不实现 mempool 深度分析或第三方 explorer 查询。

**验收标准**

- dropped 记录出现真实复核入口，并且入口只对字段完整的记录开放。
- 重新 reconcile 后，历史能保留原 dropped 判定和新复核结果。
- 如果复核发现 receipt 成功/失败，ChainOutcome 更新清晰且可审计。
- 如果仍无法确认，状态和提示说明“不确定/仍 dropped”的原因。
- chainId mismatch 或 RPC 不可用不会导致错误改写 outcome。

**建议测试/验证命令**

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm test -- src/features/history src/core/history`
- `npm run typecheck`
- `git diff --check`

**风险点**

- 不同 RPC 对旧 tx 的可见性可能不同，复核结果必须记录使用的 chainId 和端点摘要。
- 重新 reconcile 容易破坏终态历史，应采用追加式审计模型。
- 同 nonce replacement/cancel 推断要和 P3 线程展示保持一致。

### Task P4-6: pending 老化策略（状态：已完成）

**目标**

为长时间 pending 的交易提供本地老化判定、风险提示和适用动作建议，帮助用户决定 reconcile、replace 或 cancel，但不自动替用户执行交易动作。

**改动范围**

- 定义 pending 老化阈值和状态：正常 pending、需要关注、长期未确认、可能 dropped/需要复核。
- 结合历史记录、最近 reconcile 结果、链上 nonce、tx hash 查询结果和诊断事件生成提示。
- UI 在列表和详情中显示 pending age、最近检查时间、建议动作和禁用原因。
- 对 replace/cancel/reconcile 入口复用 P3/P4 gating，不放宽 nonce 和 chainId 约束。
- 支持用户手动触发 reconcile 或查看诊断事件。
- 补充 selector/helper、组件和 Rust reconcile 测试。

**非目标**

- 不自动 replace/cancel。
- 不根据单次 RPC 失败直接判定 dropped。
- 不新增 gas 策略优化器。
- 不改变现有 replace/cancel 交易模型。

**验收标准**

- pending 记录能显示可理解的等待时长和最近 reconcile 状态。
- 老化提示不会把 pending 误称为 failed。
- 建议动作与实际可执行状态一致；不可执行时展示禁用原因。
- 老化策略跨重启仍基于持久化历史和时间戳计算。
- 测试覆盖不同年龄、RPC 失败、链上 nonce 推进、同 nonce replacement/cancel 场景。

**建议测试/验证命令**

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm test -- src/features/history src/core/history`
- `npm run typecheck`
- `git diff --check`

**风险点**

- 时间阈值过激会误导用户取消正常 pending 交易，应先保守提示。
- RPC 节点差异会影响 tx 可见性，提示文案要表达不确定性。
- UI 容易把建议动作做得像自动修复，必须保持用户确认。

### Task P4-7: anvil smoke check 诊断增强与 P4 回归（状态：已完成）

**目标**

增强 anvil smoke check 的失败摘要，并在 P4-2 到 P4-6 完成后做一次集中回归，确认诊断、恢复、补录、dropped 复核和 pending 老化不破坏核心交易安全不变量。

**改动范围**

- 扩展 anvil smoke check 输出，区分环境启动失败、RPC/chainId 失败、vault/session 失败、签名/广播失败、历史写入失败、reconcile 失败。
- 将 smoke check 关键阶段接入非敏感诊断事件或读取已有事件摘要。
- 增加失败时的最小复现信息和本地路径提示，但不输出敏感材料。
- 执行 P4 回归清单，覆盖 P4-2 到 P4-6 的关键路径。
- 更新必要的 spec/plan 状态说明：P4-8 到 P4-13 已完成，P5-3 已完成，P5-4/P6 仍为计划/后续能力。

**非目标**

- 不把 anvil smoke check 做成通用链测试平台。
- 不引入外部监控服务。
- 不新增 ERC-20、ABI、批量发送功能。
- 不改 README，除非 controller 明确要求或 smoke check 使用方式已经改变。

**验收标准**

- anvil smoke check 失败时能明确落到环境、RPC、chainId、vault/session、签名/广播、history 或 reconcile 分类。
- 成功路径仍覆盖本地 native transfer 到 pending/reconcile 的闭环。
- P4-2 到 P4-6 的安全不变量回归通过。
- 诊断输出和导出不包含敏感材料。
- 文档状态准确：P4-1 到 P4-13 按实际完成情况标记，P5-3 已完成，P5-4/P6 仍为计划/后续能力。

**建议测试/验证命令**

- `npm test`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `scripts/run-anvil-check.sh`
- `git diff --check`

**风险点**

- anvil 环境依赖本机工具和端口状态，失败摘要要区分环境问题与代码回归。
- 回归任务容易扩大范围，非阻断问题应进入后续 backlog。
- smoke check 可能读取真实本地路径，输出前仍需做路径和端点最小化。

## 7. P4+/P5/P6 交易能力路线

本路线同时保留已完成任务记录和后续 P5/P6 backlog。只有标记为计划/待做/后续的任务不属于当前已完成能力。controller 若要推进待做任务，仍按 `implementer -> spec reviewer -> code quality reviewer` 串行派发；subagent 不提交、不 push；controller 在每个任务收口后 commit + push，并在每个里程碑完成后 merge。所有任务都必须保持 Tauri desktop 为主线，最终签名/广播走 Rust/Tauri command，React 不接触助记词、私钥或 raw signed tx。

### 7.1 建议里程碑顺序

1. P4-8 ERC-20 转账 spec/design（已完成）。
2. P4-8a typed transaction intents/history schema contract（已完成）。
3. P4-8b ERC-20 draft/metadata read model（已完成）。
4. P4-8c Rust submit command + UI + tests for minimum ERC-20 transfer（已完成）。
5. P4-9 token watchlist/ERC-20 余额扫描（已完成）。
6. P4-10 多账户选择器与账户编排基础（已完成）。
7. P4-11 批量分发/归集 spec（已完成）。
8. P4-12 batch native 分发/归集（已完成）。
9. P4-13 batch ERC-20 分发/归集（已完成）。
10. P5-1 ABI 管理 fetch/import/paste/cache（已完成）。
11. P5-2 ABI read/write 调用器（已完成）。
12. P5-3 raw calldata 发送与预览（已完成）。
13. P5-4 资产/授权扫描与 revoke 工作流（后续，先 P5-4a doc-only，再拆实现/测试）。
14. P6-1 tx hash 逆向解析（后续）。
15. P6-2 contract address hot 交易/selector 分析（后续）。

### 7.2 Task P4-8: ERC-20 转账 spec/design（本任务仅文档设计）

**目标**

完成 ERC-20 转账的产品 spec、历史模型设计和实现拆分方案，作为后续最小实现任务的输入。本任务只改文档，不实现 ERC-20 发送代码。历史记录说明：本任务执行时真实可用交易类型仍只有 native transfer；当前主线已在 P4-8c 完成 ERC-20 最小发送。

**改动范围**

- 更新项目 spec 中 ERC-20 转账的目标、非目标、安全边界和验收原则。
- 设计 typed transaction intent 方向，例如 `transaction_type` / enum union：`legacy`、`nativeTransfer`、`erc20Transfer`，并说明旧记录兼容。
- 设计 ERC-20 Intent/Submission/ChainOutcome 扩展：token contract、recipient、amount raw、decimals、symbol/name metadata source、calldata selector、method name、native value wei、nonce、gas/fee、tx hash、receipt/log 摘要和失败原因。
- 设计 Rust/TypeScript 类型演进方案，明确当前 `HistoryRecord.intent` 仍是 `NativeTransferIntent`，`SubmissionKind` 当前只有 legacy/nativeTransfer/replacement/cancellation；后续需要新增 ERC-20 普通提交或 additive extension，并保持 replacement/cancellation 语义清晰。
- 设计 draft/freeze/submit 工作流：React 表达 ERC-20 转账意图和展示冻结参数，Rust command 负责 calldata 构建、签名、广播和历史写入。
- 设计 token metadata 与 decimals 获取策略：稳定身份是 `chainId + tokenContract`，`symbol/name/decimals` 只是 metadata；decimals 影响 amount 解析，必须在 draft 中冻结。
- 设计 ERC-20 contract call 展示规则：transaction `to` 是 token contract，recipient 是 calldata 参数；history UI 不能混淆二者。
- 设计错误和恢复路径：chainId mismatch、metadata call failure、decimals missing/changed、token balance insufficient、native gas insufficient、estimate gas failure、receipt reverted/failed、history write failed、replacement/cancel relationship。
- 设计测试计划和最小实现拆分：先支持单 token、单 sender、单 recipient、标准 `transfer(address,uint256)`。

**非目标**

- 不实现 ERC-20 发送代码。
- 不实现批量分发/归集。
- 不实现 token watchlist UI 或全账户余额扫描。
- 不实现 allowance/approve、permit、fee-on-transfer 特判、ABI 调用器、raw calldata、资产/授权扫描或 hot 交易解析。
- 不新增前端签名、广播或 raw signed tx 出口。

**验收标准**

- 文档在历史语境中明确 P4-8 只是 spec/design；当前状态以 P4-8c 已完成为准。
- 后续实现代理能根据任务卡直接拆出最小实现，不需要重新猜历史模型或安全边界。
- ERC-20 交易类型与 native transfer、replacement、cancellation 的关系清楚，旧历史记录兼容策略清楚。
- 设计明确 `chainId + tokenContract` 是稳定 token 身份，symbol/name/decimals 只是 metadata；decimals 必须随 draft 冻结。
- 设计明确 ERC-20 transfer 的 transaction `to` 是 token contract，recipient 是 calldata 参数，history UI 不能混为一谈。
- 设计覆盖 metadata/decimals 获取失败、decimals changed、token 余额不足、native gas 不足、estimate gas 失败、receipt failed/reverted、history write failed、chainId mismatch 等关键路径。
- 敏感信息边界明确：日志、诊断、历史、导出不包含助记词、私钥、raw signed tx、完整 RPC token 或 explorer API key。

**建议测试/验证命令**

- 只改 Markdown 时运行 `git diff --check`。
- 若任务意外涉及 TypeScript 类型草案或测试 fixture，应补充 `npm run typecheck` 和对应 `npm test -- <path>`。
- 若任务意外涉及 Rust 类型草案，应补充 `cargo test --manifest-path src-tauri/Cargo.toml`。

**风险点**

- 容易把 spec/design 写成已实现承诺，必须始终标注为下一步或后续实现。
- ERC-20 metadata 不可信，合约地址和 chainId 才是稳定身份。
- 不能为了预览 calldata 把签名材料或 raw signed tx 暴露给 React。
- 历史模型迁移要保持旧 native transfer 记录可读，不能破坏 P3/P4 现有历史 UX。

### 7.3 P4-8 后续拆分建议

#### Task P4-8a: history schema/type contract for typed transaction intents（状态：已完成）

**目标**

为历史记录和前后端类型增加 typed transaction intent 契约，让 native transfer、ERC-20 transfer、replacement、cancellation 能在同一三层模型下兼容展示。

**完成记录**

- 已为 Rust history model 与 TypeScript history schema 增加 additive `transaction_type` 契约和 ERC-20 transfer 预留字段；旧记录缺失字段时仍按 legacy/nativeTransfer 读取展示。
- History selector/detail UI 已按 typed transaction 分支展示 native、ERC-20 与 unsupported/unknown；replacement/cancellation 仍由 `SubmissionKind` 与 nonce thread identity 聚合，不写成 ERC-20 发送能力。

**改动范围**

- Rust history model 和 TypeScript history 类型新增 additive `transaction_type` / enum union 设计与实现。
- 为 ERC-20 intent/submission 预留字段：token_contract、recipient、amount_raw、decimals、symbol/name metadata source、selector、method name、native value wei。
- 旧 history fixture/真实记录兼容：缺失类型时走 legacy/nativeTransfer 显示契约。
- 更新 selector/detail UI 的类型分支，未知类型显示 unsupported/unknown。

**非目标**

- 不构建 ERC-20 draft，不读取 token metadata。
- 不实现 ERC-20 签名、广播或 calldata 构建。
- 不改 vault、账户派生或 RPC 配置格式。

**验收**

- 旧 native transfer、replacement、cancellation 历史仍可读取和展示。
- 新类型契约能表达 ERC-20 transfer 的 token contract 与 recipient 区分。
- replacement/cancellation 仍按 same account + chainId + nonce 聚合，且不被当成普通 ERC-20 intent。

**验证命令**

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm test -- src/core/history src/features/history`
- `npm run typecheck`
- `git diff --check`

**风险点**

- schema 迁移必须 additive，避免破坏用户已有历史。
- UI 分支不能用 native transfer 字段猜 ERC-20 语义。
- 测试 fixture 不能包含 raw signed tx 或敏感凭据。

#### Task P4-8b: ERC-20 draft/metadata read model（状态：已完成）

**目标**

实现 ERC-20 最小转账的 draft/read model：按 `chainId + tokenContract` 读取/确认 metadata、解析 amount raw、检查 token/native balance、估算 gas，并冻结可提交参数。

**改动范围**

- 前端 ERC-20 draft 表单和确认模型，支持单 token、单 sender、单 recipient。
- Rust/Tauri 或既有只读 command 增加 metadata/balance/gas estimate 所需的只读调用，严格校验 RPC chainId。
- draft key 覆盖 chainId、sender、token contract、recipient、amount raw、decimals、fee、gas、nonce、selector/method、native value wei。
- metadata source 明确为 on-chain/cache/user-confirmed/unknown；decimals missing 或 changed 使 draft 不可提交或失效。

**非目标**

- 不签名、不广播、不写入 pending history。
- 不实现 token watchlist UI 或全账户余额扫描。
- 不支持 allowance/approve、permit、fee-on-transfer、batch 或任意 ABI。

**验收**

- ERC-20 draft 明确展示 transaction `to = tokenContract`、recipient calldata 参数、amount raw、decimals 和 metadata source。
- chainId mismatch、metadata call failure、decimals missing/changed、token balance insufficient、native gas insufficient、estimate gas failure 都有可见错误状态。
- React 不接触助记词、私钥、raw signed tx 或签名材料。

**完成记录**

- 已新增前端 ERC-20 read-only draft 表单，支持单 token、单 sender、单 recipient，并保持 Native 为默认转账模式。
- 已通过前端 `JsonRpcProvider` 读取 ERC-20 metadata/balance、native gas balance、nonce、fee reference 和 gas estimate，且在读取前校验 RPC `chainId`。
- Draft 冻结 transaction `to = tokenContract`、recipient calldata 参数、amount raw、decimals、metadata source、fee、gas、nonce、selector/method 和 native value wei。
- ERC-20 提交入口仍禁用并标注 P4-8c 启用；未实现签名、广播或 pending history 写入。

**验证命令**

- `npm test -- src/features/transfer src/core/transactions`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

**风险点**

- decimals 一旦冻结后不能被后续 metadata 读取静默改写。
- gas estimate 失败原因可能来自 RPC、余额、合约逻辑或 paused token，错误分类不能过度确定。
- metadata 不可信，symbol/name 不能参与 token 身份判断。

#### Task P4-8c: Rust submit command + UI + tests for minimum ERC-20 transfer（状态：已完成）

**目标**

在 P4-8a/P4-8b 的契约上实现最小 ERC-20 发送闭环：标准 `transfer(address,uint256)` calldata、Rust 签名广播、pending history 写入、receipt reconcile 和 UI 提交入口。

**改动范围**

- Rust/Tauri submit command 构建 selector `0xa9059cbb` calldata，最终签名/广播仍只在 Rust 侧完成。
- UI 提交按钮只发送 frozen draft intent，不接触 raw signed tx。
- history 写入 ERC-20 Intent/Submission/ChainOutcome，保存 token contract、recipient、amount raw、decimals、metadata source、selector/method、tx hash、nonce、gas/fee。
- history write failure recovery 返回 tx hash + frozen params + write error，补录不得重新签名/广播。
- replacement/cancel 沿用 same account + chainId + nonce。最小 replace 仅允许保持同 calldata/recipient/amount 并提高费用；cancel 仍是 native 0-value self-transfer。

**非目标**

- 不实现 allowance/approve、permit、fee-on-transfer 特判、batch、watchlist 扫描、ABI 调用器或 raw calldata。
- 不支持修改 ERC-20 pending 的 recipient/amount 作为 replace；后续另行设计。
- 不把浏览器版作为主线。

**验收**

- anvil 或本地测试 token 的单笔 ERC-20 transfer 可进入 pending 并 reconcile 为 confirmed 或 failed。
- transaction `to`、token contract、recipient 在 history UI 中分开展示。
- token balance insufficient、native gas insufficient、receipt reverted/failed、history write failed 都有测试或明确验证。
- 日志、诊断、历史、导出不包含助记词、私钥、raw signed tx、完整 RPC token、explorer API key 或签名材料。

**验证命令**

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm test -- src/features/transfer src/features/history src/core/history`
- `npm run typecheck`
- `scripts/run-anvil-check.sh`
- `git diff --check`

**风险点**

- 合约调用的 transaction `to` 与 recipient 容易在 UI 和历史中混淆。
- 广播成功但历史写入失败必须保留 frozen params，否则无法安全补录。
- replace/cancel 关系必须复用 nonce thread 语义，不能新分配 nonce。

### 7.4 后续任务卡 / Backlog

#### Task P4-9: token watchlist/ERC-20 余额扫描（状态：已完成，拆分入口）

- 目标：实现 token watchlist，按 `account + chainId + token contract` 扫描 ERC-20 余额，并为 ERC-20 转账 token selector、后续多账户编排、批量分发/归集提供 token 和余额来源。
- 依赖：P4-8 spec/design、P4-8a typed history contract、P4-8b ERC-20 draft/metadata read model、P4-8c 最小 ERC-20 submit。
- 关键边界：watchlist 是本地配置；token identity 是 `chainId + tokenContract`；symbol/name/decimals 只是 metadata；余额 identity 是 `account + chainId + tokenContract`；RPC 失败、合约非 ERC-20、metadata malformed、decimals missing/changed、balanceOf failure 都必须有可恢复状态。
- 当前拆分：P4-9a 先完成轻量 spec/design；P4-9b 做 storage/schema/commands；P4-9c 做 scanner/read model；P4-9d 做 UI watchlist/balances 和 ERC-20 transfer selector integration。

#### Task P4-9a: token watchlist/ERC-20 余额扫描 spec-design（状态：已完成）

**目标**

补齐 P4-9 轻量但可执行的设计，覆盖本地 watchlist、metadata cache、account balance snapshot、失败恢复、UI/UX、安全隐私和 P5/P6 边界。

**范围**

- 更新 `docs/specs/evm-wallet-workbench.md`，定义 `watchlist_tokens`、`token_metadata_cache`、`token_scan_state`、`erc20_balance_snapshots` 的职责与建议字段。
- 明确 metadata source/status、created/updated timestamps、last scan state、`balance_raw`、decimals、symbol/name、scan status、last scanned/error summary。
- 明确 metadata 优先级、decimals 不可猜、decimals missing/changed 不污染已确认 metadata。
- 明确 RPC chainId validation、non-ERC20/malformed response、metadata call failure、balanceOf failure 的可恢复状态。
- 明确 watchlist add/edit/remove、manual scan/retry、token selector、per-account balances 和失败可见性。

**非目标**

- 不实现代码、schema migration、Tauri command、scanner 或 UI。
- 不引入外部 indexer，不做 allowance/revoke/NFT/ABI/batch。

**验收**

- 下一个 implementer 能按文档独立拆 P4-9b/P4-9c/P4-9d。
- 文档不把 symbol/name/decimals 当作 token identity。
- 文档明确扫描失败不会删除 watchlist token，也不会静默覆盖 user-confirmed metadata。

**验证命令**

- `git diff --check`

**风险点**

- 设计过宽会提前吞进 P5 资产/授权扫描；本卡必须只保留 ERC-20 watchlist + balances。
- decimals 冲突如果没有来源标记，会直接影响 ERC-20 transfer amount 解析。

#### Task P4-9b: storage/schema + commands + tests（状态：已完成）

**目标**

实现 P4-9 的本地持久化契约和 Tauri command 边界，让 watchlist 配置、metadata cache、scan state、balance snapshots 可以被 UI 和 scanner 稳定读写。

**范围**

- 增加或扩展本地存储 schema：`watchlist_tokens`、`token_metadata_cache`、`token_scan_state`、`erc20_balance_snapshots`，并保持用户配置、链上 raw cache、derived read model 与扫描状态分离。
- Command/API 支持 list/add/edit/remove watchlist token、读取 metadata cache、读取 balance snapshots、更新 scan state/snapshot。
- Add/edit 校验 `chainId` 和 EVM token contract；编辑 identity 需按删除旧 token + 新增 token 处理。
- Remove token 只移除本地 watchlist 配置；是否清理 cache/snapshots 必须是显式选项或保守保留。
- `token_metadata_cache` 只保存 on-chain raw call 结果，不能保存 user-confirmed override；UI/draft 需要的 effective metadata 由 `metadata_override` + raw cache 合成。
- 统一枚举：raw metadata status 使用 `ok | missingDecimals | malformed | callFailed | nonErc20 | decimalsChanged`；resolved metadata status 在 raw metadata status 基础上增加 `sourceConflict`；balance status 使用 `ok | zero | balanceCallFailed | malformedBalance | rpcFailed | chainMismatch | stale`。
- 所有持久化错误、RPC identity、error summary 进入日志/诊断前脱敏。

**非目标**

- 不实现实际 RPC scanner。
- 不实现 watchlist/balances UI。
- 不写交易历史，不改签名广播路径。
- 不引入 browser 版主线能力或外部 indexer。

**验收**

- Storage 能表达 `chainId + tokenContract` token identity 和 `account + chainId + tokenContract` balance identity。
- `created_at`、`updated_at`、metadata source/status、last scan timestamps、last error summary 均可读写。
- 扫描状态更新不会覆盖用户配置；失败 snapshot 不会把旧成功余额写成 0。
- 用户确认 decimals 必须保存 `source = userConfirmed` 和确认时间。
- user-confirmed metadata 只存在于 `watchlist_tokens.metadata_override`；`token_metadata_cache` 中不存在 `userConfirmed` 或 `watchlistCache` source。

**验证命令**

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm test -- src/core src/features`
- `npm run typecheck`
- `git diff --check`

**风险点**

- Migration 需兼容已有 app config/history；损坏或缺字段应可恢复。
- 配置和 read model 混写会让 RPC 失败污染用户已确认 token。
- RPC URL/token 或长错误消息容易被误写入本地状态或诊断。

#### Task P4-9c: scanner/read model + tests（状态：已完成）

**目标**

实现 ERC-20 watchlist 只读扫描器：按 watchlist token 和本地账户读取 metadata 与 `balanceOf`，产出可恢复、可展示、可被 ERC-20 transfer draft 消费的 read model。

**范围**

- 复用 P4-8b 的 metadata/balance read model 思路，扫描前校验 RPC actual `chainId` 与 expected `chainId`。
- 对每个 `chainId + tokenContract` 读取 `decimals()`、`symbol()`、`name()`，raw cache 只记录 on-chain result，raw metadata status 使用 `ok | missingDecimals | malformed | callFailed | nonErc20 | decimalsChanged`。
- 合成 resolved metadata view 时再处理 user-confirmed override 与 raw cache 的冲突，resolved metadata status 可增加 `sourceConflict`。
- 对每个 `account + chainId + tokenContract` 读取 `balanceOf(account)`，保存 `balance_raw`、resolved metadata snapshot/source/status、`balance_status = ok | zero | balanceCallFailed | malformedBalance | rpcFailed | chainMismatch | stale`、last scanned/error summary。
- 支持手动 scan/retry 的 command/API：单 token、单 account、当前账户、全部 watchlist 或失败项重试。
- RPC failure、non-ERC20、metadata malformed、missingDecimals、decimalsChanged/sourceConflict、balanceOf failure 均保留旧 snapshot 并标记对应 metadata/balance status，不静默隐藏。

**非目标**

- 不做自动发现未知 token、价格/portfolio、allowance/NFT/indexer。
- 不做交易提交、approve/revoke 或 batch plan。
- 不在 scanner 中猜 decimals 或把 symbol/name 当作可信身份。

**验收**

- chainId mismatch 拒绝扫描并显示 expected/actual。
- metadata failure 不阻止保留 watchlist token；缺 decimals 时 selector/draft 能看到不可提交原因。
- balanceOf failure 不把余额显示为 0；旧成功 snapshot 标记 stale 并保留 last error。
- decimalsChanged/sourceConflict 有显式 metadata status，balance snapshot 只引用 resolved metadata status，不能静默改写 user-confirmed decimals 或 frozen draft 输入。

**验证命令**

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm test -- src/core/transactions src/features/transfer`
- `npm run typecheck`
- `scripts/run-anvil-check.sh`
- `git diff --check`

**风险点**

- 部分 ERC-20 的 `symbol/name` 返回 bytes32 或 malformed；错误分类不能过度确定。
- 扫描并发需要避免较慢 RPC 结果覆盖较新的 snapshot。
- 多账户扫描失败必须按 account 维度隔离，不能让一个账户失败污染全部 token。

#### Task P4-9d: UI token watchlist/balances + ERC-20 transfer selector integration + tests（状态：已完成）

**目标**

提供 Tauri desktop 主线的 watchlist 管理、per-account ERC-20 balances 视图、manual scan/retry 和 ERC-20 transfer token selector 集成。

**范围**

- UI 支持 add/edit/remove watchlist token，展示 chainId、token contract、label、resolved metadata source/status、last scan/error。
- UI 支持按当前账户或选定账户查看 watchlist token balances：`balance_raw`、human amount（仅 resolved decimals 明确且 metadata status 非 conflict 时）、symbol/name/source、last scanned、`balance_status`。
- 提供 scan/retry 入口：单 token、单账户、当前账户 watchlist、失败项 retry。
- ERC-20 transfer 表单支持从 watchlist/balance snapshot 选择 token，带入 `chainId`、token contract、resolved metadata source/status、decimals、当前账户余额；`missingDecimals | decimalsChanged | sourceConflict` 时阻止可提交 draft 并显示恢复路径。
- 失败状态不能静默隐藏；nonErc20、malformed、callFailed、rpcFailed、balanceCallFailed、malformedBalance、decimalsChanged、sourceConflict 要有可读摘要。

**非目标**

- 不做资产组合估值、价格、NFT、allowance/revoke、ABI 调用器、batch 分发/归集 UI。
- 不把 browser version 作为主线。
- 不改变 ERC-20 submit 的 Rust 签名广播边界；selector 只提供输入来源。

**验收**

- 用户能添加 token、看到 metadata 成功/失败、手动重试，并按账户看到余额快照。
- ERC-20 transfer 可从 watchlist 选择 token；选择后仍清楚展示 transaction `to = tokenContract` 与 recipient calldata 参数。
- missingDecimals、decimalsChanged、sourceConflict、metadata callFailed、balanceCallFailed 均有禁用原因或恢复动作，不会被当作 0 余额或 unknown token 静默吞掉。
- Remove token 不影响既有历史记录；UI 文案说明 watchlist 是本地配置。

**验证命令**

- `npm test -- src/features/transfer src/features/history src/core/transactions`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `scripts/run-anvil-check.sh`
- `git diff --check`

**风险点**

- UI 容易把 token contract 和 recipient 混淆，必须沿用 P4-8 的 ERC-20 transfer 展示规则。
- 失败行如果被过滤掉，会误导用户以为余额为 0 或 token 不存在。
- selector 与手输 token contract 路径要并存，不能阻塞 P4-8c 的最小发送能力。

#### Task P4-10: 多账户选择器与账户编排基础（状态：已完成）

- 目标：提供可复用的多本地账户选择、外部地址输入、账户集合预览、余额/nonce 可用性检查和操作冻结摘要，为批量分发/归集做准备。
- 依赖：P3 历史 UX、P4-9 余额扫描。
- 关键边界：本地账户与外部地址必须清楚区分；不得自动推断用户未选择的账户；不得在 UI 或日志中泄漏敏感材料。
- 是否先 spec/design：可直接做窄实现，但账户编排数据结构应先在任务内写清楚。

#### Task P4-11: 批量分发/归集 spec

- 状态：spec/design 已补充到 `docs/specs/evm-wallet-workbench.md` 的 `9.5 批量分发/归集模型（P4-11 设计）`；本任务不包含 runtime 实现。
- 目标：定义 batch 模型、分发/归集场景、历史聚合、部分成功、失败恢复和安全确认。
- 依赖：P4-8、P4-9、P4-10。
- 关键边界：批量分发除外部账户外，必须支持选择本地账户作为接收方；归集必须支持 native + ERC-20，从部分或全部本地账户归集到一个指定账户，目标账户可以是本地账户或外部地址。
- 是否先 spec/design：是，必须先 spec/design，不直接实现发送。
- 非目标：不签名、不广播、不写发送代码、不迁移历史；不承诺任意 smart contract multicall、relay、allowance/approve/permit/revoke、swap/bridge 或 fee-on-transfer 特殊保证。Distribution 的固定 Disperse 合约约束由 P4-12/P4-13 任务落地。
- 实现拆分输入：P4-12 先落 native batch 的 `BatchPlan`、child、freeze、history aggregation、partial success 和 recovery；P4-13 在同一模型上加入 ERC-20 token contract、decimals、balance snapshot、native gas availability 与 receipt/log 展示。
- 验证命令：`git diff --check`。

#### Task P4-12: batch native 分发/归集（状态：已完成）

- 目标：实现 native 分发/归集的最小批量能力，其中 native distribution 必须通过固定/默认 Disperse 合约 `0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3` 提交一笔 parent contract transaction，native collection 继续保留 per-source EOA sweep/transfer。
- 依赖：P4-10、P4-11。
- 关键边界：native distribution child rows 是 recipient allocation rows，共享 parent `disperseEther(address[],uint256[])` selector `0xe63d38ed` 的 nonce、fee、tx hash 和 outcome；native collection 每个 source child 独立 nonce、fee、tx hash 和 outcome，且必须预留 gas；collection 的部分失败不能被 batch 总状态掩盖。
- 是否先 spec/design：若 P4-11 已足够细，可进入最小实现；否则补实现级设计。
- 建议最小实现：
  - 复用 P4-10 的 `FrozenOrchestrationSummary`，建立 native `BatchPlan`，distribution parent contract call，recipient allocation rows，以及 collection per-child intent/submission/outcome。
  - Native distribution 只支持 single source -> many targets；多个 source 分发必须拆成多个 batch 或等待后续设计，并在 UI/command 层禁用说明。
  - Distribution freeze key 覆盖 fixed/default contract address、selector、method、recipients/values/order、totalValueWei、parent nonce/gas/fee、source 与 P4-10 frozen key。
  - Native 归集 per-source 计算可转出金额时必须扣除 gas reserve，不能提供不预留 gas 的“全余额扫空”。
  - History batch detail 必须展示 distribution parent record/hash + recipient rows，或 collection child rows，不能只写 batch-level 成功/失败。

#### Task P4-13: batch ERC-20 分发/归集（状态：已完成）

- 目标：在 P4-12 的 batch 基础上实现 ERC-20 分发/归集；ERC-20 distribution 通过固定 Disperse 合约 `0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3` 完成，首个支持方法为 `disperseToken(address,address[],uint256[])` selector `0xc73a2d60`。
- 依赖：P4-8、P4-9、P4-11、P4-12。
- 关键边界：ERC-20 distribution 必须冻结 token contract、recipient/value arrays、distribution contract/method/selector，并做 allowance/preflight；未实现完整 allowance 与 contract call 前必须 gated。ERC-20 collection gas 由每个源账户支付；不应承诺 collection 原子性；每笔 transfer 的 failed/reverted 必须单独可见。
- 是否先 spec/design：已由 P4-11/P4-13 spec 覆盖。
- 已实现最小行为：
  - Distribution 复用 Disperse ERC-20 parent contract call 模型：single local source -> many local/external targets，recipient rows 是 allocation rows，共享 parent nonce/hash/outcome。
  - Rust preflight 在广播前校验 RPC chainId、signer、token balance、allowance(owner, fixed Disperse) 和 native gas；allowance 不足时拒绝且不得广播。
  - Collection 复用 P4-8 的 ERC-20 transfer intent/submission/history 契约，保持 transaction `to = tokenContract`，recipient 作为 calldata 参数。
  - 消费 P4-9 watchlist metadata 和 `account + chainId + tokenContract` balance snapshots；decimals/source、token balance 和 native gas availability 必须冻结并可见。
  - ERC-20 归集支持 selected/all local sources -> one target，目标可以是本地账户或外部地址；`zero` snapshot 生成可见 skipped row，`missing/stale/failure` snapshot 生成可见 blocked row。
  - ERC-20 batch history 展示 token contract、decimals、metadata source、parent contract/method/selector、total raw amount 和 allocation rows。
- 非目标：不实现 approve/permit/revoke、自动 allowance 交易、fee-on-transfer 保证、many-source distribution、`disperseTokenSimple`、用户自定义 batch contract、raw calldata/任意 ABI。

#### Task P5-1: ABI 管理 fetch/import/paste/cache（状态：已完成）

P5-1 已提供 ABI source/cache/read model，不实现 raw calldata、revoke、hot tx 解析、代理自动解析完整方案或任意交易广播。普通 RPC 通常拿不到 ABI；按合约地址 fetch 必须通过 chain-specific explorer、indexer 或类似数据源配置完成。所有 API key、认证 URL、query token 和 provider secret 都必须通过 Rust/Tauri 层引用和脱敏，不能进入 React state、diagnostics、history 或 export。Data source config 只能保存 secret reference/label；真实 secret value 必须来自 OS keychain、secure secret store、环境变量或用户会话输入。

##### Task P5-1a: ABI management spec/design（状态：已完成，doc-only）

**目标**

补齐项目级 ABI 管理设计，明确 fetch/import/paste/cache、数据源配置、ABI identity、validation、失败状态、cache refresh、脱敏和 Rust/Tauri 边界。

**依赖**

- P4-2 诊断脱敏基线。
- P4-9 或基础 chain config 的 `chainId`/RPC profile 概念。
- P4-13 已合并的 ERC-20 batch 现状，避免把 batch 后续能力误写为未完成。

**边界**

- 只改文档，不改 `src` 或 `src-tauri`。
- 不实现 ABI read/write 调用器、raw calldata、revoke、hot tx 解析、代理自动解析完整方案或任意交易广播。
- P5-1 本身不实现调用器或解析器；P5-2 和 P5-3 已作为后续 completed consumers 使用 ABI read model，但 P6 解析仍不得写成当前已完成。

**验收/测试建议**

- `docs/specs/evm-wallet-workbench.md` 覆盖 ABI source/cache/read model、failure states、validation 和 Tauri 边界。
- 文档明确 snake_case 是 Rust/storage schema，camelCase 是 TS/read model/UI；fetch response 永不进入 React，paste/import 只允许前端短暂预检或走 Rust path/stream。
- 本计划文件把 P5-1 拆成可执行子任务，并标明依赖、边界和验收。
- 验证命令：`git diff --check`。

##### Task P5-1b: Rust storage/schema/commands for ABI sources/cache（状态：已完成）

**目标**

实现 ABI data source config、ABI cache entry、fetch/import/paste command 的本地 schema 和 Rust/Tauri command 边界，让 UI 能读取 ABI library/cache/failure read model。

**依赖**

- P5-1a spec/design。
- P4-2 诊断脱敏工具或等价 helper。
- 现有 app config/storage 约定和 chainId/RPC profile 模型。

**边界**

- 只做 ABI source/cache 配置和 read model，不做 ABI 调用器或交易发送。
- API key 只通过 secret label/reference 解析；secret value 来自 OS keychain、secure secret store、环境变量或用户会话输入，完整 key、认证 URL、query token 不返回 React，不写 app config/cache/history/diagnostics/export。
- ABI cache 是可重建数据，不与 vault、助记词、私钥或签名材料混存。

**验收/测试建议**

- Storage 能表达 data source config：`chainId`、provider kind、base URL、optional API key ref/secret label、rate-limit/failure metadata。
- Logical source key 至少包含 `chainId + normalized/checksum contractAddress + sourceKind + providerConfigId/userSourceId`；`abiHash`、`sourceFingerprint`、version 和 attempt id 是 immutable cache version/conflict detection/selected pointer，不是逻辑 source slot。
- Commands 能 list/get/save source config、list/get ABI cache、delete/mark stale cache，并输出脱敏 read model。
- Provider proxy hint 或 implementation ABI 线索只能保存为 `providerProxyHint`/`proxyDetected` 等非身份 metadata，不得暗示 ABI 一定对应 current address runtime。
- 损坏 cache/config、unsupported provider kind、missing secret ref 都有可见错误状态。
- 建议验证：`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run typecheck`、`git diff --check`。

##### Task P5-1c: explorer fetch/import/paste validation and diagnostics（状态：已完成）

**目标**

实现 ABI fetch/import/paste 的 parse、validation、size limit、selector summary、source fingerprint 和脱敏 diagnostics。

**依赖**

- P5-1b storage/schema/commands。
- Chain-specific data source config。
- P4-2 diagnostics export 脱敏边界。

**边界**

- Fetch 只支持已配置 provider kind；普通 RPC 不作为 ABI 来源。
- Fetch response 永不进入 React；fetch payload size limit、parse/validate、canonicalization、hash 和 cache write 均在 Rust/Tauri command 层完成。
- Import/paste 只接受 standard JSON ABI array 或 explorer 返回的 ABI string parse 结果；不做代理自动解析完整方案。
- Paste/import 可以由 React 做固定小上限预检并短暂传入 command，或文件 import 走 Rust file path/stream；前端不得持久化、日志、diagnostics、export、history 或 test snapshot ABI 内容。
- 不把用户导入/粘贴自动标记为 verified explorer ABI。

**验收/测试建议**

- 接受 standard JSON ABI array；接受 explorer 响应中的 ABI string 并 parse/validate。
- 拒绝 malformed JSON、非 array、无 function/event/error 项、过大 payload、明显 malformed item。
- 重复/冲突 selector 在 validation summary 中可见，可标记 `selectorConflict` 或阻止成为默认 ABI。
- 失败/状态 taxonomy 分层覆盖 fetch/source status（`notConfigured`、`fetchFailed`、`rateLimited`、`notVerified`、`malformedResponse`、`unsupportedChain`）、parse/validation status（`parseFailed`、`malformedAbi`、`emptyAbiItems`、`payloadTooLarge`、`selectorConflict`）、cache status（`cacheFresh`、`cacheStale`、`refreshing`、`refreshFailed`、`versionSuperseded`）和 source selection/conflict status（`selected`、`unselected`、`sourceConflict`、`needsUserChoice`）。
- Diagnostics/export 只含 provider kind、chainId、host/config 摘要、failure class、rate-limit hint 等非敏感信息。
- 建议验证：`cargo test --manifest-path src-tauri/Cargo.toml`、`npm test -- src/core src/features`、`npm run typecheck`、`git diff --check`。

##### Task P5-1d: desktop UI for ABI library/cache/failure states（状态：已完成）

**目标**

提供 Tauri desktop 主线的 ABI library/cache UI，支持按 chainId + contract address 查看 ABI 来源、fetch/import/paste/manual refresh、缓存状态、validation summary 和失败恢复。

**依赖**

- P5-1b command/read model。
- P5-1c validation/fetch diagnostics。
- P4-2 diagnostics 面板导出边界。

**边界**

- React 只表达用户意图和展示 read model，不持有 API key、认证 URL、完整 provider secret 或大 payload 响应。
- UI 不提供 ABI read/write 调用器、raw calldata 发送或任意交易广播入口。
- 用户导入/粘贴 ABI 显示为 `userImported`/`userPasted`，不能包装成 verified explorer ABI。

**验收/测试建议**

- ABI library 能显示 source kind、fingerprint/hash、function/event/error count、selector summary、status、fetchedAt/importedAt/updatedAt、stale/cache failure。
- Failure/status states 可见：`notConfigured`、`fetchFailed`、`rateLimited`、`notVerified`、`malformedResponse`、`parseFailed`、`sourceConflict`、`cacheStale`、`unsupportedChain`、`selectorConflict`。
- Manual refresh、TTL/staleness、source changed、contract changed、chain changed 都会让旧 cache 明确 stale 或要求重建。
- Source conflict 不静默覆盖；用户必须确认采用哪个来源。
- 建议验证：`npm test -- src/features src/core`、`npm run typecheck`、`cargo test --manifest-path src-tauri/Cargo.toml`、`git diff --check`。

##### Task P5-1e: selector/read-model integration tests for later P5-2/P5-3（状态：已完成）

**目标**

为后续 P5-2 ABI 调用器、P5-3 raw calldata 预览和 P6 解析准备 selector/read-model 集成测试，确保 ABI cache 输出稳定且冲突可见。

**依赖**

- P5-1b storage/read model。
- P5-1c validation/selector summary。
- P5-1d UI 或至少可消费的 frontend read model。

**边界**

- 只测试 ABI read model 和 selector summary，不实现 P5-2/P5-3/P6 功能。
- 不把 selector match 当作交易安全背书；冲突、unknown、stale source 必须保持可见。
- 不引入前端签名或广播出口。

**验收/测试建议**

- Fixtures 覆盖 normal ABI、function selector duplicate/conflict、event topic duplicate、error selector、userImported/userPasted/explorerFetched、cacheStale/sourceConflict。
- Read model 能被后续调用器按 `chainId + contractAddress + selected source` 稳定读取。
- Selector summary 输出不依赖 RPC URL，不泄漏 API key/base URL query token。
- 建议验证：`cargo test --manifest-path src-tauri/Cargo.toml`、`npm test -- src/core src/features`、`npm run typecheck`、`git diff --check`。

#### Task P5-2: ABI read/write 调用器（状态：已完成）

P5-2 已在 Tauri desktop 主线中可用，基于 P5-1 的 selected ABI source/cache/read model 提供 read-only call 与 managed ABI write transaction caller，并在 write path 复用既有确认页、Rust/Tauri 签名广播边界和交易历史三层模型。Browser 版本不是主线。P5-2 仍只处理 managed ABI entry，不提供 raw calldata sender；selector match 不是安全保证。

##### Task P5-2a: ABI read/write caller spec/design（状态：已完成，doc-only）

**目标**

补齐 ABI read/write caller 的项目级设计，明确 ABI read model 消费、函数分类、参数模型、read call 行为、write draft/history/confirm/submit 边界、diagnostics 脱敏和测试拆分。

**依赖**

- P5-1 ABI source/cache/read model 设计。
- P4-8/P4-13 的 typed intent/submission/outcome 扩展经验。
- 现有确认页、交易历史、Rust signing/broadcast 和 diagnostics 脱敏边界。

**边界**

- 只改文档，不改 `src` 或 `src-tauri`。
- 不实现 ABI caller、raw calldata sender/preview、revoke、asset/allowance scanning、hot tx parsing、签名、广播或 UI。
- 历史语境中本任务不把 P5-2 写成当时已完成；当前状态以 P5-2 已完成为准。
- 明确 P5-3 才处理 raw calldata sender；P5-2 只基于 managed ABI entry。

**验收/测试建议**

- `docs/specs/evm-wallet-workbench.md` 保留 P5-2 设计约束，覆盖 scope/non-goals、ABI source consumption、function classification、parameter model、read behavior、write behavior、history model、diagnostics/security 和 edge cases。
- 本计划文件保留 P5-2 的可实现、可 review 子任务拆分，且每个子任务有依赖、边界和验收。
- 验证命令：`git diff --check`。

##### Task P5-2b: read-only call engine and backend read model（状态：已完成）

**目标**

实现只读 ABI call 的 Rust/Tauri command 和可消费 read model：按 selected ABI entry、函数 signature 和 canonical params 执行 `eth_call`，并返回 decode result 或脱敏失败状态。

**依赖**

- P5-2a spec/design。
- P5-1b/P5-1c 的 ABI cache/read model、validation summary、source/version identity。
- Chain config/RPC profile 的 chainId 校验能力。

**边界**

- 只支持 `view`/`pure` read calls；fallback/receive/constructor 不支持。
- Read call 不签名、不广播、不创建普通交易历史记录；最多记录有限 diagnostic event。
- 不提供 raw calldata 输入；calldata 只能由 selected ABI + canonical params 编码。
- React 不持久化 raw ABI body；artifact loading 和 fingerprint/version 校验在 Rust/Tauri 或受控 read-model 路径完成。

**验收/测试建议**

- Command 在调用前校验 actual RPC `chainId` 与 expected `chainId`，并确认 selected ABI version/fingerprint/hash 未漂移。
- 状态处理覆盖 P5-1 的 fetch/source、parse/validation、cache 和 source-selection 状态，包括 `notConfigured`、`unsupportedChain`、`notVerified`、`fetchFailed`、`rateLimited`、`malformedResponse`、`parseFailed`、`malformedAbi`、`emptyAbiItems`、`payloadTooLarge`、`sourceConflict`、`needsUserChoice`、`cacheStale`、`refreshing`、`refreshFailed`、`versionSuperseded`、`selectorConflict`。每个 non-callable/error/loading/superseded state 都必须可见，并按 spec 明确映射为 blocked、loading 或 recoverable blocked。
- `selectorConflict` 默认 non-callable；React 不能本地 override。只有未来 backend/domain resolution command 返回并冻结具体 resolved source/version/signature/selector identity 后，调用器才能把该 resolved entry 当作 callable。
- Decode 成功、empty return、malformed return、revert data、RPC failure、timeout、chain mismatch、ABI decode error 都有脱敏 read model。
- Rust tests 覆盖 overloaded signature selection、selector conflict blocking、tuple arrays/nested tuple return decode、chain mismatch 和 revert/decode failure。

##### Task P5-2c: ABI parameter editor and calldata preview（状态：已完成）

**目标**

实现 Tauri desktop 的 ABI function picker、signature-level overload selection、参数编辑器和 calldata preview，让用户能在 read/write 前看到 selector、length、hash 和参数摘要。

**依赖**

- P5-2a spec/design。
- P5-1d/P5-1e 的 frontend ABI read model 或等价 list/get selected ABI view。
- P5-2b 的 canonical type/validation contract，或先以 shared parser contract stub 推进。

**边界**

- 参数编辑器只服务 managed ABI functions，不提供 raw calldata textarea 或 raw sender。
- Parse/validate 失败不能自动 coerce 成零地址、0、false、空 bytes 或其他默认值。
- 支持 primitives、address、bytes/fixed bytes、bool、string、int/uint bounds、arrays、fixed arrays、tuple、nested tuple 和 tuple arrays；unsupported type 必须显式 blocked。
- Preview 只展示 ABI 编码摘要，不把 selector match 或 semantic decode 当作安全保证。

**验收/测试建议**

- UI/logic tests 覆盖 malformed address、integer out of bounds、bytes length mismatch、array length mismatch、tuple field missing、nested tuple arrays、overloaded functions 和 large payload summary。
- Preview 输出 function signature、selector、param summary、calldata length/hash，并在 blocking states 下禁用 call/submit。
- Snapshot/diagnostics 不包含 raw ABI body、大型 raw calldata、完整 unbounded tuple/string/bytes/array 参数或 API/RPC secrets；canonical params 可以在内存/submit-time validation 中存在，但持久化只保存 bounded summary/hash/redacted display value。

##### Task P5-2d: arbitrary ABI write draft/history schema（状态：已完成）

**目标**

扩展交易 draft 和 history schema，表达 arbitrary ABI write call 的 typed intent，并为 future submit 预留 nullable submission/outcome/broadcast/recovery fields；本任务只提供 schema/read model/migration 边界，不实现 submit/broadcast。

**依赖**

- P5-2a spec/design。
- 现有 transaction history 三层模型、confirmation draft 模型、replacement/cancellation/reconcile 模式。
- P5-1 selected ABI identity/version/fingerprint/hash。

**边界**

- 不把 ABI write call 伪装成 native transfer、ERC-20 transfer 或 batch。
- 不签名、不广播、不提供 UI 提交；本任务只建立 schema、migration/read model 和单元测试。
- Submission/outcome/broadcast 字段在 P5-2d 是 schema placeholders 或 nullable recovery fields，供 P5-2f submit/broadcast 后填充；P5-2d 不应产生真实 tx hash、broadcast attempt 或链上 outcome。
- History 不保存 raw ABI body、private key/mnemonic/signed tx secret material、API key、完整 unbounded tuple/string/bytes/array 参数或未经明确边界允许的巨大 raw calldata。

**验收/测试建议**

- Draft/history 能冻结 `chainId`、from、to contract、ABI source identity、version、abiHash、sourceFingerprint、function signature、selector、canonical params summary/hash、native value、gas/fee/nonce、selected RPC identity 和 warning statuses；不得持久化完整 unbounded canonical params。
- History record 包含 typed intent、nullable schema-only submission/outcome placeholders、calldata selector/length/hash、argument summary/hash 和 nullable broadcast/recovery metadata placeholders。
- Migration/backward compatibility 不破坏 existing native/ERC-20/batch/replacement/cancellation records。
- Rust tests 覆盖 history serialization、recovery metadata、diagnostics export redaction 和 unknown/future enum handling。

##### Task P5-2e: write gas/fee/nonce draft and confirmation UI（状态：已完成）

**目标**

基于 P5-2d 的 write draft 提供 arbitrary ABI write confirmation page，展示 contract、function、args summary、value、gas/fee/nonce、ABI source status 和风险提示。

**依赖**

- P5-2c parameter editor/preview。
- P5-2d write draft/history schema。
- 现有 gas/fee/nonce/base fee/priority fee/multiplier UI 与确认页组件。

**边界**

- 不签名、不广播；提交按钮可以保持 disabled/stub，直到 P5-2f。
- Nonpayable function 的 native value 必须为零；payable function 才允许 value 输入和确认。
- Fallback/receive/constructor 仍不作为普通函数提交。
- Pending `sourceConflict`、`needsUserChoice`、unresolved `selectorConflict`、chain mismatch、validation failure 必须阻塞。

**验收/测试建议**

- 确认页显示 contract、chain、from、function signature、selector、decoded args summary、native value、gas limit、max fee/fee cap、priority fee、base fee、fee multiplier、nonce、selected RPC identity、ABI source/status 和 warning/blocking states。
- Gas estimation failure 可见且可恢复，不静默用危险默认值。
- Frontend tests 覆盖 payable value、nonpayable nonzero value blocking、`cacheStale` blocks calls/submission until refreshed or explicitly resolved by backend/domain flow、selector conflict blocking、large args summary 和 mobile/desktop layout。

##### Task P5-2f: write submit Rust command and history persistence（状态：已完成）

**目标**

实现 arbitrary ABI write submit command：从冻结 draft 重新校验 ABI/source/RPC/signer/fees/calldata 后，由 Rust/Tauri 签名广播并按既有模式持久化 history。

**依赖**

- P5-2d write draft/history schema。
- P5-2e confirmation UI。
- 现有 Rust signer/from account、RPC send raw tx、history persistence、reconcile/recovery pattern。

**边界**

- 不提供前端签名或广播出口。
- 不支持 raw calldata sender；submit 的 calldata 必须由 selected ABI function + canonical params 构造或复验。
- 不实现 revoke、asset scanning、hot tx parsing 或 selector safety scoring。
- Pending conflicts、ABI version drift、chain mismatch、from mismatch、nonce/fee invalid、calldata mismatch、value mismatch 必须阻塞。

**验收/测试建议**

- Submit command 重新校验 actual chainId/RPC、signer/from、ABI version/fingerprint/hash、function signature/selector、canonical params/calldata、value、gas/fee/nonce 和 warning resolution。
- History 在 broadcast 前后按既有可恢复模式记录 typed intent/submission/outcome、tx hash、RPC identity、broadcast attempt、chain outcome 和 recovery metadata。
- Tests 覆盖 successful broadcast、RPC send failure、signer missing/locked、ABI version drift、source conflict、chain mismatch、gas estimation stale、nonce conflict、history recovery。

##### Task P5-2g: integration/security regression tests（状态：已完成）

**目标**

为 P5-2 的 read/write caller 建立跨层回归测试，确保 ABI read model、参数编码、确认页、submit command、history 和 diagnostics 的安全边界持续有效。

**依赖**

- P5-2b 到 P5-2f。
- P4-2 diagnostics export 测试工具或等价 fixture。

**边界**

- 只测试 P5-2 managed ABI caller，不测试 P5-3 raw calldata sender。
- 不引入真实 API key、真实 mnemonic/private key 或生产 RPC secret。

**验收/测试建议**

- Edge cases 覆盖 overloaded functions、tuple arrays、selector conflicts、stale ABI、source conflict、not verified ABI、chain mismatch、decode errors、reverts、payable value、gas estimation failure、RPC failure、broadcast retry 和 history recovery。
- Diagnostics/export/history 不包含 raw large ABI、API key、RPC URL secret、private key、mnemonic、signed tx secret material；calldata 按 selector/length/hash/summary 边界处理。
- 建议验证：`cargo test --manifest-path src-tauri/Cargo.toml`、`npm test -- src/core src/features`、`npm run typecheck`、`git diff --check`。

#### Task P5-3: raw calldata 发送与预览（已完成）

P5-3 已为 Tauri desktop 高级用户提供 raw calldata sender/preview。Raw calldata 本身不可完全语义化；selector/ABI 推断只可作为辅助解释，不能作为安全保证。最终签名、广播、history 写入、恢复仍必须走 Rust/Tauri command，React 不接触助记词、私钥、raw signed tx 或签名材料。P5-3 不包含 ABI 参数编辑器、任意 ABI source fetch、revoke/approve helper、selector 风险评分库或 hot tx parsing。

##### Task P5-3a: raw calldata spec/design（状态：已完成）

**目标**

补齐项目级 raw calldata sender/preview 设计，明确输入模型、preview/inference、draft frozen key、Rust submit revalidation、history typed metadata、diagnostics redaction、failure/recovery 和后续实现拆分。

**依赖**

- P5-1 ABI cache/selector summary。
- P5-2 managed ABI caller 的确认页、fee/nonce 模式和安全边界。
- 现有 Intent/Submission/ChainOutcome、history write failure recovery 和 diagnostics 脱敏基线。

**边界/非目标**

- 只改 `docs/specs/evm-wallet-workbench.md` 和本计划文件，不改 runtime code。
- 不实现 raw calldata UI、schema、submit command、签名、广播或测试。
- 执行时不把 asset/allowance scanning、revoke、tx hash parsing 或 hot contract analysis 列入当前能力；P5-3 完成后 raw calldata 可作为当前能力记录。

**验收/测试建议**

- Spec 覆盖 inputs：chainId/RPC profile、from local account、to、value wei/human amount、raw calldata hex、gas limit、base fee/multiplier/priority fee/max fee、nonce。
- Spec 覆盖 preview：selector、calldata byte length、`calldata_hash_version = keccak256-v1`、calldata hash、128 KiB decoded byte limit、prefix/suffix bounded preview、P5-1/P5-2 cache 可选推断、unknown/conflict/stale 状态。
- Spec 明确 unknown/conflict selector 可继续但需 high-risk acknowledgement；full calldata 不得无边界进入 logs/history/diagnostics/export/snapshots。
- Spec 明确 frozen key 覆盖 chain/RPC/from/to/value/calldata hash version/hash-length-selector/fee-gas-nonce/warning acknowledgements 和影响 warning 的 selector inference state。
- Spec 明确 submit 必须由 Rust/Tauri command 重新校验 actual chainId/RPC/from/nonce/fee/gas/to/value/calldata normalization、128 KiB limit、hash version/hash、frozen key、warnings 和 frozen inference state 后再签名广播。
- 验证命令：`git diff --check`，并用 `rg` 检查 stale phrases。

##### Task P5-3b: raw calldata frontend draft/preview model and tests（状态：已完成）

**目标**

实现 Tauri desktop frontend 的 raw calldata draft/preview state：输入校验、selector/length/hash 预览、ABI selector inference 状态、warning acknowledgement 和 frozen key invalidation。

**依赖**

- P5-3a spec/design。
- P5-1/P5-2 frontend ABI cache/read model 或等价 selector summary read model。
- 现有 fee reference/base fee customization、nonce/gas 输入和确认页组件。

**边界/非目标**

- 不签名、不广播、不写 history；submit 可以保持 disabled/stub，直到 P5-3d。
- 不提供 ABI 参数编辑器或 managed ABI source fetch；raw calldata textarea 只接收 hex。
- 不把 full calldata 写入 snapshot、diagnostics、export 或 local storage；测试 fixture 使用 bounded payload。

**验收/测试建议**

- Frontend tests 覆盖 malformed hex、empty calldata、short selector、normal selector、128 KiB limit、large calldata prefix/suffix bounded preview、keccak256-v1 hash/length recompute、unknown/matched/conflict/stale inference。
- Draft invalidation 覆盖 chain/RPC/from/to/value/calldata/gas/fee/nonce/warning acknowledgement 变化。
- Unknown/conflict selector、manual gas、high fee、nonzero value 等 high-risk warnings 未 acknowledge 时不可进入可提交确认状态。
- 建议验证：`npm test -- src/features src/core`、`npm run typecheck`、`git diff --check`。

##### Task P5-3c: raw calldata history schema/read model and diagnostics redaction tests（状态：已完成）

**目标**

扩展 history/read model 以表达 `rawCalldata` typed intent/submission metadata，并补 diagnostics/export redaction 测试，确保 raw calldata 不被伪装成 native/ERC-20/ABI/batch，也不泄漏 unbounded payload。

**依赖**

- P5-3a spec/design。
- P5-3b 的 draft/preview contract 或等价 schema stub。
- 现有 typed history、history recovery 和 diagnostics export 测试工具。

**边界/非目标**

- 不实现 Rust submit/broadcast；schema 可预留 submission/outcome/recovery 字段。
- History 默认只保存 selector、length、hash、bounded preview、selector inference summary、warning acknowledgements 和用户摘要；不保存 raw signed tx、secret 或 unbounded calldata。
- 不把 raw calldata 记录回退渲染为 native transfer、ERC-20 transfer、managed ABI write 或 batch。

**验收/测试建议**

- Rust/TS schema 能表达 `transaction_type = rawCalldata`、from/to/value、selector、length、`calldata_hash_version = keccak256-v1`、hash、prefix/suffix bounded preview、truncation metadata、warning acknowledgements、optional matched ABI source identity/version/fingerprint、selector match count/conflict summary、frozen key、nullable tx hash/outcome/recovery metadata。
- Migration/backward compatibility 不破坏 native/ERC-20/batch/ABI/replacement/cancellation records。
- Diagnostics/export tests 验证 private key、mnemonic、raw signed tx、RPC secret、API key、full calldata、大错误 payload 均被排除或 bounded。
- 建议验证：`cargo test --manifest-path src-tauri/Cargo.toml`、`npm test -- src/core/history src/features/history`、`npm run typecheck`、`git diff --check`。

##### Task P5-3d: Rust submit command + recovery + tests（状态：已完成）

**目标**

实现 raw calldata submit Rust/Tauri command：接收 frozen draft + actual calldata，重新校验 chain/RPC/from/to/value/calldata normalization、128 KiB limit、hash version/hash、length、selector、fee/gas/nonce/warnings 后签名广播，并按 raw calldata typed intent 写入 history。

**依赖**

- P5-3a spec/design。
- P5-3c history schema/read model。
- 现有 signer/RPC send raw tx、history persistence、history write failure recovery、diagnostics redaction helpers。

**边界/非目标**

- 不提供前端签名或广播出口；React 不接触 raw signed tx。
- 不通过 selector match 自动提升安全级别；unknown/conflict selector 只要 acknowledgement 冻结且 submit-time 复验通过即可允许。
- 不实现 revoke/approve helper、selector risk scoring、hot tx parsing 或 arbitrary ABI fetch。

**验收/测试建议**

- Command 重新校验 actual RPC `chainId`、RPC identity、signer/from、account availability、nonce、fee/gas、to、value、calldata normalization、128 KiB limit、hash version/hash/length/selector、frozen key、warning acknowledgements 和 frozen inference state。
- Tests 覆盖 successful broadcast、malformed calldata、hash mismatch、chain mismatch、from mismatch、nonce/fee/gas mismatch、missing high-risk acknowledgement、RPC send failure、history write failure after broadcast 和 recovery without rebroadcast。
- History write failure error 返回 tx hash、chainId、from、to、nonce、value、fee/gas、selector/length/hash version/hash、bounded prefix/suffix preview、truncation metadata、frozen key 和 write error。
- 建议验证：`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run typecheck`、`git diff --check`。

##### Task P5-3e: desktop UI wiring + integration/security regressions（状态：已完成）

**目标**

把 raw calldata preview、confirmation、submit result、history detail 和 recovery UI 串成桌面可用闭环，并补跨层安全回归。

**依赖**

- P5-3b frontend draft/preview。
- P5-3c history/read model。
- P5-3d Rust submit command + recovery。

**边界/非目标**

- 只开放 Tauri desktop 主线，不补 browser 版主线能力。
- UI 不能把 selector inference 当作安全保证；unknown/conflict/stale 必须继续可见。
- 不新增资产/授权扫描、revoke、tx hash reverse parsing、hot contract analysis 或 selector risk database。

**验收/测试建议**

- 用户能输入 to/value/calldata/gas/fee/nonce，看到 selector/length/hash/bounded preview 和 inference status，完成 high-risk acknowledgement 后通过 Rust command 提交。
- History detail 显示 raw calldata typed intent，不误标 native/ERC-20/ABI/batch；recovery UI 能补录广播成功但 history 写入失败的 tx hash + frozen params。
- Integration/security tests 覆盖 matched ABI selector、unknown selector、selector conflict、empty calldata、nonzero value、manual gas、estimate failure、broadcast failure、history recovery 和 diagnostics/export redaction。
- 建议验证：`npm test -- src/features src/core`、`npm run typecheck`、`cargo test --manifest-path src-tauri/Cargo.toml`、`scripts/run-anvil-check.sh`、`git diff --check`。

#### Task P5-4: 资产/授权扫描与 revoke 工作流

P5-4 在 Tauri desktop 主线中提供只读资产/授权扫描视图，并为明确 active approval 提供受控 revoke 工作流。普通 RPC 只能回答 supported point queries，不能保证全量发现 token、NFT、tokenId 或 spender/operator；explorer/indexer 只能作为 candidate discovery/source metadata，最终交易前必须由 RPC point read 和 submit-time revalidation 确认。Revoke 是 write transaction，必须进入确认页、历史三层模型和 Rust/Tauri 签名广播。

##### Task P5-4a: asset/allowance/revoke spec/design（状态：本任务，doc-only）

**目标**

补齐项目级 P5-4 spec，并把 P5-4 拆成可串行执行的后续任务。明确只读资产/授权扫描、数据源边界、storage/read model、scan flow、revoke workflow、UI/UX、safety/privacy、failure/recovery 和验收方向。

**依赖**

- P4-9 token watchlist/ERC-20 balance scan。
- P4-10 account orchestration、P4-12/P4-13 native/ERC-20 batch 的账户/余额/历史边界。
- P5-1 ABI/data source/read model、P5-2 managed ABI caller、P5-3 raw calldata 的确认页、history/recovery 和 redaction 约束。

**边界/非目标**

- 只改 `docs/specs/evm-wallet-workbench.md`、本计划文件和 README 的能力状态描述，不改 runtime code。
- 不实现 storage、commands、UI、revoke submit、测试、签名或广播。
- 不把 P5-4/P6 写成当前已完成能力；README 只能把 P5-3 raw calldata 等已合入能力更新为当前可用。

**验收/测试建议**

- Spec 覆盖 ERC-20 balances/allowances、ERC-721/ERC-1155 operator approvals、ERC-721 token-specific approvals、native balance 边界。
- Spec 明确 RPC point read truth、explorer/indexer candidate source/staleness/failure 和无 indexer 时不承诺全量发现。
- Spec 明确 approval watchlist/config、scan jobs、asset snapshots、allowance snapshots、NFT approval snapshots、source metadata/status 和 identity 字段。
- Spec 明确 revoke submit-time revalidation、Intent -> Submission -> ChainOutcome、Rust/Tauri 签名广播和 React 不签名/不广播。
- 验证命令：`git diff --check`，并用 `rg` 检查 P5-3 状态措辞与 P5-4/P6 future boundary。

##### Task P5-4b: asset/approval storage schema + read model + redaction tests（状态：已完成）

**目标**

实现 P5-4 的本地 schema/read model 基础，表达 approval watchlist/config、scan jobs、asset snapshots、allowance snapshots、NFT approval snapshots 和 source metadata/status，并补 diagnostics/export/history redaction 回归。

**依赖**

- P5-4a spec/design。
- 现有 storage、history schema、diagnostics export 和 token watchlist/balance snapshots。
- P4-10 account/local account identity 与 chainId 隔离约定。

**边界/非目标**

- 不实现 RPC scan command 或 revoke submit command。
- 不新增 explorer/indexer provider 实现；source metadata 可先支持 manual/watchlist/history-derived/RPC placeholder。
- 不使用 symbol/name/logo/verified badge 作为 identity；identity 至少包含 chainId、owner/local account、contract、spender/operator、tokenId（如适用）。
- 不保存助记词、private key、raw signed tx、RPC secret、API key、query token 或完整认证 URL。

**验收/测试建议**

- Rust/TS schema 能表达 watchlist/config、job、snapshot 和 per-item status，且 backward compatibility 不破坏既有 native/ERC-20/batch/ABI/raw calldata history。
- Selectors/read model 能按 account/chain/contract/spender/operator/status/source/stale 读取，并保留 stale old snapshot。
- Redaction tests 覆盖 source metadata、provider errors、diagnostics/export/history 中的 RPC secret/API key/query token/raw signed tx/private key/mnemonic 排除。
- 建议验证：`cargo test --manifest-path src-tauri/Cargo.toml`、`npm test -- src/core src/features`、`npm run typecheck`、`git diff --check`。

##### Task P5-4c: read-only scan commands for ERC-20 allowances and NFT approvals（状态：已完成）

**目标**

实现只读 scan commands：在每次扫描前校验 RPC chainId，对每个 owner + contract + spender/operator/tokenId 独立读取 ERC-20 allowance、ERC-721/ERC-1155 operator approval 和 ERC-721 token-specific approval，并写入 snapshots/read model。

**依赖**

- P5-4a spec/design。
- P5-4b storage schema/read model。
- P4-9 token watchlist/ERC-20 balance scanner command patterns。
- 现有 RPC chainId validation、command error redaction 和 rate-limit/error 分类。

**边界/非目标**

- 不实现 revoke transaction、approve helper、permit、batch revoke 或 explorer/indexer full discovery。
- 不承诺全量资产/NFT/allowance discovery；只读取用户/watchlist/history/indexer-provided candidates。
- RPC/item 失败不得写成 zero allowance、false approval 或 no asset；必须保留旧 snapshot 为 stale。

**验收/测试建议**

- Rust tests 覆盖 chain mismatch blocking、per-item success/failure isolation、allowance raw read、`isApprovedForAll` read、`getApproved(tokenId)` read、metadata/decimals failure、stale retention、rate-limit/source unavailable summary 和 redaction。
- Commands 返回 job summary、per-item status、last successful snapshot refs 和 bounded error summaries。
- 无 candidates 或无 indexer 时 UI/read model 可显示 unknown coverage/not configured，而不是空结果安全感。
- 建议验证：`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run typecheck`、`git diff --check`。

##### Task P5-4d: desktop asset/approval scanner UI and filters

**目标**

实现 Tauri desktop 的资产/授权扫描视图，展示 ERC-20 balances/allowances、已知 NFT holdings/approvals、scan job 状态和 source coverage，并提供按账户/链/contract/spender/operator/status/source/stale 的筛选。

**依赖**

- P5-4a spec/design。
- P5-4b storage/read model selectors。
- P5-4c read-only scan commands。
- 现有 AppShell、account orchestration、token watchlist 和 diagnostics UI patterns。

**边界/非目标**

- 本任务不提交 revoke；revoke 入口可 disabled/stub 或只进入后续 draft flow。
- 不把 indexer/explorer candidate 显示成 RPC-confirmed truth。
- 不新增 browser mainline，不实现 portfolio pricing、NFT media gallery、full collection discovery 或 risk scoring。

**验收/测试建议**

- Frontend tests 覆盖 account/chain/contract/spender/operator/status/source/stale filters、unknown coverage empty states、stale/failure badges、metadata unknown、symbol/name 不作为 identity 和 revoke gating display。
- UI 只对明确 active approval 显示可继续 revoke 的状态；zero/false/stale/unknown/failed 默认不可 revoke。
- Diagnostics/export/snapshots 不包含 secrets 或 unbounded provider errors。
- 建议验证：`npm test -- src/features src/core`、`npm run typecheck`、`git diff --check`。

##### Task P5-4e: revoke draft/frozen key/confirmation UI

**目标**

实现 revoke draft 与确认页：针对 ERC-20 `approve(spender, 0)`、ERC-721/1155 `setApprovalForAll(operator, false)`、ERC-721 `approve(address(0), tokenId)` 生成可冻结意图，展示 approval identity、method/selector、snapshot status/source/staleness、fee/gas/nonce 和 warning acknowledgements。

**依赖**

- P5-4a spec/design。
- P5-4b storage/read model。
- P5-4d scanner UI/gating。
- P5-2/P5-3 confirmation patterns、fee/nonce model、warning acknowledgement patterns。

**边界/非目标**

- 不签名、不广播、不写 chain submission；submit 可保持 disabled/stub，直到 P5-4f。
- 不开放 stale/unknown/failed snapshot 的 revoke；需要用户重新扫描。
- 不实现 batch revoke；未来若做，必须逐笔确认/冻结。
- React 不接触 private key、mnemonic、raw signed tx 或签名材料。

**验收/测试建议**

- Frontend tests 覆盖 ERC-20/operator/token-specific revoke draft、frozen key invalidation、active-only gating、stale/unknown disabled、warning acknowledgements、contract/spender/operator/tokenId display 和 selector/method display。
- Frozen key 覆盖 chain/RPC/from、snapshot identity/status/ref、approval kind、contract、spender/operator、tokenId、method/selector、calldata args、fee/gas/nonce、warnings 和 frozen version/time。
- UI 明确 transaction `to = token/approval contract`，spender/operator/tokenId 是 calldata 参数。
- 建议验证：`npm test -- src/features src/core`、`npm run typecheck`、`git diff --check`。

##### Task P5-4f: revoke submit Rust command + history/recovery

**目标**

实现 revoke submit Rust/Tauri command：提交前重新校验 chainId/RPC/from、approval snapshot identity/status、token/approval contract、spender/operator、tokenId、calldata selector/method/args、fee/gas/nonce、warning acknowledgements 和 frozen key，重新读取当前 approval point query，确认仍 active 后签名广播并写入 typed revoke history/recovery metadata。

**依赖**

- P5-4a spec/design。
- P5-4b storage/read model。
- P5-4c read-only scan commands 或可复用 point read helpers。
- P5-4e revoke draft/frozen confirmation UI。
- 现有 signer/RPC send raw tx、history persistence、history write failure recovery 和 diagnostics redaction helpers。

**边界/非目标**

- 不实现前端签名或广播出口。
- 不把 revoke 记录伪装成 ERC-20 transfer、managed ABI write 或 raw calldata；history intent kind 必须明确。
- 不实现 permit revoke、approval increase/decrease、batch revoke、swap/bridge safety scoring 或 arbitrary ABI helper。
- 如果 submit-time point read 发现 already zero/false、spender/operator changed、tokenId mismatch、contract mismatch 或 chain mismatch，必须拒绝广播并要求重新扫描/重建 draft。

**验收/测试建议**

- Rust tests 覆盖 ERC-20 successful revoke、ERC-721/1155 operator revoke、ERC-721 token-specific revoke、chain mismatch、from mismatch、snapshot stale、snapshot identity mismatch、already zero/false blocking、selector/method mismatch、fee/nonce mismatch、missing warning acknowledgement、broadcast failure、history write failure after broadcast 和 recovery without rebroadcast。
- History write failure error 返回 tx hash、chainId、from、contract、spender/operator、tokenId、method/selector、fee/gas/nonce、snapshot identity/status、frozen key 和 write error。
- Diagnostics/export 不包含 private key、mnemonic、raw signed tx、RPC secret、API key 或 unbounded provider errors。
- 建议验证：`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run typecheck`、`git diff --check`。

##### Task P5-4g: integration/security regressions

**目标**

串联 P5-4 storage、read-only scan、scanner UI、revoke confirmation、Rust submit、history/recovery 和 diagnostics/export，补跨层安全回归。回归重点是确认这些改动不破坏当前 native/ERC-20/batch/ABI/raw calldata 能力。

**依赖**

- P5-4b storage/read model。
- P5-4c read-only scan commands。
- P5-4d scanner UI。
- P5-4e revoke draft/confirmation UI。
- P5-4f revoke submit/history/recovery。

**边界/非目标**

- 不扩大为 full portfolio、NFT collection discovery、indexer product、batch revoke、tx hash reverse parsing 或 hot contract analysis。
- 不把 explorer/indexer results 当成交易 truth。
- 不重新启用 browser 版作为主线。

**验收/测试建议**

- Integration tests 覆盖 ERC-20 allowance scan -> active approval -> revoke -> pending/confirmed history、ERC-721/1155 operator approval revoke、ERC-721 token-specific revoke、stale snapshot gating、partial scan failure、unknown coverage display、history recovery after broadcast 和 diagnostics/export redaction。
- Security regressions 覆盖 chainId mismatch、wrong RPC、wrong from、changed spender/operator/tokenId、already revoked、unlimited allowance warning、unknown metadata warning、external spender/operator warning、contract not verified warning 和 symbol/name 不作为 identity。
- 已有 native/ERC-20 transfer、native/ERC-20 batch、ABI caller、raw calldata tests 仍通过。
- 建议验证：`npm test`、`npm run typecheck`、`cargo test --manifest-path src-tauri/Cargo.toml`、`scripts/run-anvil-check.sh`、`git diff --check`。

#### Task P6-1: tx hash 逆向解析

- 目标：提供按交易 hash 的逆向解析入口，读取 transaction、receipt、logs 和相关 metadata，展示可解释的交互摘要。
- 依赖：P5-1/P5-2 的 ABI/selector 能力，P4-2 诊断脱敏。
- 关键边界：tx hash 解析依赖 RPC/explorer 数据可用性；代理合约、未验证合约、selector 冲突、缺失 logs 都必须显示为不确定或 unknown。
- 是否先 spec/design：是。

#### Task P6-2: contract address hot 交易/selector 分析

- 目标：提供按合约地址的 hot 交易、selector 和交互模式分析入口，用于理解某合约近期常见调用和风险提示。
- 依赖：P6-1；P5-1 数据源配置。
- 关键边界：contract address 入口通常需要 explorer/indexer、ABI/selector 数据库或采样交易数据；RPC 只能提供有限链上读取，不能保证拿到历史热度；分析结果是推断，不是确定事实。
- 是否先 spec/design：是。

## 8. 全局验收清单

- 不破坏 RPC chainId 匹配：保存和提交前仍以远端 `chainId` 校验为准。
- 不破坏 `account + chainId` 状态隔离：余额、nonce、同步错误和历史线程不能跨链混用。
- 不破坏 pending 历史恢复：应用重启后仍从持久化 pending 历史恢复 nonce 预留。
- 不新增前端签名或广播出口：最终提交仍必须走 Rust command。
- 不把助记词、私钥、签名材料写入 UI、日志、历史、错误消息或 app-config。
- 不把浏览器版重新设为后续主线。
- 不把 P5-4/P6 计划能力写成当前已完成，也不把已完成的 P4/P5-1/P5-2/P5-3 历史任务重新写成待交付。
