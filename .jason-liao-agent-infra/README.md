# ccstatusline Managed Sync

This directory is the single in-repository entry for the ccstatusline managed
workflow. The initial contract targets `lwj_dev`; Agent Infra owns repository
convergence. Source verification runs the repository lint command followed by
the complete Bun test suite.

```bash
bun run lint
bun test --timeout=30000
```

## Deployment Paths

This branch manages two isolated deployment targets:

1. **Claude Code** (shared release): `bun run deploy:local --apply` targets
   `~/.claude/statusline/` and `~/.claude/settings.json`. Builds from `main`
   or `lwj_dev` source.

2. **QoderCN** (isolated): Manual deployment from the `qoder-statusline`
   branch to `~/.qoder-cn/bin/ccstatusline-qoder` and `~/.qoder-cn/`.
   See [Qoder Statusline Deployment Guide](../.trellis/spec/guides/qoder-statusline-deployment.md).

Builds, local deployment, Claude settings changes, release publication, and
runtime acceptance remain explicit operations. The initial contract does not
run `deploy:local --apply` or `--rollback`. See [errors.md](errors.md) after a
failure.
