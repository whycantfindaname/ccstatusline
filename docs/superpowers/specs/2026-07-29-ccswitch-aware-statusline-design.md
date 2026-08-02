# Portable CCSwitch-aware ccstatusline design

- **Date:** 2026-07-29
- **Updated:** 2026-08-02
- **Repository:** `sirmalloc/ccstatusline` fork

## 1. Purpose

This fork installs one opinionated four-line ccstatusline preset for Claude Code.
The installer owns ccstatusline artifacts and the statusline-related fields in
Claude settings. When CCSwitch is available, it owns the same fields in the
Claude common-config snippet used to materialize managed launch settings.

The same repository must deploy successfully on:

- a machine with Claude Code and CCSwitch;
- a machine with Claude Code and no CCSwitch command;
- a machine whose Claude config directory is selected with
  `CLAUDE_CONFIG_DIR`;
- a machine whose Claude `settings.json` is a symlink to a persistent authority;
- a checkout located at any absolute path.

Workspace bootstrap, environment restoration, configuration registries, and
CCSwitch state persistence are separate system concerns.

## 2. Product behavior

The bundled preset renders four observability lines:

```text
Provider ClipProxyAPI │ Model GPT 5.6 Sol │ Effort xhigh
cwd: /work/projects/example │ Git main* ↑2 │ CC 2.1.220
Context 58k/200k full │ Compact 58k/51k trigger (64k basis) │ Cache age 47m
Agents 2 active │ Tools 14 last turn │ Session 38m │ native quota/cost when present
```

Runtime values come from the active Claude session. Provider, model, context,
and cwd have the highest display value. Empty activity, quota, cost, and
unresolved compact-trigger fields disappear cleanly. Rendering performs no
network request.

The cwd item has a strict invariant: whenever it is visible, it is the complete
absolute `statusJSON.cwd` value. The responsive planner may hide the whole cwd
item after lower-priority fields are exhausted. It never abbreviates, replaces
the home prefix, renders only a basename, or inserts an internal ellipsis.

## 3. Source ownership

The repository owns:

- provider/model/session resolution source;
- the four-line preset under `config/statusline/`;
- lifecycle-hook activity state;
- responsive rendering and last-known-good behavior;
- a self-contained deployment and rollback CLI;
- statusline fields in the optional CCSwitch Claude common-config consumer;
- fixtures, tests, design notes, and the runbook.

The repository does not own:

- Claude authentication or account state;
- CCSwitch provider records, credentials, unrelated common settings, or recovery snapshots;
- machine bootstrap and restore scripts;
- host-specific configuration registries;
- provider credentials or raw provider configuration.

## 4. Portable path resolution

The deployment command resolves Claude settings in this order:

1. `CCSTATUSLINE_SETTINGS_PATH`;
2. `$CLAUDE_CONFIG_DIR/settings.json`;
3. `$HOME/.claude/settings.json`.

When the selected settings path is a symlink, its canonical target is the
settings authority. The default install and backup roots are derived from that
authority:

```text
<settings-directory>/
├── settings.json
├── statusline/
└── backups/
    └── ccstatusline/
```

`CCSTATUSLINE_INSTALL_ROOT` and `CCSTATUSLINE_BACKUP_ROOT` provide explicit
overrides. `CCSTATUSLINE_VALIDATION_ROOT` may point to a faster copy of the
checkout; a complete source digest must match the real checkout before it is
used.

No path is derived from the repository's parent directories. The installer has
no fixed branch name or workspace-root requirement.

## 5. Optional CCSwitch integration

Deployment supports three modes:

| Mode | Behavior |
|---|---|
| `auto` | Discover public provider metadata and, when available, synchronize the managed statusline fields in the Claude common-config snippet. Use the bundled registry and continue when CCSwitch is unavailable. |
| `off` | Use the bundled non-secret provider registry and leave the CCSwitch common-config consumer untouched. |
| `required` | Require successful provider discovery and common-config read/write access before state changes. |

The default mode is `auto`. It may be selected with
`--ccswitch=auto|off|required` or `CCSTATUSLINE_CCSWITCH_MODE`.

Successful discovery contributes only provider IDs, display labels, normalized
origins, and hostnames. URL userinfo, path, query, fragment, headers, tokens,
and raw provider records are discarded. Discovered entries are merged with the
bundled registry.

The installer reads and writes CCSwitch only through its public `config common`
CLI. Immediately before a write, it re-reads the live common config and applies
the same field-level merge used for Claude settings. Provider records,
credentials, unrelated common fields, and unrelated hooks present in that final
read—including additions made after planning—are preserved. The merged JSON is
stored in a mode-`0600` file inside a disposable `HOME` and passed with
`config common set --file`; the complete common config is never placed in
process arguments. The CLI keeps the existing `CC_SWITCH_CONFIG_DIR`, isolating
its optional live-config refresh from the Claude settings authority. At render
time provider identity is resolved from the statusline subprocess environment.

## 6. Runtime identity and activity

### Provider

1. Normalize the active process endpoint environment.
2. Match the normalized origin or hostname against the deployed registry.
3. Render a sanitized hostname for an unknown custom endpoint.
4. Render `Claude Official` when no custom endpoint is active.

### Model

1. Latest valid assistant `message.model` in the transcript.
2. Native statusline stdin model ID.
3. Active model environment.
4. Claude logical alias.

### Effort and context

Native stdin effort has priority, followed by a routed-model suffix and the
active environment. Full context, auto-compact basis, and calculated trigger
remain separate concepts. Unverified context or trigger values stay unresolved.

### Activity

Lifecycle hooks maintain a session-keyed activity ledger under
`$HOME/.cache/ccstatusline/activity/`. Raw session IDs never enter filenames.
The ledger stores only sanitized identifiers and timestamps. Transcript text,
tool input, assistant content, and credentials are excluded.

The transcript reader uses bounded tail reads, ignores malformed and synthetic
records, retains independently resolved facts, and falls back to stdin or the
environment when transcript-only data is unavailable.

## 7. Immutable release model

The default installation layout is:

```text
<settings-directory>/statusline/
├── active-release
├── previous-release
├── bin/
│   ├── ccstatusline
│   └── ccstatusline-hook
└── releases/
    └── <manifest-sha>/
        ├── bin/ccstatusline
        ├── bin/ccstatusline-render
        ├── bin/ccstatusline-hook
        ├── config/settings.json
        ├── config/providers.json
        ├── config/models.json
        ├── manifest.json
        └── README.md
```

Each release is content-addressed by a SHA-256 identity derived from its stable
manifest fields and file hashes. `builtAt` is outside that identity, making an
identical apply a no-op.

`active-release` and `previous-release` are validated 64-character release IDs
stored as ordinary files. Publication uses sibling temporary files and atomic
rename. This avoids filesystem-specific symlink replacement behavior.

Stable dispatchers read `active-release` once, validate the ID and release-root
containment, then execute one immutable release. A single refresh therefore
uses one coherent version of the executable and configuration. Preflight uses
`sha256sum` when available and otherwise uses the stock macOS
`shasum -a 256`. Renderer and hook budgets use the bundled runtime's detached
process-group supervisor, not GNU `timeout` or `timeout --kill-after`; deadline
termination covers the renderer or hook and all of its descendants.

## 8. Settings transaction

The managed Claude settings patch contains:

```json
{
  "statusLine": {
    "type": "command",
    "command": "<install-root>/bin/ccstatusline",
    "padding": 0,
    "refreshInterval": 5
  },
  "subagentStatusLine": {
    "type": "command",
    "command": "<install-root>/bin/ccstatusline --subagent"
  },
  "hooks": {
    "SessionStart": [{"matcher": "", "hooks": [{"type": "command", "command": "<install-root>/bin/ccstatusline-hook", "timeout": 2}]}],
    "SubagentStart": [{"matcher": "", "hooks": [{"type": "command", "command": "<install-root>/bin/ccstatusline-hook", "timeout": 2}]}],
    "SubagentStop": [{"matcher": "", "hooks": [{"type": "command", "command": "<install-root>/bin/ccstatusline-hook", "timeout": 2}]}],
    "SessionEnd": [{"matcher": "", "hooks": [{"type": "command", "command": "<install-root>/bin/ccstatusline-hook", "timeout": 2}]}],
    "PreToolUse": [{"matcher": "Skill", "hooks": [{"type": "command", "command": "<install-root>/bin/ccstatusline-hook", "timeout": 2}]}],
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "<install-root>/bin/ccstatusline-hook", "timeout": 2}]}]
  }
}
```

The merge is applied to both the Claude settings authority and, when enabled,
the CCSwitch Claude common-config snippet. It replaces `statusLine` and
`subagentStatusLine`, removes earlier managed hook commands, and preserves all
unrelated settings and hook entries. Legacy `ccswitch-statusline` and
`ccswitch-statusline-hook` commands are recognized as managed during migration.

Both consumers expose whole-document writes without a conditional revision/CAS
operation. Apply and rollback therefore re-read immediately before each merge
and preserve unrelated values present in that final read. State-changing
commands require a quiescent external-writer window: this client does not claim
to preserve an uncoordinated write that lands after the final read but before
the whole-document write. `--check` and `--dry-run` remain read-only.

Apply order:

1. resolve paths and optional provider discovery;
2. run lint, tests, distribution build, and local-runtime build;
3. compute the semantic plan and return early for an exact no-op;
4. create a mode-`0700` backup with mode-`0600` Claude settings and optional
   CCSwitch common-config content;
5. stage and validate the complete immutable release;
6. smoke the release wrapper and approved four-line output;
7. atomically install stable dispatchers;
8. write `previous-release`, then atomically publish `active-release`;
9. re-read and field-merge the Claude settings authority;
10. synchronize and read back the optional CCSwitch common-config consumer;
11. read back settings, pointer, manifest, stable rendering, cache, and hooks;
12. restore managed Claude settings, managed CCSwitch common-config fields, and
    release pointers from the backup after a failed state-changing step.

Backups record creation time and a seven-day `retainUntil`. Rollback field-merges
the final live read of Claude settings and CCSwitch common config with the
backed-up managed fields, preserving unrelated fields and hooks present in that
read in both consumers.

## 9. Responsive and reliability requirements

Width authority is:

1. `CCSTATUSLINE_WIDTH`;
2. `COLUMNS`;
3. the compatibility TTY probe;
4. a 100-column fallback.

The planner chooses structured variants by visibility priority, emits
separators after visibility selection, and truncates only fields that explicitly
allow value truncation. Golden and property tests cover widths 40 through 160.

The stable main dispatcher enforces a one-second warm budget and a four-second
cold budget. A successful frame is cached atomically with mode `0600`, keyed by
session plus main/subagent invocation mode. Timeout, failure, or empty renderer
output reuses that exact cache. A cold miss emits an explicit
`Statusline refreshing` frame, so the dispatcher never returns an empty
statusline.

Git insertion and deletion totals use a separate stale-while-revalidate
snapshot. The foreground renderer performs only bounded repository discovery
and cache reads. A cache miss renders `(+?,-?)`; an expired successful snapshot
renders `(+A,-D)~` while one detached refresh runs. The refresh key is derived
from the linked worktree git-dir, so sibling worktrees cannot share counts. A
mode-`0600` temporary file is atomically renamed after both staged and unstaged
diff commands complete within one five-second deadline. A single-flight lock
prevents duplicate workers, expires after 30 seconds, and is always released by
the internal refresh entrypoint. Age-based refreshes have a 30-second floor so a
slow worktree cannot remain in a continuous refresh loop; HEAD or index changes
still invalidate immediately. Failed refreshes retain the last successful
snapshot and never publish synthetic zero counts.

## 10. CLI contract

```bash
bun run deploy:local --check [--ccswitch=auto|off|required]
bun run deploy:local --dry-run [--ccswitch=auto|off|required]
bun run deploy:local --apply [--ccswitch=auto|off|required]
bun run deploy:local --rollback <backup>
```

`--check` and `--dry-run` are read-only. `--apply` performs validation before
its first state change. A successful identical rerun reports `no-op`.

## 11. Acceptance criteria

1. The checkout path has no influence on settings, install, or backup roots.
2. A machine without CCSwitch passes `--check` and `--apply` in default `auto`
   mode using bundled provider data.
3. Broken or uninitialized CCSwitch produces a concise auto-mode warning and a
   successful core deployment.
4. `required` mode fails before any state change when discovery or common-config
   access is unavailable.
5. Claude settings retain unrelated fields and contain only current managed
   command paths.
6. A symlinked settings path is patched through its canonical authority without
   replacing the runtime symlink.
7. An apply publishes and validates one immutable release through
   `active-release`; rollback restores the recorded prior pointer.
8. The four-line layout, colors, provider/model/effort, context, tools, session,
   cost, auto-compaction, and full absolute cwd behavior pass focused and golden
   tests.
9. Every dispatcher execution returns a current frame, an exact-session cached
   frame, or an explicit refresh frame.
10. A CCSwitch provider export contains the same stable statusline commands and
    managed hooks as the Claude settings authority.
11. A cold Git snapshot renders unknown, a slow worktree refreshes outside the
    foreground budget, and the next render shows the measured counts; timeout,
    stale-cache, single-flight, atomic-write, and linked-worktree tests pass.
12. Source, fixtures, generated repository configuration, commit metadata, and
    documentation contain no credentials, personal paths, runtime databases, or
    private machine identifiers.

## 12. Remaining boundary

Claude Code may require a newly started session to reload changed
`statusLine`, `subagentStatusLine`, and hook commands. Deployment smoke validates
the commands directly; final visual validation belongs to a fresh Claude
session.
