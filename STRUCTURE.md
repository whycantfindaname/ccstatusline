# ccstatusline structure, ownership, and maintenance boundary

`STRUCTURE.md` is the maintenance map for Infra operators and contributors
working on this portable `ccstatusline` fork. It identifies consumers and
ownership, maps tracked source to generated artifacts and external runtime
state, and points to the commands used for maintenance and verification. It is
not the deployment procedure: use the [portable design specification](docs/superpowers/specs/2026-07-29-ccswitch-aware-statusline-design.md)
for implementation decisions and the [deployment runbook](docs/superpowers/runbooks/ccswitch-aware-statusline.md)
for operator steps.

Read `Role and repository identity` first when deciding who owns a behavior.
Use `Tracked top-level layout` and `Source structure` to locate files, then
use `Source, build, dependency, and runtime boundaries` to classify the state
you found. `Development and verification entry points` lists package and
deployment commands; `Synchronization and documentation rules` defines the
checks and evidence required before maintenance changes are accepted.

## Role and repository identity

Within Infra, this repository is the `ccstatusline` companion (manifest ID
`ccstatusline`). Its runtime consumers are:

- `claude-statusline`: Claude Code invokes the renderer for the main
  `statusLine`, the optional `subagentStatusLine`, and the managed lifecycle
  hooks.
- `cc-switch-provider-display`: the provider-aware display path, including
  optional CCSwitch provider discovery and synchronization of only the
  statusline fields in the Claude common-config consumer.

This repository is a portable fork of `sirmalloc/ccstatusline`:

- fork: `whycantfindaname/ccstatusline`;
- upstream: `sirmalloc/ccstatusline`;
- portable maintenance branch: `lwj_dev`.

When comparing this fork with upstream, inspect fresh Git refs; remote names
alone do not establish branch parity.

The upstream project supplies the general `ccstatusline` TUI, renderer,
widgets, configuration import/export, and cross-platform runtime. This fork
owns the following portable responsibilities:

- a reviewable four-line preset and non-secret provider/model registries;
- provider and actual-model resolution for concurrent Claude sessions;
- transcript/session/activity data needed by the provider display, context,
  tool, agent, cache, and session widgets;
- responsive rendering and last-known-good behavior needed by the deployed
  statusline;
- an immutable-release deployment and rollback CLI that is independent of the
  checkout's absolute path;
- field-level synchronization of only the managed statusline settings with an
  optional CCSwitch Claude common-config consumer.

The fork does not own Claude authentication, provider credentials, CCSwitch
provider records or application databases, unrelated common settings,
machine bootstrap/restore, host registries, or runtime caches. Credentials and
raw provider configuration must remain outside Git and outside the renderer's
display path.

## Ownership boundaries

### Infra

Infra selects this companion and its consumers, carries the portable source
and deployment contract, and may use a read-only deployment plan when it
activates the companion on a host. This repository owns the statusline
implementation and deployment logic; it does not own host credentials, the
`HOME` overlay, configuration registries, or CCSwitch persistence.

### Claude Code

Claude Code owns the session, transcript, stdin status JSON, authentication,
and the final loading of `statusLine`, `subagentStatusLine`, and hook commands.
The renderer reads those inputs and the selected config file. Deployment
replaces only the managed statusline fields and hook commands, preserving
unrelated Claude settings.

### CCSwitch

CCSwitch remains the authority for provider records, credentials, and its
unrelated common configuration. In `auto` mode, the deployment CLI may
discover sanitized provider IDs, labels, origins, and hostnames and merge them
with the bundled registry. When available, it may also field-merge the managed
Claude launch settings into the public common-config consumer. `off` leaves
that consumer untouched; `required` fails before any state change when
discovery or common-config access is unavailable. Rendering performs no
network request and resolves the active provider from the statusline process
environment.

## Tracked top-level layout

The table covers every tracked top-level directory. Recheck it with
`git ls-files` when the tree changes; generated and ignored directories are
described separately below.

| Directory | Ownership and contents |
| --- | --- |
| `.github/` | CI, npm publishing workflow, Dependabot, and funding metadata. The publish workflow runs only for the upstream `sirmalloc/ccstatusline` repository. |
| `.vscode/` | Editor settings, including Markdown whitespace preservation and project spelling words. |
| `config/` | Deployment source configuration under `config/statusline/`: the four-line settings preset plus provider and model registries. |
| `configTemplates/` | TUI import/export snapshots (`official-cc.json` and `personal-cc.json`); these are templates, not live Claude or CCSwitch settings. |
| `docs/` | Generic development, usage, and Windows docs plus fork-specific research, the deployment runbook, and the design specification under `docs/superpowers/`. |
| `patches/` | The tracked `ink@6.2.0` patch applied to the installed dependency tree after `bun install`. |
| `remotion/` | Remotion entry point, root, and TUI demo composition used by the `video:*` scripts. |
| `screenshots/` | Tracked README and documentation images/GIFs. They are presentation assets, not runtime configuration or live deployment evidence. |
| `scripts/` | Version replacement, dependency patch application, portable deployment/rollback helpers, example payload, and deployment/patch tests. `scripts/.gitignore` excludes local settings and payload files. |
| `src/` | The application entry point, React/Ink TUI, types, renderer utilities, widget implementations, and colocated tests. |

Important tracked root files:

- `package.json` is the package metadata and command authority. It defines the
  TUI, example, build, local-runtime, deployment, documentation, lint, and
  Remotion entry points, and publishes only `dist/`; the repository runs its
  test suite with Bun's direct `bun test` command.
- `bun.lock` is the dependency lockfile and must change with intentional
  dependency changes in `package.json`.
- `README.md` is the user-facing upstream overview plus this fork's
  four-line preset and deployment quick start.
- `STRUCTURE.md` is the Infra-facing map of this fork's owners, consumers,
  source layout, artifact boundaries, and maintenance rules.
- `AGENTS.md` is the repository guidance. `CLAUDE.md` is a symlink to it; edit
  `AGENTS.md`, never maintain a second copy.
- `tsconfig.json` defines strict, no-emit TypeScript bundler-mode checking;
  `eslint.config.js` defines the flat TypeScript/React/import/style lint
  rules; `vitest.config.ts` declares the `src/**/*.test.ts` and
  `src/**/*.test.tsx` test include patterns; and `typedoc.json` defines the
  generated API documentation entry and exclusions.
- `.gitignore` defines dependency, build, documentation, coverage, cache, and
  local-environment boundaries. `.npmignore` keeps source, tests, lockfile,
  editor files, and development configuration out of the published package.
- `LICENSE`, `NOTICE`, and `AUTHORS` are legal and attribution metadata; they
  are not deployment configuration.

## Source structure

### `config/statusline/`

- `settings.json` is the fork's four-line preset. Its lines group routing
  identity (provider, model, effort, skills, version), project/Git state (cwd,
  worktree, branch, changes, conflicts, divergence, SHA), context/cache state
  (full context, effective compact context, percentage, cache, compactions),
  and usage/activity state (tokens, agents, tools, session, native quota, and
  cost). It also carries responsive priorities, separator/color behavior, and
  the five-second Git cache TTL.
- `providers.json` is a non-secret registry of display names and normalized
  origins/hostnames. The checked-in entries include Claude Official,
  ClipProxyAPI, Claude duck relay, Xiaomi MiMo, and DeepSeek. Provider
  discovery may add sanitized entries at deployment time; credentials never
  belong here.
- `models.json` is a non-secret regex-to-display-name registry with context
  policy evidence for recognized Claude models. It is copied into a release
  and loaded through `CCSTATUSLINE_CONFIG_DIR`.

`configTemplates/official-cc.json` and `configTemplates/personal-cc.json`
are separate TUI configuration snapshots. Updating a deployment preset does
not implicitly update either template; update both only when their intended
TUI use cases also change.

### `src/`

- `src/ccstatusline.ts` is the runtime entry point. It handles version and
  `--config` selection, hook/activity and detached cache-refresh modes, piped
  Claude status JSON, `--subagent` output, and interactive TUI mode on a TTY.
- `src/tui/` contains the React/Ink configuration application, including its
  menus, editor, import/export, installation, preview, Powerline, and
  update-checker components. Component tests live under `__tests__/` beside
  the relevant code.
- `src/types/` defines the contracts shared by the renderer and widgets,
  especially `StatusJSON`, `RenderContext`, `Settings`, `Widget`, and the fork's
  `SessionIdentity` types. Type tests are colocated under `__tests__/`.
- `src/utils/` contains configuration and migration, Claude settings
  integration, rendering/terminal/color logic, the widget registry and
  manifest, JSONL/transcript parsing, session identity, provider/model
  resolution, the lifecycle activity ledger, responsive layout, Git and
  Git-review caches, hooks, usage fetching, and Powerline support. Its
  `__tests__/` tree is the main behavior and regression suite.
- `src/widgets/` contains the upstream widget catalog and fork-specific
  provider, activity, context, cache, quota, and tool widgets. Shared editors
  and display helpers live in `src/widgets/shared/`; widget tests live under
  `src/widgets/__tests__/`.

The provider display path reads `ANTHROPIC_BASE_URL` and
`ANTHROPIC_API_URL`, normalizes an origin or hostname, and falls back to a
sanitized custom hostname or `Claude Official`. Model resolution prefers the
latest valid assistant transcript model, then stdin, environment, and finally
a logical alias. This resolves display metadata; it does not authenticate with
a provider or manage provider state.

### `scripts/`

- `deploy-local.ts` is the fork-specific CLI for `--check`/`--dry-run`,
  `--apply`, and `--rollback <backup>`. It resolves Claude settings through
  `CCSTATUSLINE_SETTINGS_PATH`, `CLAUDE_CONFIG_DIR`, or the default `HOME`
  path; validates source parity, stages an immutable release, merges managed
  settings, optionally synchronizes CCSwitch, and verifies read-back.
- `deploy-utils.ts` supplies shared process, hashing, path, release, and
  command helpers used by deployment.
- `apply-install-patches.ts` applies the macOS Ink backspace patch idempotently
  during `postinstall`; `replace-version.ts` replaces the build's package
  version placeholder.
- `payload.example.json` is a safe manual renderer input. Deployment fixtures
  and tests are under `scripts/__tests__/`.

### `docs/`, `remotion/`, and `patches/`

`docs/DEVELOPMENT.md`, `docs/USAGE.md`, and `docs/WINDOWS.md` describe the
general project. `docs/superpowers/research/` records the selection and
four-line layout decisions; `docs/superpowers/specs/` is the implementation
authority for the portable CCSwitch-aware design; and
`docs/superpowers/runbooks/` is the operator entry point for deployment,
rollback, and machine migration. The links in the guide introduction are the
shortest route to the specification and runbook.

The Remotion files are demo-generation source only. `video:studio`,
`video:still`, `video:render`, and `video:gif` write generated media under the
ignored `out/` directory. The tracked `screenshots/` files are documentation
assets; their presence does not indicate a running video or application
runtime. `patches/ink@6.2.0.patch` is dependency-installation source, not an
application runtime module.

## Source, build, dependency, and runtime boundaries

### Source and dependencies

Git tracks TypeScript/TSX source, JSON configuration, tests, docs, screenshots,
the patch, package metadata, and the lockfile. `node_modules/` is ignored and
represents only a local dependency installation. `bun install` may create or
update that tree and runs the postinstall patch; it does not make dependencies
part of the repository source.

### Build and generated artifacts

The build commands intentionally generate ignored artifacts:

- `bun run build` creates `dist/ccstatusline.js`, a Node.js 14-compatible npm
  bundle, and runs the version replacement step;
- `bun run build:local-runtime` compiles the current platform's
  `dist/ccstatusline-local` deployment runtime;
- `bun run docs` creates `typedoc/`;
- Remotion commands create files under `out/`;
- tests may create `coverage/` or temporary logs/caches.

`dist/`, `node_modules/`, `typedoc/`, `out/`, coverage, and caches are not
tracked release source. A bundle or dependency tree in this checkout shows
only that an artifact was generated or dependencies were installed locally; it
does not show that Claude settings were activated or that a live
Claude/CCSwitch consumer loaded the result. Cross-machine recovery transfers
source and deployment logic, then builds a native runtime on the destination;
it must not copy a compiled runtime across platforms.

### External runtime state

The deployment target is derived from the canonical Claude settings authority,
not from this repository's parent path. By default, deployment creates the
external `statusline/` and `backups/ccstatusline/` roots beside that settings
file. Immutable releases contain `bin/`, `config/`, `manifest.json`, and
release metadata; stable dispatchers select releases through the
`active-release` and `previous-release` pointers.

Other runtime state remains outside Git, including Claude settings,
`~/.config/ccstatusline/settings.json`, activity/last-good/Git/usage caches
under the user's cache roots, CCSwitch configuration, backups, logs, and
temporary validation trees. A deployment release contains its executable,
hook, preset, and sanitized registries; its configuration payload does not
copy credentials or raw CCSwitch records.

The repository's state boundaries are explicit:

- `--check` and `--dry-run` inspect and print a plan; both are read-only;
- `--apply` and `--rollback` mutate external settings, release pointers,
  backups, and the optional CCSwitch common-config consumer, so they require
  an explicit operator decision;
- a build, a successful unit test, a printed plan, or a file under an ignored
  directory does not prove activation or live behavior;
- deployment smoke proves command and release behavior. Final visual loading
  of changed Claude settings belongs to a fresh Claude Code session.

## Development and verification entry points

Use Bun as the repository command runner:

```bash
bun install
bun run start
bun run example
bun run lint
bun test
bun test --timeout=7000 ./scripts/__tests__/deploy-local.test.ts
bun run build
bun run build:local-runtime
bun run docs
```

The full test suite runs with Bun. `vitest.config.ts` records the source test
include patterns; deployment tests are under `scripts/__tests__/` and should
be targeted explicitly when checking deployment behavior. The `lint` script
combines strict TypeScript checking with the repository's flat ESLint
configuration. Use the package scripts rather than global `eslint`, `npx`, or
direct `tsc` invocations.

Portable deployment entry points are:

```bash
bun run deploy:local --check [--ccswitch=auto|off|required]
bun run deploy:local --dry-run [--ccswitch=auto|off|required]
bun run deploy:local --apply [--ccswitch=auto|off|required]
bun run deploy:local --rollback /absolute/path/to/statusline-backup
```

`--check`/`--dry-run` are suitable for source, path, and provider inspection.
The apply path validates lint, tests, the distribution build, and the
local-runtime build before its first state change. It then stages, smoke-tests,
publishes, merges, and reads back one release. Use the runbook for the exact
target path and rollback contract.

## Synchronization and documentation rules

1. Before changing this repository, inspect `git status --short --branch`, the
   current branch, both remotes, and `git diff` against the selected fork base.
   Preserve unrelated dirty files. A remote URL alone does not establish
   upstream parity.
2. Keep the upstream delta reviewable. For an upstream update, fetch the
   selected upstream ref (for example, `git fetch origin main`), inspect the
   change against the fork base, integrate it into
   `lwj_dev` only after preserving the portable
   deployment/provider-display delta, and rerun lint, tests, builds, and the
   read-only deployment check before activation. Fetch, merge, and push are
   separate maintenance actions; editing source does not imply any of them.
3. Keep dependency changes paired: update `package.json` and `bun.lock`
   together, then run the package-script verification. Never hand-edit
   `node_modules/`, `dist/`, `typedoc/`, or `out/` as source.
4. When changing the preset or provider/model display, update the relevant
   source/tests and the fork-specific design spec/runbook. Update `README.md`,
   `docs/DEVELOPMENT.md`, `docs/USAGE.md`, or `docs/WINDOWS.md` when the
   user-facing command or platform behavior changes. Keep credentials,
   provider tokens, databases, personal paths, and runtime identifiers out of
   examples and tracked docs.
5. Update this file when a tracked top-level directory, important root entry,
   source/build/runtime boundary, Infra consumer ID, owner, or maintenance
   command changes. Keep the `AGENTS.md`/`CLAUDE.md` symlink relationship
   intact. Point to the authoritative design and runbook instead of copying
   their operational procedures here.
6. After source, branch, manifest, or deployment-contract changes, report
   source, generated, activated, and live evidence separately. Checked-in files
   establish source; generated artifacts establish generation; configuration
   read-back establishes activation; and a real Claude/CCSwitch consumer probe
   establishes live behavior.
