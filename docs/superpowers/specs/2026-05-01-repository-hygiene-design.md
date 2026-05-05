# Repository Hygiene Design

## Goal

Keep the repository aligned with the current browser-first PWA mainline by removing obsolete runtime references and retaining only high-signal documentation.

## Scope

- Keep the PWA runtime as the only product mainline.
- Keep durable documentation in the current source tree.
- Remove obsolete milestone wording after its results are reflected in README, product spec, workflow, status, and roadmap.
- Preserve current source-of-truth docs for future PWA work.

## Non-goals

- Do not rewrite git history.
- Do not claim future PWA capabilities as implemented.
- Do not remove current product safety boundaries from README or the product spec.

## Documentation retention policy

Keep:

- `README.md`: current capabilities, install/run, validation, safety boundaries, and key paths.
- `docs/specs/evm-wallet-workbench.md`: current product spec and capability boundary.
- `docs/superpowers/development-workflow.md`: implementation and verification workflow.
- `docs/superpowers/project-status.md`: current milestone status table.
- `docs/superpowers/roadmap.md`: future PWA milestone candidates and non-goals.

Remove or rewrite:

- Completed milestone plans whose durable results are already summarized elsewhere.
- Obsolete design docs that contradict the PWA-only runtime.
- Runtime references that no longer exist in the source tree.

## Acceptance criteria

- Current docs describe the PWA-only mainline.
- Roadmap captures future PWA candidates without implying they are implemented.
- Status records the current PWA milestone state.
- Validation commands target the browser-first stack.
- `git diff --check` passes.
