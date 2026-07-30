# Claude Code statusline landscape — 2026-07-29

## Goal

Select a maintainable Claude Code statusline base for a workstation where
CCSwitch can launch concurrent sessions against Claude Official, CLIProxyAPI,
DeepSeek, Xiaomi MiMo, and other Anthropic-compatible relays.

The selected base must support a dense terminal UI while allowing local code to
resolve the provider and actual response model per session.

## GitHub snapshot

The following counts were retrieved from GitHub on 2026-07-29. Stars and
`updated_at` values are a point-in-time discovery aid rather than an acceptance
test.

| Repository | Stars | Updated (UTC) | Primary value |
|---|---:|---|---|
| [`jarrodwatts/claude-hud`](https://github.com/jarrodwatts/claude-hud) | 26,928 | 2026-07-29 12:27 | Context, tools, agents, todos, transcript-aware model display |
| [`sirmalloc/ccstatusline`](https://github.com/sirmalloc/ccstatusline) | 12,081 | 2026-07-29 12:18 | TUI configuration, unlimited lines, widgets, themes, import/export, custom commands |
| [`GaoSSR/best-claude-hud`](https://github.com/GaoSSR/best-claude-hud) | 2,001 | 2026-07-29 11:39 | Rust renderer and pattern-based model/context registry |
| [`nilbuild/claude-statusline`](https://github.com/nilbuild/claude-statusline) | 1,350 | 2026-07-29 11:28 | Minimal Shell implementation with a small dependency surface |
| [`Owloops/claude-powerline`](https://github.com/Owloops/claude-powerline) | 1,142 | 2026-07-28 18:26 | Powerline themes, visual configurator, project-scoped config |
| [`Nanako0129/coralline`](https://github.com/Nanako0129/coralline) | 516 | 2026-07-28 08:15 | Responsive Powerlevel10k design and `subagentStatusLine` rendering |
| [`rz1989s/claude-code-statusline`](https://github.com/rz1989s/claude-code-statusline) | 470 | 2026-07-27 07:27 | Atomic widgets and one-to-nine-line layouts |
| [`leeguooooo/claude-code-usage-bar`](https://github.com/leeguooooo/claude-code-usage-bar) | 335 | 2026-07-29 05:32 | Native rate-limit display, prompt-cache countdown, daemon fast path |

Additional configurators considered:

- [`refinist/ccstatusline-editor`](https://github.com/refinist/ccstatusline-editor)
- [`jsubroto/claude-code-statusline`](https://github.com/jsubroto/claude-code-statusline)
- [`micschr0/claudebar`](https://github.com/micschr0/claudebar)

## Selection criteria

1. A four-line observability layout must be expressible without a parallel UI
   framework.
2. The project must expose a stable widget or custom-command extension point.
3. Configuration must be exportable, reviewable, and testable.
4. The runtime can be pinned locally instead of executing `npx @latest` on each
   refresh.
5. Provider and model discovery must remain replaceable because CCSwitch can
   route multiple simultaneous Claude Code processes to different backends.
6. Upstream updates must remain mergeable into a long-lived personal branch.

## Decision

Use `sirmalloc/ccstatusline` as the base repository and maintain the work on a
dedicated fork branch.

### Why this base

- Its renderer already supports unlimited status lines and a broad widget
  registry.
- Its TUI and configuration import/export reduce manual layout work.
- Its custom-command widget supplies a low-coupling seam for local CCSwitch
  metadata.
- Its test suite already covers model context detection, transcript JSONL,
  context percentage, and widget rendering.
- A local build can be pinned in Claude Code settings, eliminating refresh-time
  network traffic and unreviewed version drift.

### Upstream ideas to reuse selectively

- From `claude-hud`: transcript-aware actual model resolution and dynamic
  agent/tool visibility.
- From `best-claude-hud`: model-pattern registry with explicit context limits.
- From `coralline`: subagent identity/model/context presentation.
- From `claude-code-usage-bar`: local-only fast refresh and native rate-limit
  behavior.

## Alternatives

### Use upstream ccstatusline without local changes

This gives the fastest initial setup. It leaves provider identity and model
alias resolution dependent on upstream behavior and therefore cannot guarantee
correct results across all CCSwitch launch modes.

### Maintain an unrelated wrapper only

A wrapper protects upstream source from changes. It makes the approved four-line
preset and provider/model widgets harder to integrate cleanly into the TUI and
golden-output tests.

### Build a new renderer

A new renderer offers complete control. It duplicates ccstatusline layout,
theme, terminal-width, configuration, and widget infrastructure with little
benefit for this use case.
