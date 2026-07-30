# CCSwitch-aware statusline research index

This directory records the public evidence and layout decisions behind the
portable statusline fork.

## Documents

- [`2026-07-29-statusline-landscape.md`](2026-07-29-statusline-landscape.md) — GitHub project comparison and selection rationale.
- [`2026-07-29-layout-decision.md`](2026-07-29-layout-decision.md) — approved four-line observability layout.
- [`../specs/2026-07-29-ccswitch-aware-statusline-design.md`](../specs/2026-07-29-ccswitch-aware-statusline-design.md) — implementation-facing design specification.

## Branch policy

- `main` tracks the upstream project.
- The fork branch owns the optional CCSwitch integration, personal preset,
  tests, deployment tooling, and research documents.
- Future upstream updates are merged into the fork branch and validated before
  deployment.
- Credentials, provider tokens, application databases, and runtime caches stay
  outside this repository.
