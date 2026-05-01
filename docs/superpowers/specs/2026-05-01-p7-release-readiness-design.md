# P7 Desktop Release Readiness Design

## Summary

P7 不引入新的钱包能力。它把当前已经完成的 Tauri desktop 主线收束成一个可发布、可回归、可复核的交付物：确认 `main` 与远端同步，验证新 worktree 能正常安装和运行，按桌面主线把核心路径从头到尾 smoke 一遍，并把 smoke 过程中发现的问题修掉或显式记录。

这个阶段的目标不是扩张功能，而是证明现有功能已经稳定到可以被真实使用和继续迭代的程度。

## Scope

### In Scope

- 新 worktree 的基线验证与依赖就绪
- 桌面应用的启动、解锁和核心工作流 smoke
- `main` / `origin/main` 同步确认
- `npm test -- src/features src/core`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `scripts/run-anvil-check.sh`
- `git diff --check`
- release 过程中暴露出来的高优先级回归修复
- README、project-status、spec / plan 的最终同步

### Out of Scope

- 新的钱包功能
- 浏览器版本继续补齐
- 大规模 UI 重构
- 发布渠道、安装包、签名、自动更新体系
- 超出当前主线的 roadmap 扩展

## Design Principles

1. `main` 是发布真相源。任何发布结论都必须基于 `main` 上的最新验证。
2. 证据先于结论。没有 fresh verification，不宣称可发布。
3. smoke 发现的问题优先修，不能靠文档掩盖。
4. 只修和发布相关的缺口，不趁机扩功能。
5. 文档、状态表、代码必须描述同一个现实。

## Chosen Approach

推荐方案是“**smoke-first release gate + targeted fixes + docs sync**”。

### Approach A: 仅做文档发布清单

优点：最快，几乎没有实现成本。

缺点：只能说明流程写好了，不能证明桌面主线真的可用。

### Approach B: Smoke gate + 小范围修补

优点：最符合当前阶段。它用现有测试、anvil smoke 和桌面实际操作证明可用性，再把 smoke 暴露的少量问题补掉。

缺点：需要完整跑一轮验证，可能暴露一些收尾问题。

### Approach C: 构建完整发布仪表盘

优点：可视化、可积累。

缺点：当前太重，不是 P7 的必要投资。

**推荐：Approach B。**

## Release Gates

P7 只有在以下条件同时满足时才算完成：

- `git fetch origin main` 成功，且本地 `main` 与最新的 `origin/main` 同步
- 新 worktree 基线干净
- dependency readiness 通过：`npm ci`
- 隔离 desktop smoke 通过：fresh `EVM_WALLET_WORKBENCH_APP_DIR` 下启动、创建或解锁 throwaway vault、确认核心 transfer/history surfaces 渲染，并由 controller 输入明确 pass/fail marker
- 核心前端测试通过
- TypeScript 类型检查通过
- Rust test suite 通过
- anvil smoke 通过
- `git diff --check` 通过
- release 文档和状态文档已更新为当前现实

## Failure Handling

- 任何 smoke 失败都必须先分类，再修复。
- 如果失败来自环境，而不是代码，要明确记录环境原因，不伪装成产品通过。
- 如果失败来自真实回归，优先修最小闭环，再重跑相同验证。
- 如果发现功能说明与实现不一致，先改文档和状态，再决定是否需要代码修补。

## Acceptance Criteria

- 当前主线的 desktop 功能可以从新 worktree 重新验证
- P6-2 已清楚标记为完成
- release 准备态有明确的验证证据
- 不留模糊的“应该可以”结论
- 没有未解释的 P0/P1 级阻塞项

## Task Split

- P7a: Workflow And Status Records
- P7b: Release Readiness Runner
- P7c: Release Docs And Capability Wording
- P7d: Final Release Verification And Merge
