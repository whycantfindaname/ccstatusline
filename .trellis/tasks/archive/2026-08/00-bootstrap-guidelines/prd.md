# Bootstrap Task: Project Development Guidelines

## Goal

Replace the Trellis initialization scaffolding with source-backed guidance for
ccstatusline's piped renderer, React/Ink TUI, widget system, configuration
persistence, and portable deployment boundary.

## Completed checklist

- [x] Replace all frontend guideline scaffolding with project-specific rules.
- [x] Include real source, test, documentation, and command examples.
- [x] Document component, hook, state, type-safety, and quality conventions.
- [x] Keep `.trellis/spec/frontend/index.md` aligned with the final file set.
- [x] Remove non-applicable generic thinking guides copied from Trellis itself.
- [x] Verify the developer identity resolves to `jasonliao`.

## Evidence reviewed

- Repository authority: `AGENTS.md` and its `CLAUDE.md` symlink.
- Runtime: `src/ccstatusline.ts`, `src/utils/renderer.ts`, and
  `src/types/StatusJSON.ts`.
- TUI: `src/tui/App.tsx`, `src/tui/components/`, and extracted mutation/input
  helpers with colocated tests.
- Widget system: `src/types/Widget.ts`, `src/utils/widget-manifest.ts`,
  `src/utils/widgets.ts`, `src/widgets/`, and shared-family tests.
- Persistence: `src/types/Settings.ts`, `src/utils/config.ts`,
  `src/utils/migrations.ts`, and their tests.
- Quality and deployment: `package.json`, `tsconfig.json`, `eslint.config.js`,
  `docs/DEVELOPMENT.md`, the portable deployment design/runbook, and
  `scripts/__tests__/deploy-local.test.ts`.

## Result

The final guideline set is `.trellis/spec/frontend/`. It retains the initialized
package path for Trellis compatibility while explicitly covering the whole
single-package project rather than presenting ccstatusline as a browser app.
