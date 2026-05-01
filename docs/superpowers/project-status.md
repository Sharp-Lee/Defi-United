# 项目状态表

本文件只记录项目现在做到哪。Spec/plan 仍记录应该怎么做、验收标准和实施步骤；状态表只维护当前 milestone、分支、提交、评审、验证、推送和合并状态。

## P6-2 Milestone

| milestone | task | branch | commit | review status | verification | pushed | merged | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P6-2a | Spec And Plan | `codex/p6-2-hot-analysis-spec` | `cbac6f8` | passed in prior SDD loop | passed in prior SDD loop | yes | no | Spec and plan baseline. |
| P6-2b | Rust Source Fetch Model | `codex/p6-2b-hot-contract-fetch` | `f290d96` | passed in prior SDD loop | passed in prior SDD loop | yes | no | Rust source fetch model. |
| P6-2c | Selector And Topic Aggregation Read Model | `codex/p6-2c-hot-contract-aggregate` | `410e302` | passed in prior SDD loop | passed in prior SDD loop | yes | no | Selector and topic aggregation read model. |
| P6-2d | Desktop Hot Contract UI | `codex/p6-2d-hot-contract-ui` | `c5a04e0` | passed in prior SDD loop | passed in prior SDD loop | yes | no | Desktop hot contract UI. |
| P6-2e | Diagnostics, Redaction, And Local Hints | `codex/p6-2e-hot-contract-diagnostics` | `799cca8` | passed in prior SDD loop | passed | yes | no | Final controller verification passed: focused diagnostics/hot-contract Vitest, `npm run typecheck`, diagnostics/hot_contract Cargo tests, `git diff --check`, and scoped rustfmt diagnostics. |
| Support | Project workflow record | `codex/project-workflow-record` | `6e302bf` | passed in prior SDD loop | passed in prior SDD loop | yes | no | Support task; included in integration branch. |
| P6-2f | Integration And Security Regressions | `codex/p6-2-hot-contract-analysis` | `c30a217` | passed | passed | yes | yes | Controller verification passed: `npm test -- src/features src/core`, `npm run typecheck`, `cargo test --manifest-path src-tauri/Cargo.toml`, `cargo test --manifest-path src-tauri/Cargo.toml hot_contract`, `scripts/run-anvil-check.sh`, and `git diff --check`. |
| P6-2 | Milestone Merge | `main` | `43e6a80` | passed | passed | yes | yes | Fast-forward merged `codex/p6-2-hot-contract-analysis` into `main`; merged-result verification passed. |

## P7 Milestone

| milestone | task | branch | commit | review status | verification | pushed | merged | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P7a | Workflow And Status Records | `codex/p7-release-readiness` | `a0710d5` | passed | passed | yes | no | Records delegated workflow and starts P7 status tracking. |
| P7b | Release Readiness Runner | `codex/p7-release-readiness` | `a313ae6` | passed | passed | yes | no | Controller verification passed: `bash -n scripts/run-release-readiness.sh`, `test -x scripts/run-release-readiness.sh`, `git diff --check`, and usage rejection for `--bogus`. |
| P7c | Release Docs And Capability Wording | `codex/p7-release-readiness` | `b57ad4a` | passed | passed | yes | no | Controller verification passed: release readiness gate docs were added to README/spec, and `git diff --check` passed. |
| P7d | Final Release Verification And Merge | `main` | `617e7d2` | passed | passed | yes | yes | `codex/p7-release-readiness` was fast-forward merged into `main`; merged-result verification passed. |

## P8 Cleanup

| milestone | task | branch | commit | review status | verification | pushed | merged | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P8a | Browser Donor Source Cleanup | `main` | `71acf57` | passed | passed | yes | yes | Browser donor source removed from the Tauri desktop mainline; merged-result verification passed on `main`. |
| P8b | Local Workspace Hygiene | local worktree cleanup | `n/a` | done | done | n/a | n/a | Root checkout now opens `main`; the old browser branch is no longer the default local entrypoint. |

## P9 Repository Hygiene

| milestone | task | branch | commit | review status | verification | pushed | merged | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P9a | 规范与执行计划 | `codex/p9-repository-hygiene` | `26f98d1` | passed | passed | yes | no | 已完成提交，记录保留/清理边界与执行步骤。 |
| P9b | 历史文档清理与 roadmap | `codex/p9-repository-hygiene` | `f99d9cd` | passed | passed | yes | no | 已删除完成的历史 spec/plan，补充 roadmap，并同步 README 与状态表。 |
| P9c | 分支与 worktree 清理 | `local branch/worktree cleanup` | `n/a` | done | done | n/a | n/a | 仅清理已合并且干净的本地 worktree 和本地/远端 `codex/*` 分支；保留未合并分支、带变更 worktree 和非 `codex` 远端分支。 |

## Next

P9 仓库清理已完成，继续下一个 roadmap milestone。
