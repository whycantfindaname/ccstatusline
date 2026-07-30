# Statusline layout decision — 2026-07-29

## Decision process

Three layouts were compared with representative CCSwitch data:

### A. Single-line compact

```text
ClipProxyAPI │ GPT 5.6 Sol · xhigh │ ctx ████░ 62% │ Q-Anchor main*
```

This minimizes vertical space and compresses or hides activity details.

### B. Two-line balanced

```text
ClipProxyAPI │ GPT 5.6 Sol · xhigh │ Q-Anchor git:main*
Context ██████░░░░ 62% │ cache 47m │ agents 2
```

This balances daily readability and observability.

### C. Four-line observability — selected

```text
Provider ClipProxyAPI │ Model GPT 5.6 Sol │ Effort xhigh
cwd: /work/projects/example │ Git main* ↑2 │ CC 2.1.220
Context 58k/200k full │ Compact 58k/51k trigger (64k basis) │ Cache age 47m
Agents 2 active │ Tools 14 last turn │ Session 38m │ native quota/cost when present
```

The user selected layout C because long-running Claude Code sessions,
background agents, CCSwitch routing, and context-limit diagnosis benefit from
persistent visibility.

## Required behavior

1. The renderer supports four configured lines at normal terminal widths.
2. Empty dynamic widgets disappear without leaving dangling separators.
3. Width resolution uses explicit override → Claude Code `COLUMNS` →
   compatibility probe → 100-column fallback.
4. A responsive planner shortens or hides structured fields by priority before
   applying value truncation.
5. Session-scoped `cc-switch start` launches retain independent routing sources.
6. Global-provider sessions display routing variables hot-applied from live
   settings on later refreshes.
7. Full context, compact calculation basis, and calculated trigger remain
   separate labels.
8. Native 5-hour/7-day quota and cost fields appear only when supplied by
   Claude Code.
9. The refresh path performs no network request.
10. A visible cwd is the complete absolute path; narrow layouts hide it as one
    item after lower-priority fields instead of abbreviating its value.

## Field priority

### Line 1 — routing identity

1. Provider
2. Actual model
3. Effort

### Line 2 — workspace identity

1. Complete absolute working directory
2. Git branch and dirty/ahead/behind state
3. Claude Code version

### Line 3 — context health

1. Full model context usage
2. Auto-compact trigger when calculable
3. Auto-compact calculation basis
4. Prompt-cache age, without assuming a provider-independent TTL

### Line 4 — activity

1. Active subagent count from the session-keyed lifecycle-hook ledger
2. Tool-use count since the latest human prompt, excluding tool-result records
3. Session duration
4. Native quota and cost fields

## Visual style

The initial preset uses a dark-terminal-safe palette:

- Provider: warm orange
- Actual model: cyan
- Effort: purple
- Project: yellow
- Git: magenta
- Healthy context: green
- Cache: blue
- Agent activity: pink
- Secondary labels: dim gray

Colors must remain configurable through ccstatusline. The preset should also
render legibly with ANSI disabled.

## Refresh interval

Start with `refreshInterval: 5` seconds. This keeps session time and cache
freshness useful while leaving enough budget for a local transcript tail scan
and Git query. A one-second refresh can be evaluated after benchmarks show a
stable sub-50-millisecond hot path.
