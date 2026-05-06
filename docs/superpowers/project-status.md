# Project Status

This file records the current PWA-only milestones. For the broader current-state summary, see `docs/superpowers/project-overview.md`.

## P10 PWA mainline

| milestone | task | branch | commit | review status | verification | pushed | merged | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P10 | PWA direction and docs convergence | `main` | current | passed | passed | yes | yes | README, roadmap, workflow, and status are aligned to the browser-first PWA mainline. |
| P10a | PWA shell and installability baseline | `main` | current | passed | passed | yes | yes | The browser-first shell, Chinese navigation, and manifest baseline are in place. |
| P10b | Browser encrypted vault and account groups | `main` | current | passed | passed | yes | yes | The browser encrypted vault, hot session, account groups, and account derivation are implemented and tested. |
| P10c | Chain / RPC config and shared fee panel plus vault import hardening | `main` | `c8cb3c0` | passed | `npm test`; `npm run typecheck`; `npm run build`; `npm run smoke:browser`; `git diff --check` | yes | yes | Browser-side chain/RPC config, shared fee panel, password-verified vault import, stronger KDF policy, production/mobile smoke, and PWA icons are pushed to `main`. |

## Next

Continue the PWA roadmap from P10c onward and keep the repo focused on the browser runtime.
