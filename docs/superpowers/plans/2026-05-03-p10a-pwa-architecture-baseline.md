# P10a PWA Architecture Baseline And Chinese Shell Plan

## Goal

Establish the initial browser-first PWA shell, Chinese information architecture, responsive layout baseline, and manifest metadata for the current PWA mainline.

## Scope

- Render the PWA shell by default.
- Present the Chinese primary navigation:
  - 账户
  - 资产
  - 分发/归集
  - 铭文刻录
  - 合约调用
  - 历史
  - 设置
- Show explicit planned / unavailable state for sections that are not yet implemented.
- Add responsive styling for narrow and wide screens.
- Add manifest metadata and installation-ready app metadata.
- Add focused tests for shell render, navigation labels, unavailable-state wording, and manifest metadata.

## Non-goals

- Do not create, import, export, or unlock any real vault in this milestone.
- Do not sign, broadcast, or submit any transaction.
- Do not store plaintext secrets in browser persistence.
- Do not add a heavy routing or state framework just for the shell.

## Implementation summary

The resulting baseline is the current PWA shell plus the browser vault/account work that follows from it. The shell is intentionally small so later milestones can add vault, assets, batch workflows, and contract tools without rewiring the runtime.

## Verification

Minimum checks for this baseline:

```bash
npm test
npm run typecheck
npm run smoke:browser
```

Finish with:

```bash
git diff --check
```

## Exit criteria

- Browser opens the PWA shell directly.
- Primary navigation is visible and usable on desktop and mobile widths.
- Manifest metadata is present and validated.
- No fake signing, broadcasting, or transaction-history behavior is introduced.
