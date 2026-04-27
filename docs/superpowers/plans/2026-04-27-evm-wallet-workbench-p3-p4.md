# EVM Wallet Workbench P3/P4 后续执行计划

> 面向 subagent-driven-development：本计划只描述后续待执行任务，不表示这些能力已经完成。后续由 controller 按任务串行派发和收口。

## 1. 基线与方向

- 基线：从当前已合并到 `main` 的 EVM Wallet Workbench v1（Tauri 2 技术栈）开始推进。
- 主线：后续产品、测试、发布和技术债治理都以 Tauri desktop app 为准。
- 非主线：浏览器版只作为历史参考或迁移来源，不继续投入功能补齐。
- 已有 v1 能力：vault/mnemonic、账户派生与链上扫描、RPC 验证和 app-config、native transfer draft/submit、pending history/reconcile、replace/cancel、anvil smoke check。
- 后续重点：P3 优先做 History UX hardening、交易三层展示、错误摘要/失败记录和恢复入口；P4 规划能力池，但避免提前实现大而全的交易/资产系统或日志系统。

## 2. 执行规则

- 每个任务按 `implementer -> spec reviewer -> code quality reviewer` 串行执行。
- implementer 只完成当前任务范围内的文件修改，不顺手实现后续任务。
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

## 4. 里程碑划分

### P3: History UX Hardening

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

### P4: Recovery, Observability, and Focused Extensions

目标是在 P3 稳定历史体验之后，补强诊断、恢复和少量明确依赖 P3 的能力。P4 先维护任务池和优先级，不提前把 ERC-20、ABI 调用、批量策略做成当前承诺。

## 5. P3 任务卡

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

## 6. P4 后续任务池

P4 任务需在 P3 历史模型和详情视图稳定后再拆细。优先级越高越适合作为 P4 前半段任务。

| ID | 优先级 | 方向 | 依赖 | 说明 |
| --- | --- | --- | --- | --- |
| P4-1 | P0 | 诊断事件与本地结构化日志 | P3-5, P3-7 | 为 RPC 探测、提交、历史写入、reconcile 产出非敏感诊断事件；必须过滤助记词、私钥、签名材料。 |
| P4-2 | P0 | 诊断面板/导出 | P4-1 | UI 提供只含非敏感信息的诊断查看与导出，用于排查 RPC、chainId、history、nonce 问题。 |
| P4-3 | P1 | 历史文件损坏恢复 | P3-0, P3-5 | 支持检测、隔离损坏文件、生成可读错误和恢复建议；不能在历史不可读时盲目广播新交易。 |
| P4-4 | P1 | 广播成功但历史写入失败补录 | P3-0, P3-3, P3-5 | 提供基于 tx hash、account、chainId、nonce 的本地补录或重新扫描入口。 |
| P4-5 | P1 | dropped 复核与重新 reconcile | P3-4, P3-5, P3-6 | 对 dropped 提供真实手动复核/重新 reconcile，不把 dropped 等同于链上 failed。 |
| P4-6 | P1 | pending 老化策略 | P3-5, P3-6 | 根据 pending 时长和最新 RPC 状态提示 reconcile、replace、cancel。 |
| P4-7 | P2 | anvil smoke check 诊断增强 | P3-7 | 输出更稳定的失败摘要，帮助区分环境、RPC、签名、历史写入和 reconcile 问题。 |
| P4-8 | P2 | ERC-20 转账探索 | P3-0, P3-3, P3-7 | 先写 spec/设计，再决定是否实现；需要复用 Intent/Submission/ChainOutcome。 |
| P4-9 | P2 | 资产与授权扫描探索 | P3-7 | 先做只读诊断，不与交易提交混合。 |
| P4-10 | P3 | 批量分发/策略编排探索 | P3-7, P4-8 | 高风险能力，不应在没有更强审计、模拟和恢复能力前实现；若先做原生币批量，也必须先另写设计任务。 |
| P4-11 | P3 | ABI 调用器或 raw calldata | P4-1, P4-2, P4-5 | 需要额外安全确认和参数可读化，不作为近期主线。 |

## 7. 全局验收清单

- 不破坏 RPC chainId 匹配：保存和提交前仍以远端 `chainId` 校验为准。
- 不破坏 `account + chainId` 状态隔离：余额、nonce、同步错误和历史线程不能跨链混用。
- 不破坏 pending 历史恢复：应用重启后仍从持久化 pending 历史恢复 nonce 预留。
- 不新增前端签名或广播出口：最终提交仍必须走 Rust command。
- 不把助记词、私钥、签名材料写入 UI、日志、历史、错误消息或 app-config。
- 不把浏览器版重新设为后续主线。
- 不把 P4 探索能力写成当前已完成或 P3 必须交付。
