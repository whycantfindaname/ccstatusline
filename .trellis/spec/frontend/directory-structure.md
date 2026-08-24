# Repository Structure and Ownership

ccstatusline is one TypeScript package with two user-facing modes: a piped
status-line renderer and an interactive React/Ink configuration TUI. Keep code
in the layer that owns the behavior instead of treating `src/tui/` as a web
frontend.

## Runtime flow

`src/ccstatusline.ts` is the executable boundary. It reads stdin with Bun or
Node-compatible APIs, validates the payload with `StatusJSONSchema`, computes
only the metrics required by configured widgets, and delegates formatting to
`src/utils/renderer.ts`. With no piped input, it launches `runTUI()` from
`src/tui/index.tsx`.

Do not put widget-specific formatting, transcript parsing, Git commands, or
settings persistence directly in the entry point. Those belong in widgets or
the relevant utility module.

## Directory ownership

```text
src/ccstatusline.ts        executable orchestration and mode selection
src/tui/                   React/Ink screens and keyboard interaction
src/widgets/               one status-line widget implementation per file
src/widgets/shared/        behavior reused by widget families
src/utils/                 rendering, config, transcript, Git, usage, hooks
src/types/                 Zod schemas and shared TypeScript contracts
scripts/                   build helpers and portable deployment tooling
config/statusline/         fork-owned deployment preset and registries
configTemplates/           user-selectable config examples
docs/                      user, developer, design, and operator guidance
```

Tests are colocated in `__tests__/` directories beside the owning layer. For
example, renderer regressions live in `src/utils/__tests__/`, widget behavior in
`src/widgets/__tests__/`, TUI behavior in `src/tui/**/__tests__/`, and deployment
behavior in `scripts/__tests__/`.

## Placement rules

- Add a status-line item under `src/widgets/`, export it from
  `src/widgets/index.ts`, and register it in `src/utils/widget-manifest.ts`.
- Put family-wide widget behavior under `src/widgets/shared/`; the Git widgets
  and usage widgets are the established examples.
- Extract keyboard/state transformations from large Ink components when they
  can be pure. `src/tui/components/color-menu/mutations.ts` and
  `src/tui/components/items-editor/input-handlers.ts` are the reference shape.
- Put external payload and persisted-config schemas in `src/types/`, then
  validate at the boundary before utilities or components consume the data.
- Keep generated distribution output in `dist/`; do not hand-edit it.
- Treat `docs/superpowers/specs/2026-07-29-ccswitch-aware-statusline-design.md`
  as the authority for the fork's portable deployment behavior.

## Naming

React component and widget implementation files use PascalCase. Utilities use
kebab-case. Test names mirror the behavior or source module they cover. Widget
type IDs are stable kebab-case strings such as `git-branch` and
`context-percentage`; changing one requires explicit compatibility handling,
as demonstrated by `LEGACY_WIDGET_TYPE_ALIASES` in `src/utils/widgets.ts`.

## Anti-patterns

- Do not create a second widget registry or a component-local list of widget
  types; `WIDGET_MANIFEST` is the source of truth.
- Do not bypass `src/utils/config.ts` to write live settings.
- Do not mix the portable deployment transaction into normal TUI saves.
- Do not import from `dist/` in source or tests.
- Do not add browser-only assumptions: the UI is terminal-based Ink and the
  built artifact must run on Node.js 14+.

## Verification

Run `bun run lint` after structural TypeScript changes. Run the nearest
colocated tests first, then `bun test` for cross-layer changes. Run
`bun run build` when the executable or its imports change.
