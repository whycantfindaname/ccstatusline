# AGENTS.md

This file provides shared repository guidance to coding agents. `CLAUDE.md` is a
symlink to this file; edit `AGENTS.md` rather than maintaining two copies.

## Project Overview

ccstatusline is a customizable status line formatter for Claude Code CLI that displays model info, git branch, token usage, and other metrics. It functions as both:
1. A piped command processor for Claude Code status lines
2. An interactive TUI configuration tool when run without input

## Development Commands

```bash
# Install dependencies
bun install

# Run in interactive TUI mode
bun run start

# Test with piped input (use [1m] suffix for 1M context models)
echo '{"model":{"id":"claude-sonnet-4-5-20250929[1m]"},"transcript_path":"test.jsonl"}' | bun run src/ccstatusline.ts

# Or use example payload
bun run example

# Build for npm distribution
bun run build   # Creates dist/ccstatusline.js with Node.js 14+ compatibility

# Run tests
bun test

# Run tests in watch mode
bun test --watch

# Lint and type check
bun run lint      # Runs TypeScript type checking and ESLint without modifying files

# Apply ESLint auto-fixes intentionally
bun run lint:fix
```

## Portable Deployment

The fork-specific deployment authority is
`docs/superpowers/specs/2026-07-29-ccswitch-aware-statusline-design.md`; operator
steps are in `docs/superpowers/runbooks/ccswitch-aware-statusline.md`.
QoderCN uses a separate, isolated statusline deployment described in
`config/qoder/README.md`; it must never go through `deploy:local`.

```bash
# Read-only validation
bun run deploy:local --check

# State-changing installation, only when explicitly requested
bun run deploy:local --apply
```

`--apply` and `--rollback` modify the resolved Claude settings authority and may
synchronize CCSwitch common config. Do not run either command without an
explicit user request. Releases, backups, and runtime caches are generated
outside the repository. Cross-machine recovery transfers source plus deployment
logic and builds a native release on the destination; do not copy a compiled
Linux release to macOS.

## Architecture

The project has dual runtime compatibility - works with both Bun and Node.js:

### Core Structure
- **src/ccstatusline.ts**: Main entry point that detects piped vs interactive mode
  - Piped mode: Parses JSON from stdin and renders formatted status line
  - Interactive mode: Launches React/Ink TUI for configuration

### TUI Components (src/tui/)
- **index.tsx**: Main TUI entry point that handles React/Ink initialization
- **App.tsx**: Root component managing navigation and state
- **components/**: Modular UI components for different configuration screens
  - MainMenu, LineSelector, ItemsEditor, ColorMenu, GlobalOverridesMenu
  - PowerlineSetup, TerminalOptionsMenu, StatusLinePreview

### Utilities (src/utils/)
- **config.ts**: Settings management
  - Loads from `~/.config/ccstatusline/settings.json`
  - Handles migration from old settings format
  - Default configuration if no settings exist
- **renderer.ts**: Core rendering logic for status lines
  - Handles terminal width detection and truncation
  - Applies colors, padding, and separators
  - Manages flex separator expansion
- **powerline.ts**: Powerline font detection and installation
- **claude-settings.ts**: Integration with Claude Code settings.json
  - Respects `CLAUDE_CONFIG_DIR` environment variable with fallback to `~/.claude`
  - Provides installation command constants (NPM, BUNX, self-managed)
  - Detects installation status and manages settings.json updates
  - Validates config directory paths with proper error handling
- **colors.ts**: Color definitions and ANSI code mapping
- **model-context.ts**: Model-to-context-window mapping
  - Maps model IDs to their context window sizes based on [1m] suffix
  - Sonnet 4.5 WITH [1m] suffix: 1M tokens (800k usable at 80%) - requires long context beta access
  - Sonnet 4.5 WITHOUT [1m] suffix: 200k tokens (160k usable at 80%)
  - Legacy models: 200k tokens (160k usable at 80%)

### Widgets (src/widgets/)
Custom widgets implementing the Widget interface defined in src/types/Widget.ts:

**Widget Interface:**
All widgets must implement:
- `getDefaultColor()`: Default color for the widget
- `getDescription()`: Description shown in TUI
- `getDisplayName()`: Display name shown in TUI
- `getEditorDisplay()`: How the widget appears in the editor
- `render()`: Core rendering logic that produces the widget output
- `supportsRawValue()`: Whether widget supports raw value mode
- `supportsColors()`: Whether widget supports color customization
- Optional: `renderEditor()`, `getCustomKeybinds()`, `handleEditorAction()`

**Widget Registry Pattern:**
- Located in src/utils/widgets.ts
- Uses a Map-based registry (`widgetRegistry`) that maps widget type strings to widget instances
- `getWidget(type)`: Retrieves widget instance by type
- `getAllWidgetTypes()`: Returns all available widget types
- `isKnownWidgetType()`: Validates if a type is registered

**Available Widgets:**
- Model, Version, OutputStyle, VoiceStatus - Claude Code metadata display
- GitBranch, GitChanges, GitInsertions, GitDeletions, GitWorktree - Git repository status
- TokensInput, TokensOutput, TokensCached, TokensTotal - Token usage metrics
- ContextLength, ContextPercentage, ContextPercentageUsable - Context window metrics (uses dynamic model-based context windows: 1M for Sonnet 4.5 with [1m] suffix, 200k for all other models)
- BlockTimer, SessionClock, SessionCost - Time and cost tracking
- CurrentWorkingDir, TerminalWidth - Environment info
- CustomText, CustomCommand - User-defined widgets

## Key Implementation Details

- **Cross-platform stdin reading**: Detects Bun vs Node.js environment and uses appropriate stdin API
- **Token metrics**: Parses Claude Code transcript files (JSONL format) to calculate token usage
- **Git integration**: Uses child_process.execSync to get current branch and changes
- **Terminal width management**: Three modes for handling width (full, full-minus-40, full-until-compact)
- **Flex separators**: Special separator type that expands to fill available space
- **Powerline mode**: Optional Powerline-style rendering with arrow separators
- **Custom commands**: Execute shell commands and display output in status line
- **Mergeable items**: Items can be merged together with or without padding

## Bun Usage Preferences

Default to using Bun instead of Node.js:
- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun install` instead of `npm install`
- Use `bun run <script>` instead of `npm run <script>`
- Use `bun build` with appropriate options for building
- Bun automatically loads .env, so don't use dotenv

## Important Notes

- **ink@6.2.0 patch**: The project uses a patch for ink@6.2.0 to fix backspace key handling on macOS
  - Issue: ink treats `\x7f` (backspace on macOS) as delete key instead of backspace
  - Fix: Patches `build/parse-keypress.js` to correctly map `\x7f` to backspace
  - Applied idempotently during `bun install` by `scripts/apply-install-patches.ts`; this avoids Bun 1.3.14's `patchedDependencies` `EINVAL` failure
  - Patch file: `patches/ink@6.2.0.patch`
- **Build process**: Two-step build using `bun run build`
  1. `bun build`: Bundles src/ccstatusline.ts into dist/ccstatusline.js targeting Node.js 14+
  2. `postbuild`: Runs scripts/replace-version.ts to replace `__PACKAGE_VERSION__` placeholder with actual version from package.json
- **ESLint configuration**: Uses flat config format (eslint.config.js) with TypeScript and React plugins
- **Build output**: `bun run build` creates the Node.js 14-compatible distribution bundle; `bun run build:local-runtime` compiles the current platform's deployment runtime
- **Type checking and linting**: Run checks via `bun run lint` and use `bun run lint:fix` only when you intentionally want ESLint auto-fixes. Never use `npx eslint`, `eslint`, `tsx`, `bun tsc`, or any other variation directly
- **Lint rules**: Never disable a lint rule via a comment, no matter how benign the lint warning or error may seem
- **Testing**: Uses Bun's test runner across TUI, configuration, transcript, renderer, widget, Git/cache, hook, and deployment behavior
  - Run the full suite with `bun test` or `bun test --watch`
  - Deployment validation uses `bun test --timeout=7000` because process-tree deadline fixtures intentionally approach Bun's default five-second limit
  - Run deployment coverage with `bun test --timeout=7000 ./scripts/__tests__/deploy-local.test.ts`
  - Test configuration: `vitest.config.ts`
  - Manual testing is also available via piped input and TUI interaction

## Managed Repository Context

- Registry ID: `ccstatusline-qoder` (Agent Infra companion manifest `manifests/companion-repositories.json`)
- Managed branch: `qoder-statusline` (fork-only branch; no upstream mirror)
- Repository convergence authority: Agent Infra registry and sync contract (fetch, classify, pin fast-forward)
- Owner workflow + product/runtime authority: this repository's own source, `AGENTS.md`, the Qoder deployment docs below, and `README.md`
- Workflow status: `full_workflow` (initial source-verification contract)
- Read order: `AGENTS.md` -> `.jason-liao-agent-infra/README.md` -> `config/qoder/README.md` (isolated Qoder statusline deployment) -> `docs/superpowers/runbooks/ccswitch-aware-statusline.md` (operator runbook) -> `README.md`
- Update triggers: managed branch or remote change; build/release chain change; platform activation change; service/config/secret ownership change; new stable error class; a completed reusable major update flow
- Contract clause: workflow contract, human guide, and current error catalog live together under `.jason-liao-agent-infra/`; extend the initial contract only with verified build, Qoder deployment, activation, or acceptance steps
- Do not invent workflow: follow only the declared contract and the docs above; do not guess build, deploy, or activation steps
