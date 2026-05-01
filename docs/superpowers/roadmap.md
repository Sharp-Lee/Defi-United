# Roadmap

## Current Baseline

- 当前唯一产品主线是 Tauri desktop 版 EVM Wallet Workbench，browser donor 仅保留在 git 历史中，不再作为活跃主线。
- 当前稳定事实来源是 `README.md`、`docs/specs/evm-wallet-workbench.md`、`docs/superpowers/development-workflow.md` 和 `docs/superpowers/project-status.md`。
- P9 仓库清理已经完成并合并；当前仓库应继续保持“只保留高信号、可持续维护的文档”和干净的 main 分支状态。
- 这份 roadmap 只描述后续候选里程碑，不把未来能力写成当前已完成能力。

## Repo Hygiene Roadmap

### P10 Branch And Worktree Hygiene Automation

**Goal**

把“查看哪些分支可删、哪些 worktree 可删、哪些远端分支必须保留”变成可重复执行的日常流程，而不是人工记忆。

**Scope**

- 固化 merged / unmerged 检查口径，尤其是 `main` 与 `origin/main` 的同步检查。
- 为本地 `codex/*` 分支、worktree、以及远端 `origin/codex/*` 的处理建立明确的保护规则。
- 把清理命令、保护清单、保留清单写进可执行文档或脚本说明。

**Exit Criteria**

- 能够从单一入口判断某个本地分支或 worktree 是否可清理。
- 能够明确区分“已合并可删”“未合并必须保留”“带未提交改动必须暂停”的三类状态。
- 清理动作不会误删未合并远端分支，也不会覆盖带改动 worktree。

**Verification**

- `git fetch --prune origin`
- `git branch --merged main`
- `git branch --no-merged main`
- `git branch -r --merged origin/main`
- `git branch -r --no-merged origin/main`
- `git worktree list`
- `git diff --check`

**Notes**

- 这一步只做 repo hygiene，不改变 runtime 行为。
- 远端非 `codex/*` 的未合并分支必须继续保留，例如研究分支。

### P11 Documentation Lifecycle Convergence

**Goal**

让完成过的实现计划、设计说明、状态说明和 roadmap 之间的边界稳定下来，减少重复文档和过期入口。

**Scope**

- 继续收束已完成里程碑的历史设计/计划，只保留 durable truth。
- 明确哪些文档属于“当前规范”、哪些属于“历史记录”、哪些属于“未来路线图”。
- 让 README、spec、workflow、status 和 roadmap 的叙述保持一致。

**Exit Criteria**

- 当前 source tree 里只保留对未来仍有持续价值的文档。
- 已完成任务的重复说明不再散落在多个地方。
- 新读者能通过 README + spec + workflow + status + roadmap 快速建立正确心智模型。

**Verification**

- `! rg -n "2026-04-27-evm-wallet-workbench|2026-04-30-p6-2|2026-05-01-browser-donor-cleanup|2026-05-01-p7-release-readiness" README.md docs/specs/evm-wallet-workbench.md docs/superpowers/development-workflow.md docs/superpowers/project-status.md`
- `git diff --check`

**Notes**

- 这一步只收口已经完成的内容，不把新的 runtime 能力写进 README。
- 历史计划应继续留在 git history，不需要在工作区保留重复副本。

### P12 Status And Release Sync Guardrails

**Goal**

把“当前做到了哪”“什么时候可发布”“如何复核 main 是否真是最新”变成可检查的约束，而不是口头约定。

**Scope**

- 强化 `docs/superpowers/project-status.md` 的状态表，让每个 milestone 都有可追踪的 branch、commit、review、verification、push 和 merge 记录。
- 将 release readiness gate 和状态表同步起来，避免文档写已完成但 main 还没真正对齐。
- 形成一套 controller 复核清单，专门检查 merge 前后的事实一致性。

**Exit Criteria**

- 每个里程碑都能在状态表里找到对应记录。
- `main` 与 `origin/main` 的同步状态可以被明确验证。
- release gate 只在真实通过后才会宣告通过。

**Verification**

- `bash -n scripts/run-release-readiness.sh`
- `scripts/run-release-readiness.sh --post-merge`
- `git diff --check`

**Notes**

- 这一步不引入新 wallet 能力，只加治理和发布护栏。
- 任何状态表改动都必须和实际 commit / merge 结果一致。

## Product Roadmap

### P13 Expanded Portfolio And NFT Discovery

**Goal**

在当前资产/approval read model 之上，向更完整的 portfolio 视图推进，让用户能看到更接近“我在这条链上有什么”的聚合结果。

**Scope**

- 汇总 native balance、已知 token holdings、token watchlist 数据、以及可发现的 NFT / collection 线索。
- 保留 source coverage、freshness、staleness 和失败状态，不把“局部可见”伪装成“全链完整索引”。
- 支持按 `account + chainId` 分隔展示，不把不同链或不同账户的数据混到一起。

**Exit Criteria**

- 能从多个受控 source 合并出可解释的 portfolio 视图。
- 用户能区分“已确认资产”“已知但未完全覆盖资产”“过期或待重试数据”。
- 任何不可验证的覆盖范围都必须明确标记。

**Verification**

- 针对 asset snapshot / token metadata / NFT source 的单元测试。
- `npm run typecheck`
- `git diff --check`

**Notes**

- 这一步不承诺全量链上索引。
- 浏览器 donor 的历史代码不作为实现来源。

### P14 Expanded Authorization Discovery

**Goal**

把当前已知 approval 扫描扩展到更广的授权面，提升“我授权给谁、范围多大、还是否有效”的可见性。

**Scope**

- 扩展 ERC-20 / ERC-721 / ERC-1155 等常见授权形态的发现能力。
- 记录授权来源、覆盖范围、是否过期、是否可疑、以及数据 freshness。
- 保持只读 read model 边界，不把扫描器伪装成自动执行器。

**Exit Criteria**

- 授权视图能展示更广泛的已知授权面，而不只是当前最小集合。
- 每条授权都能解释它从哪里来、何时读取、为什么可信或不可信。
- 扫描失败不会静默变成“没有授权”。

**Verification**

- 授权扫描读模型测试
- redaction / sensitive-output 回归测试
- `npm run typecheck`
- `git diff --check`

**Notes**

- 这是扩大可见性，不是自动 revoke。
- 仍然要避免把“未知”误写成“无风险”。

### P15 Approval Decisioning And Conditional Revoke Expansion

**Goal**

把授权发现结果进一步转成“怎么处理”的决策面，让用户可以更稳地判断保留、关注、撤销或分层处理。

**Scope**

- 为 active approval 增加更清楚的决策提示与原因说明。
- 细化 revoke 的适用边界，避免把撤销动作做成无脑一键操作。
- 如果未来引入更大范围的 revoke 编排，也必须保持显式确认和严格安全边界。

**Exit Criteria**

- 用户能看懂每条授权为什么会被建议保留或撤销。
- revoke 路径仍然保持可审计、可回退、可解释。
- 不会因为“批量化”而丢掉具体链、账户、spender、nonce 的语义。

**Verification**

- 授权决策提示测试
- revoke 路径回归测试
- `npm run typecheck`
- `git diff --check`

**Notes**

- 这一步仍然不等于 full risk scoring。
- 任何更激进的自动化都需要单独的安全审查。

### P16 Risk Scoring And Advisory Surface

**Goal**

把 tx analysis、hot contract analysis、approval discovery 和 history 信号组合成更统一的 advisory surface，但保持“建议”而不是“结论”。

**Scope**

- 汇总多来源线索，生成分层风险提示与解释性原因。
- 只输出 advisory / read-model 结果，不输出审计结论、保证或最终安全判断。
- 让历史、诊断、授权和 hot contract 结果之间的风险信号能够互相引用。

**Exit Criteria**

- 用户能看到原因明确、来源可追踪的风险提示。
- UI 不会把不确定的推断写成确定事实。
- 低置信度结论必须显式展示为低置信度。

**Verification**

- 风险提示相关 unit/integration tests
- redaction tests
- `npm test`
- `git diff --check`

**Notes**

- 这一步尤其要防止“像安全产品一样说话，但其实只是 advisory”。
- 不把风险评分写成交易真实性或安全性的最终裁决。

### P17 Wallet Recovery Automation

**Goal**

把本地 encrypted vault 的恢复、验证和故障路径做得更可操作，但不把明文助记词回流到 React。

**Scope**

- 改善 encrypted vault、密码、备份、恢复路径之间的引导和校验。
- 优先处理“本地恢复”和“备份验证”，而不是引入明文 mnemonic 导入/导出 UI。
- 让恢复失败、密码错误、文件损坏、数据丢失等状态更清晰。

**Exit Criteria**

- 用户能够在不接触明文助记词 UI 的前提下完成更可靠的恢复相关操作。
- 恢复边界、失败原因、可恢复路径都能清楚呈现。
- 恢复流程不破坏现有安全边界。

**Verification**

- vault / recovery focused tests
- security / redaction tests
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

**Notes**

- 不把“恢复自动化”误写成“导出明文助记词”。
- 如果这一块需要更大的设计变更，先更新 spec 再进实现。

### P18 Broader Contract Interaction Tooling

**Goal**

在现有 managed ABI read/write、raw calldata、hot contract analysis 和 replace/cancel 边界之上，扩展更广的合约交互工具链。

**Scope**

- 支持更丰富的 ABI / calldata 交互形态、预览和解释能力。
- 把 contract interaction 的意图、冻结参数、history 语义和诊断信号继续统一。
- 对新型合约交互保持 typed intent/submission 设计，而不是重新塞回 native transfer 模型。

**Exit Criteria**

- 新交互类型可以沿用统一的 draft / freeze / submit / history / reconcile 语义。
- 用户能在确认页看清“调用目标、方法、参数、费用、nonce、风险提示”。
- 新能力不会破坏现有 native transfer、ERC-20 transfer、batch、ABI call 和 raw calldata 的边界。

**Verification**

- contract interaction focused tests
- typed intent / history regression tests
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

**Notes**

- 这一步是“扩展合约交互工具链”，不是重新发明一个通用链分析器。
- 新能力必须继续遵守 Rust/Tauri 负责签名、广播和持久化的边界。

## Non-Goals And Safety Boundaries

- roadmap 不承诺 browser donor 回到活跃主线。
- roadmap 不把未来候选写成当前已完成能力。
- roadmap 不突破现有安全边界：助记词、私钥、签名原文、raw signed tx、完整 RPC 凭据都不能进入 React 或日志。
- roadmap 不替代 spec；真正进入实现前，必须先有对应 spec / plan / status 收口。
- roadmap 不删除仍需保留的历史上下文、未合并分支或带变更 worktree。

## Status Sync Rules

- 每个里程碑完成后，都要更新 `docs/superpowers/project-status.md` 的对应行。
- README 只写当前已完成能力；未来能力、探索项和候选里程碑留在 spec / plan / roadmap。
- 如果产品能力边界变化，先改 spec，再改 README，再改 status，最后再回填 roadmap。
- 任何 roadmap 调整都必须和当前 main 的真实状态一致，不能用路线图假装已实现。
- 任何任务收口前，都要保持 `git diff --check` 为绿色。
