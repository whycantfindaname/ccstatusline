# Quality and Verification

Verification should target the behavior changed, then cover the executable
contract when the change crosses layers.

## Supported commands

```bash
bun test
bun run lint
bun run build
bun run example
bun test --timeout=7000 ./scripts/__tests__/deploy-local.test.ts
bun run deploy:local --check
```

Use `bun test <test-path>` for the nearest regression while iterating. Run the
full suite for changes to shared types, config, renderer, widget registry,
transcript parsing, or executable orchestration. `bun run lint` is the only
supported combined typecheck/lint command; use `bun run lint:fix` only when
intentional source rewriting is part of the task.

Run `bun run build` when distribution imports, the entry point, or version
replacement can be affected. The build must preserve Node.js 14+ compatibility
even though development and tests use Bun.

## Test patterns

- Use Vitest-style `describe`, `it`, and `expect` imports; Bun executes these
  tests through `bun test`.
- Put tests beside the owning layer in `__tests__/`.
- Prefer direct pure-function tests for state transitions, as in
  `src/tui/components/color-menu/__tests__/mutations.test.ts`.
- Use table-driven cases for shared family contracts, as in
  `src/widgets/__tests__/GitWidgetSharedBehavior.test.ts`.
- Assert visible width and ANSI-sensitive behavior with renderer helpers rather
  than JavaScript string length; `src/utils/__tests__/renderer-flex-width.test.ts`
  is the reference.
- Sandbox filesystem and subprocess tests with temporary directories and
  explicit environment variables. Usage probes must set `HOME`, `USERPROFILE`,
  `CLAUDE_CONFIG_DIR`, and proxy variables so they cannot touch live caches.
- Deployment tests need `--timeout=7000` because process-tree deadline fixtures
  approach Bun's default five-second limit.

## High-risk boundaries

The deployment contract preserves unrelated Claude and CCSwitch settings,
handles symlinked authorities, and separates read-only discovery from apply.
For changes under `scripts/deploy-*`, test final-read field merges, rollback,
path containment, and no-op behavior according to
`docs/superpowers/specs/2026-07-29-ccswitch-aware-statusline-design.md`.
Never use `--apply` or `--rollback` merely as a test command.

Config recovery must preserve malformed source files. Renderer changes must
keep terminal width, ANSI reset, non-breaking spaces, empty-widget collapse,
responsive priorities, and Powerline indices coherent. Widget data acquisition
must respect the render deadline and avoid synchronous network calls.

## Forbidden patterns

- Never disable an ESLint rule with a source comment.
- Do not invoke `npx eslint`, bare `eslint`, `tsx`, or direct `bun tsc`; use the
  package scripts.
- Do not update snapshots or expected strings without checking the user-visible
  terminal behavior they encode.
- Do not make tests read a developer's real home, Claude config, or caches.
- Do not hand-edit `dist/ccstatusline.js` or claim build output is deployed.
- Do not run deployment apply/rollback without explicit authorization.

## Documentation

Update `README.md` or `docs/USAGE.md` for user-visible behavior,
`docs/DEVELOPMENT.md` for developer/runtime contracts, and the portable design
plus runbook when deployment ownership or operator steps change. Tests and a
local build prove repository behavior, not installation on a live machine.
