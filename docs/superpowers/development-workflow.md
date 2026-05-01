# Development Workflow

本文件记录项目后续固定采用的开发 workflow。它不是某个 milestone 的计划，而是 controller、implementer 和 reviewer 协作时都要遵守的操作规程。

## 1. 产品主线

- Tauri desktop app 是唯一主线。后续产品、测试、发布、诊断和安全边界都以桌面端为准。
- 浏览器版只作历史迁移参考，不作为新功能验收目标，也不补齐同等能力。

## 2. 文档分工

- Spec / plan 说明“应该怎么做”：目标、范围、非目标、验收标准、风险和推荐验证命令。
- 状态表说明“现在做到哪”：任务所处阶段、分支、commit、review、验证、push / merge 状态和备注。
- 不用 spec / plan 记录实时流水账；不用状态表替代设计和验收标准。

建议状态表字段：

| milestone | task | branch | commit | review status | verification | pushed | merged | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

## 3. 分支模型

- 每个 milestone 使用一个集成分支。
- 每个子任务可以有独立任务分支；子任务完成后进入 milestone 集成分支。
- milestone 完成后，再由 controller 将集成分支 merge 到 `main`。
- 开始任务前先检查工作区状态，识别已有改动属于谁、是否在本任务范围内。
- 不得还原、覆盖或清理他人改动；dirty 工作区中只处理自己负责的文件和任务范围。

## 4. 单任务串行流程

每个开发任务按以下顺序串行执行：

1. implementer 实现当前任务。
2. spec reviewer 检查实现是否符合 spec / plan、验收标准和非目标。
3. code quality reviewer 检查可维护性、测试覆盖、风险路径和误改范围。
4. controller 亲自 fresh verification。
5. controller commit / push。

规则：

- 子代理只实现或 review，不负责 commit / push；本项目规则覆盖通用 subagent-driven-development 示例中 implementer 可 commit 的描述。
- 如果用户已经明确授权 controller 代为执行需要用户参与的 gate，controller 继续执行 spec / plan / review / verification / commit / push，但不得跳过 implementer -> spec reviewer -> code quality reviewer -> controller fresh verification 的任务流程；只有 scope 扩大、环境阻塞、数据破坏风险或需要业务取舍时才停下来交给用户决策。
- controller 必须在 fresh verification 后才能提交。
- review 反馈必须先核实事实再修，不能盲从。
- reviewer 要求修改的任何问题，修复后都必须再次 review 直到通过；重要或阻塞问题还需要 controller 明确核实。
- 每个任务收口后更新状态表。
- 及时关闭已完成子代理，避免 thread limit。

## 5. 验证分层

- 每个 task 至少运行与改动范围匹配的 focused tests。
- 只改 Markdown 的任务至少运行 `git diff --check`。
- 安全、诊断、日志、导出、错误呈现等任务，必须增加 redaction / security tests，确保不泄露助记词、私钥、raw signed tx、敏感 RPC 凭据或绝对路径等不该暴露的信息。
- milestone merge 前运行完整验证，包括：
  - `npm test`
  - `npm run typecheck`
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - `scripts/run-anvil-check.sh`
  - `git diff --check`
- anvil smoke 是 milestone 级合并前必做验证；如果环境无法启动，要记录具体环境失败，不把该路径当作已通过。

## 6. 文档收口

- 每个任务收口后更新状态表，写清当前分支、commit、review、verification、push / merge 状态和备注。
- 每个 milestone 的最后一项固定更新 README / spec 的 current / future capability wording。
- README 只写当前已完成能力；未来能力和探索项放在 spec / plan / backlog 中，避免用户误以为已经可用。

## 7. 事实核实与协作边界

- review 反馈先复现、读代码或查证 spec，再决定是否修改。
- 对无法复现、与 spec 冲突或可能扩大范围的反馈，先记录事实和判断，再交给 controller 决策。
- 不顺手改业务范围外的问题；需要另开任务的，写入 notes 或 backlog。
- 任何时候都不要用 reset、checkout 等方式清理他人改动，除非 controller 明确要求。
