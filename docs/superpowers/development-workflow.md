# Development Workflow

This document defines the workflow for the current browser-first PWA mainline. It is the operating rule for implementation, review, and verification.

## 1. Product mainline

- The repository is PWA-only.
- New product work, tests, and documentation updates should target the browser-first wallet workbench.
- Do not introduce non-PWA runtime assumptions or platform-specific workflows.

## 2. Document roles

- Spec / plan describe what should be built, why, and how it will be verified.
- Status describes what is currently done.
- Roadmap captures the next PWA milestones.
- README stays concise and only describes the current runtime.

## 3. Branch and task flow

- Work in a single feature branch per milestone when needed.
- Keep work scoped to the current PWA task.
- Do not modify unrelated files just because they are nearby.

## 4. Task sequence

1. Implement the current PWA task.
2. Review against spec and safety boundaries.
3. Review for code quality and test coverage.
4. Run fresh verification locally.
5. Update docs and status.

## 5. Verification

- Every change should have focused tests that match its scope.
- UI and shell changes should have component tests and browser smoke where appropriate.
- Security-sensitive changes must add redaction or safety assertions.
- Before closing a milestone, run:
  - `npm test`
  - `npm run typecheck`
  - `npm run build`
  - `npm run smoke:browser`
  - `git diff --check`

## 6. Documentation updates

- Keep README, spec, workflow, roadmap, and status aligned.
- README should only describe the current runtime.
- Roadmap should only describe future PWA work.
- Status should record the current milestone and verification state.

## 7. Collaboration rules

- Verify facts before changing code.
- Do not keep obsolete runtime references around as documentation clutter.
- Prefer small, verifiable steps over large cleanup bursts unless the task is specifically repository-wide cleanup.
