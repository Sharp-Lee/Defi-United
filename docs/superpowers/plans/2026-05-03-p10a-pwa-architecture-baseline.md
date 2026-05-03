# P10a PWA Architecture Baseline And Chinese Shell Plan

## Goal

建立 browser-first PWA 的最小架构壳、中文信息架构、移动端布局基线和 PWA installability 基线，为 P10b+ vault、账户、资产、fee panel、批量队列和 history 工作预留入口。

P10a 不实现真实 vault 解锁、助记词处理、私钥派生、签名、广播、RPC 提交或本地交易历史写入。

## Scope

- 将前端入口调整为 PWA-first shell，同时保留归档 Tauri desktop v1 作为实现参考和回归 baseline。
- 新增或调整中文默认导航和页面骨架：账户、资产、分发/归集、铭文刻录、合约调用、历史、设置。
- 为每个 PWA 页面展示明确的未完成状态和下一步能力边界，避免伪造钱包功能。
- 建立移动端布局基线：窄屏导航、底部/顶部关键操作区、卡片化内容区和安全提示区域。
- 增加 PWA manifest / app metadata / installability 基线。
- 增加 focused tests 覆盖 shell navigation、中文文案、未实现能力提示和 PWA metadata。

## Non-Goals

- 不创建、导入、导出或解锁 encrypted vault。
- 不在浏览器中保存明文助记词、私钥、密码、raw signed transaction 或签名材料。
- 不签名、不广播、不访问真实 RPC、不写入真实 transaction history。
- 不迁移归档 Tauri desktop v1 的所有功能，不删除 `src-tauri`。
- 不直接复用历史 browser donor source 作为新 PWA 主线。
- 不实现 P10b+ 的账户组、fee panel、资产扫描、批量队列、分发/归集、铭文刻录或 ABI 调用逻辑。

## Implementation Steps

1. Inspect current `src/app`, `src/features`, `src/main.tsx`, `src/styles.css`, `index.html`, and Vite/static asset setup to identify the smallest safe PWA shell insertion point.
2. Define a PWA navigation model with stable route/page ids for:
   - 账户
   - 资产
   - 分发/归集
   - 铭文刻录
   - 合约调用
   - 历史
   - 设置
3. Update the app shell to present the PWA-first Chinese layout and archived desktop baseline notice.
4. Add page skeletons or placeholder panels for P10a navigation targets, each showing:
   - planned capability summary
   - current unavailable state
   - relevant safety boundary
   - next milestone reference where useful
5. Add responsive styling for narrow screens and desktop screens without introducing a new UI framework.
6. Add PWA metadata:
   - manifest file
   - app name / short name
   - theme/background colors
   - icon references using existing safe assets or minimal generated/static placeholders already in the repo
   - `index.html` manifest/theme tags
7. Add focused tests for:
   - default Chinese shell render
   - navigation target labels
   - unavailable-state wording for sensitive capabilities
   - archived Tauri baseline notice
   - manifest metadata if practical in the existing test setup
8. Update `docs/superpowers/project-status.md` after implementation/review/verification status changes.

## Expected Files

Likely touched files:

- `index.html`
- `src/App.tsx`
- `src/app/AppShell.tsx`
- `src/app/AppShell.test.tsx`
- `src/styles.css`
- `public/manifest.webmanifest` or equivalent public PWA asset path
- `docs/superpowers/project-status.md`

Exact files may change after implementation inspection.

## Review Requirements

- Spec review must confirm P10a does not claim or implement P10b+ sensitive wallet behavior.
- Code quality review must confirm the shell remains simple and does not add premature routing/state abstractions.
- Security review focus is wording and absence of sensitive material handling, not cryptographic implementation.

## Verification

Minimum controller verification for P10a:

```bash
npm test -- src/App.test.tsx src/app/AppShell.test.tsx
npm run typecheck
git diff --check
```

If PWA metadata tests are added under another file, include that focused test file as well.

Manual UI check before reporting implementation complete:

```bash
npm run dev
```

Then open the local dev URL in a browser and verify:

- Chinese shell loads.
- All primary navigation entries are visible and selectable.
- Sensitive capabilities show planned/unavailable wording instead of fake actions.
- Narrow viewport remains usable.
- Browser devtools/Application sees the manifest.

## Exit Criteria

- Browser-first PWA shell is the visible frontend baseline.
- 中文一级导航 and page skeletons exist for all P10a target areas.
- PWA installability metadata baseline exists.
- No real vault, signing, broadcasting, RPC submission, or transaction history write path is introduced.
- Focused tests, typecheck, and `git diff --check` pass.
