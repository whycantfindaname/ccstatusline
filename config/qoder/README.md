# Qoder-specific statusline

QoderCN CLI runs its own statusline deployment, isolated from the shared
ccstatusline release that Claude Code uses. Changes here must never go through
`deploy:local` — that pipeline targets the Claude Code settings authority and
the shared release.

## Layout

- `statusline.json` — Qoder widget config; deployed to `~/.qoder-cn/ccstatusline.json`
- `ccstatusline-wrapper.sh` — Qoder entrypoint; deployed to `~/.qoder-cn/ccstatusline-wrapper.sh`
- Binary — `~/.qoder-cn/bin/ccstatusline-qoder`, built from this branch
  (NOT the shared `~/.claude/statusline` release)

Qoder references the wrapper through `~/.qoder-cn/settings.json`
(`statusLine.command`). The wrapper prefers the Qoder binary and falls back to
the shared release binary if the Qoder build is missing.

## Qoder-specific choices

- No `provider` widget (`ANTHROPIC_BASE_URL` is not meaningful for Qoder)
- No token/cache/cost/speed widgets (the Qoder API returns credits, not token
  counts; transcript usage fields are all zero)
- Extra widgets fed by Qoder-only payload fields: `credits`, `permission-mode`,
  `lines-changed`; plus `vim-mode`, `session-name`, `git-review`, `context-bar`
- The `skills` widget falls back to transcript parsing because Qoder has no
  hook system to feed the activity ledger

Known limitation: Qoder writes an internal model id (`gfmodel`) into the
transcript's assistant entries, so the model widget may flicker between the
payload display name and that id. Fix belongs upstream with Qoder or in a
Qoder-only model override; do not change the shared model resolution.

## Rebuild and redeploy

From this branch:

```bash
bun run build && bun run build:local-runtime
cp dist/ccstatusline-local ~/.qoder-cn/bin/ccstatusline-qoder
cp config/qoder/statusline.json ~/.qoder-cn/ccstatusline.json
cp config/qoder/ccstatusline-wrapper.sh ~/.qoder-cn/ccstatusline-wrapper.sh
```
