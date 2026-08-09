# Portable ccstatusline deployment runbook

## Requirements

- Claude Code
- Bun
- Git and the standard `find`, `mktemp`, and `sed` commands
- either `sha256sum` or the stock macOS `shasum` command
- CCSwitch when provider discovery or managed common-config synchronization is desired

The installer configures ccstatusline directly. It has no machine-bootstrap,
restore-script, configuration-registry, or CCSwitch persistence dependency.

## First installation

Run from any clone location:

```bash
bun install
bun run deploy:local --check
bun run deploy:local --apply
```

The default `auto` mode tries CCSwitch provider discovery and, when available,
synchronizes the installer-owned statusline fields in the Claude common-config
snippet. A missing, broken, or uninitialized CCSwitch installation produces a
warning and continues with the bundled non-secret provider registry and direct
Claude settings installation.

Use an explicit integration policy when needed:

```bash
bun run deploy:local --check --ccswitch=off
bun run deploy:local --check --ccswitch=required
```

`required` is useful for a machine where CCSwitch provider metadata is an
acceptance requirement. Core ccstatusline installation should normally use
`auto`.

## Path selection

Claude settings resolve in this order:

1. `CCSTATUSLINE_SETTINGS_PATH`
2. `$CLAUDE_CONFIG_DIR/settings.json`
3. `$HOME/.claude/settings.json`

The install root defaults to `statusline/` beside the canonical settings file.
When the selected settings path is a symlink, the installer follows it and
keeps the symlink intact.

Optional overrides:

```bash
CCSTATUSLINE_SETTINGS_PATH=/srv/claude/settings.json \
CCSTATUSLINE_INSTALL_ROOT=/srv/claude/statusline \
CCSTATUSLINE_BACKUP_ROOT=/srv/claude/backups/ccstatusline \
  bun run deploy:local --check
```

`CCSTATUSLINE_VALIDATION_ROOT` may name a faster copy of the checkout. The
installer compares a complete source digest before trusting that copy.

## Apply behavior

Apply runs:

```text
bun run lint
bun test
bun run build
bun run build:local-runtime
```

It then creates a seven-day backup, stages one immutable release, validates
hashes and the four-line render, atomically publishes `active-release`,
field-merges Claude settings, and runs the stable main and hook commands.

The settings merge owns:

- `statusLine`
- `subagentStatusLine`
- managed `SessionStart`, `SubagentStart`, `SubagentStop`, and `SessionEnd`
  command hooks

Before each state-changing write, the installer re-reads and field-merges the
live Claude settings and optional CCSwitch common config. Unrelated fields and
hook commands present in that final read are preserved. Both consumers expose
whole-document writes without a conditional revision/CAS operation, so do not
edit them concurrently with `--apply` or `--rollback`; an uncoordinated external
write in the final read-to-write interval cannot be protected by this client.
`--check` remains read-only.

An identical rerun reports `no-op`. Generated releases, caches, backups, and
Claude settings stay outside the Git repository.

## Runtime smoke

Read `targetRoot` from `--check`, then run the stable command from a directory
outside the clone:

```bash
statusline_root=/absolute/path/reported/by/check
payload='{"session_id":"smoke","model":{"id":"claude-sonnet-4-5"},"cwd":"/work/projects/example","columns":240,"cost":{"total_duration_ms":60000},"context_window":{"context_window_size":200000,"current_usage":{"input_tokens":12000}}}'
printf '%s\n' "$payload" | "$statusline_root/bin/ccstatusline"
```

Hook smoke:

```bash
printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"smoke","source":"startup"}' \
  | "$statusline_root/bin/ccstatusline-hook"
```

The hook exits successfully and emits no output.

The main dispatcher caches successful frames under
`${XDG_CACHE_HOME:-$HOME/.cache}/ccstatusline/last-good/`. Warm renders receive
one second; cold renders receive four seconds. A timeout reuses the exact
session/mode cache, and a cold miss emits `Statusline refreshing`.

Start a new Claude Code session after apply for deterministic loading of the
new statusline and lifecycle-hook commands.

## Rollback

Use the exact backup printed by apply:

```bash
bun run deploy:local --rollback \
  /absolute/settings/directory/backups/ccstatusline/<timestamp>-statusline-setup
```

Rollback restores managed settings fields plus `active-release` and
`previous-release`. Unrelated settings present in rollback's final live read
remain present; use the same quiescent-writer rule as apply.

## Moving to another machine

Clone the published portability branch and build on the destination machine:

```bash
git clone --branch codex/portable-ccstatusline \
  https://github.com/whycantfindaname/ccstatusline.git
cd ccstatusline
bun install
bun run deploy:local --check
bun run deploy:local --apply
```

This transfers source, the preset, and deployment logic. The destination builds
its own native runtime, so do not copy a compiled Linux release directory to
macOS. Claude credentials, provider secrets, runtime databases, caches, and
machine-specific paths remain local to each machine.

## Troubleshooting

- **Bundled-provider warning:** expected in `auto` mode when CCSwitch is absent
  or unavailable. Use `--ccswitch=off` to skip discovery.
- **Provider label is a hostname:** add a non-secret origin or hostname mapping
  to `config/statusline/providers.json`, or apply with working CCSwitch
  discovery.
- **Model differs from an alias:** the newest valid assistant
  `message.model` has priority.
- **Compact trigger is absent:** the available facts establish no verified
  trigger.
- **Cwd disappears at a narrow width:** the planner hid the complete cwd item.
  Every visible cwd remains the full absolute path.
- **Statusline shows refreshing:** inspect the active release and the
  last-known-good cache. Empty dispatcher output is a defect.
- **Existing release fails validation:** retain it for inspection and resolve
  the manifest mismatch before another apply.
