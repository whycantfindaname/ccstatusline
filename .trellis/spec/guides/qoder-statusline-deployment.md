# Qoder Statusline Deployment Guide

> **Purpose**: Isolated statusline deployment for QoderCN CLI, separate from Claude Code's shared release.

---

## Why Isolated Deployment?

QoderCN uses a different API backend that returns `credits` instead of token counts. The shared ccstatusline release targets Claude Code's transcript format and hook system. Mixing them breaks:

- Token/cache/cost widgets (Qoder returns zero for these fields)
- Model resolution (Qoder writes internal model IDs to transcripts)
- Hook-based activity tracking (Qoder has no hook system)

**Solution**: A dedicated `qoder-statusline` branch with Qoder-specific widgets and a separate deployment path.

---

## Deployment Architecture

```
~/.qoder-cn/
├── bin/
│   └── ccstatusline-qoder          # Qoder-specific binary (from qoder-statusline branch)
├── ccstatusline.json               # Qoder widget config
├── ccstatusline-wrapper.sh         # Entrypoint wrapper
└── settings.json                   # statusLine.command → wrapper
```

**Isolation boundary**: Qoder binary never touches `~/.claude/statusline/`. Claude Code's `deploy:local` never touches `~/.qoder-cn/bin/`.

---

## Build and Deploy

From the `qoder-statusline` branch (or its worktree):

```bash
# Build
bun install
bun run build
bun run build:local-runtime

# Deploy
mkdir -p ~/.qoder-cn/bin
cp dist/ccstatusline-local ~/.qoder-cn/bin/ccstatusline-qoder
cp config/qoder/statusline.json ~/.qoder-cn/ccstatusline.json
cp config/qoder/ccstatusline-wrapper.sh ~/.qoder-cn/ccstatusline-wrapper.sh
chmod +x ~/.qoder-cn/ccstatusline-wrapper.sh ~/.qoder-cn/bin/ccstatusline-qoder
```

**Configure Qoder settings** (`~/.qoder-cn/settings.json`):

```json
{
  "statusLine": {
    "command": "/home/oppoer/.qoder-cn/ccstatusline-wrapper.sh"
  }
}
```

---

## Qoder-Specific Widgets

| Widget | Source Field | Notes |
|--------|--------------|-------|
| `credits` | `payload.credits` | Replaces token/cost widgets |
| `permission-mode` | `payload.permission_mode` | Qoder-only field |
| `lines-changed` | `payload.lines_changed` | Qoder-only field |
| `vim-mode` | `payload.vim_mode` | Optional |
| `session-name` | `payload.session_name` | Optional |
| `git-review` | `payload.git_review` | Optional |
| `context-bar` | Computed | Visual context usage |

**Excluded widgets**: `provider`, `tokens-input`, `tokens-output`, `tokens-cached`, `tokens-total`, `session-cost`, `block-timer`, `session-clock` — these depend on Claude Code's transcript format or hook system.

---

## Wrapper Fallback

The wrapper script (`ccstatusline-wrapper.sh`) prefers the Qoder binary and falls back to the shared release if the Qoder build is missing:

```sh
qoder_binary="$HOME/.qoder-cn/bin/ccstatusline-qoder"
if [ -x "$qoder_binary" ]; then
  exec "$qoder_binary" --internal-supervise 4 "$qoder_binary" --config "$HOME/.qoder-cn/ccstatusline.json" "$@"
fi
# Fallback to shared release...
```

**Why fallback?**: Ensures statusline remains functional if the Qoder build is temporarily unavailable.

---

## Common Mistakes

### Don't: Use `deploy:local` for Qoder

**Problem**: `deploy:local` targets Claude Code's settings authority (`~/.claude/settings.json`) and shared release directory (`~/.claude/statusline/`). Running it for Qoder overwrites Claude Code's configuration.

**Instead**: Use the manual copy commands above. Qoder deployment is isolated by design.

### Don't: Share config between Claude Code and Qoder

**Problem**: Claude Code's `settings.json` includes token-based widgets that Qoder cannot populate. Qoder's config includes `credits` and `permission-mode` widgets that Claude Code does not emit.

**Instead**: Maintain separate config files:
- Claude Code: `~/.config/ccstatusline/settings.json` (managed by TUI or `deploy:local`)
- Qoder: `~/.qoder-cn/ccstatusline.json` (from `config/qoder/statusline.json`)

---

## Known Limitations

- **Model widget flicker**: Qoder writes an internal model ID (`gfmodel`) to transcript assistant entries. The model widget may alternate between the payload display name and the internal ID. Fix belongs upstream with Qoder or in a Qoder-only model override.

- **Skills widget fallback**: The `skills` widget falls back to transcript parsing because Qoder has no hook system to feed the activity ledger. This is less accurate than Claude Code's hook-based tracking.

---

## Testing

```bash
# Test the wrapper directly
echo '{"model":{"id":"test"},"credits":{"remaining":100}}' | ~/.qoder-cn/ccstatusline-wrapper.sh
```

Expected output includes Qoder-specific widgets (credits, permission-mode if provided).

---

## Related

- [Qoder config README](../../config/qoder/README.md) — detailed layout and rebuild instructions
- [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) — data flow across CLI boundaries
