# State and Persistence

There is no global state library. State ownership follows the boundary that can
validate and persist it.

## TUI state

`src/tui/App.tsx` owns the current `Settings`, active screen, selection indexes,
dialogs, installation metadata, update state, and user-visible flash messages.
Child components receive only the slice and callbacks they need. Update arrays
and `WidgetItem` objects immutably, following
`src/tui/components/color-menu/mutations.ts`.

Ephemeral editor state remains local to the screen that uses it. Promote state
to `App` only when navigation, save behavior, or multiple screens need the same
value. Derived catalog and preview values should be recomputed from settings,
not stored as a second authority.

## Persisted settings

`src/types/Settings.ts` owns the schema, defaults, and `CURRENT_VERSION`.
`src/utils/config.ts` is the only normal persistence boundary:

- missing settings produce and persist schema defaults;
- malformed or unreadable settings remain untouched while in-memory defaults
  are returned and `getConfigLoadError()` records the problem;
- readable old settings migrate sequentially through `src/utils/migrations.ts`
  and are written only after current-schema validation;
- saves use a sibling temporary file plus rename and preserve symlinked settings
  authorities;
- imports exclude machine-local installation/version/update-message metadata.

Any schema change must update the schema and, when old files need conversion,
increment `CURRENT_VERSION`, add a sequential migration, and extend
`src/utils/__tests__/migrations.test.ts` plus `src/utils/__tests__/config.test.ts`.
Do not silently reinterpret existing fields without migration evidence.

## Runtime and cache state

Runtime input enters as validated `StatusJSON`. Derived render data is assembled
once into `RenderContext` in `src/ccstatusline.ts` and passed to widgets. Do not
let individual widgets create competing snapshots.

Persistent caches belong to their owning utilities under the ccstatusline cache
root. Git refresh, usage prefetch, transcript tails, and activity ledgers have
separate modules and tests. Preserve render-time budgets and stale-data
contracts; network-bound Git review refreshes are detached so the status line
does not block.

## Deployment state is separate

`scripts/deploy-local.ts` manages immutable releases, backups, settings merges,
and optional CCSwitch synchronization. It is not a replacement for TUI config
saves. Its behavioral authority is
`docs/superpowers/specs/2026-07-29-ccswitch-aware-statusline-design.md`.
Read-only `--check` is distinct from state-changing `--apply` and `--rollback`.

## Anti-patterns

- Do not mutate `settings.lines` or widget metadata in place.
- Do not overwrite malformed user config while recovering with defaults.
- Do not persist derived preview, catalog, or renderer state.
- Do not use module globals for per-session render data.
- Do not perform deployment apply/rollback as part of ordinary config saving.

## Verification

Run `bun test src/utils/__tests__/config.test.ts src/utils/__tests__/migrations.test.ts`
for persistence changes. Run the owning cache tests for cache changes. For
deployment logic, run
`bun test --timeout=7000 ./scripts/__tests__/deploy-local.test.ts` and only run
`bun run deploy:local --check` when the requested work includes deployment
validation.
