#!/bin/sh
# QoderCN statusline wrapper: run a Qoder-specific ccstatusline build with a
# Qoder-specific config. Isolated from Claude Code's shared release binary so
# Qoder-only widgets (credits / permission-mode / lines-changed) never affect
# Claude Code.
set -u
qoder_binary="$HOME/.qoder-cn/bin/ccstatusline-qoder"
if [ -x "$qoder_binary" ]; then
  exec "$qoder_binary" --internal-supervise 4 "$qoder_binary" --config "$HOME/.qoder-cn/ccstatusline.json" "$@"
fi
# Fallback to the shared release binary if the Qoder build is missing.
statusline_root="$HOME/.claude/statusline"
release_id=$(/usr/bin/sed -n '1p' "$statusline_root/active-release" 2>/dev/null)
case "$release_id" in
  ''|*[!0-9a-f]*) printf '\033[0mStatusline release unavailable\n'; exit 0 ;;
esac
binary="$statusline_root/releases/$release_id/bin/ccstatusline"
if [ ! -x "$binary" ]; then
  printf '\033[0mStatusline release missing\n'
  exit 0
fi
exec "$binary" --internal-supervise 4 "$binary" --config "$HOME/.qoder-cn/ccstatusline.json" "$@"
