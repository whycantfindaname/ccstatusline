# ccstatusline Development Guidelines

These specs cover the complete single-package project: the piped renderer,
React/Ink configuration TUI, widget system, persistence, and portable
deployment tooling. The directory retains Trellis's `frontend` package label,
but the guidance is not limited to browser UI.

## Index

| Guide | Use it for |
|---|---|
| [Repository Structure and Ownership](./directory-structure.md) | Choosing the owning layer and file location |
| [Ink Components and Widgets](./component-guidelines.md) | Building TUI screens and status-line widgets |
| [React Hooks and Side Effects](./hook-guidelines.md) | Keyboard input, effects, async work, and Claude hooks |
| [State and Persistence](./state-management.md) | TUI state, settings, migrations, caches, and deployment state |
| [Type Safety and Boundary Validation](./type-safety.md) | Zod boundaries, shared types, and forward compatibility |
| [Quality and Verification](./quality-guidelines.md) | Tests, lint, build, docs, and high-risk checks |

Start with structure, then read only the guide for the layer being changed.
Repository-wide authority remains `AGENTS.md`; portable deployment authority is
`docs/superpowers/specs/2026-07-29-ccswitch-aware-statusline-design.md`.
