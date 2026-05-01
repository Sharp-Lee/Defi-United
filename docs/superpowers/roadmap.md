# Roadmap

## Current Baseline

- 当前产品主线是 Tauri desktop 的 EVM Wallet Workbench。
- 现有能力边界以 `docs/specs/evm-wallet-workbench.md` 为准；README 负责使用、验证与安全边界的对外说明。
- 当前 source tree 只保留高信号、可持续维护的文档；已完成的任务历史保留在 git history 中。

## Candidate P9+ Milestones

- P9 仓库清理收口：完成历史文档清理、状态表同步和保留路径收束。
- P10 分支 / worktree 自动清理：把已合并、且干净的本地分支和 worktree 做成可重复检查流程。
- P11 文档周期收敛：把后续已完成 milestone 的历史说明继续收束到 README、spec、status 和 roadmap。

## Non-Goals

- 不在 roadmap 中承诺新的 runtime 行为。
- 不恢复 browser donor 作为当前 source tree 的活跃主线。
- 不保留已完成 milestone 的重复计划文档。
- 不删除未合并分支、带变更 worktree，或任何仍需保留的历史上下文。

## Safety Boundaries

- 助记词、私钥、签名、广播和本地持久化仍以 Rust/Tauri 为边界。
- React 只承载 UI 状态、意图和展示，不接触明文助记词或签名材料。
- 任何新的路线图项都必须先回到 spec / workflow / status 的正式收口，再进入实施。
