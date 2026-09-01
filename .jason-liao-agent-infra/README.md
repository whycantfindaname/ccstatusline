# ccstatusline Managed Sync

This directory is the single in-repository entry for the ccstatusline managed
workflow. The initial contract targets `lwj_dev`; Agent Infra owns repository
convergence. Source verification runs the repository lint command followed by
the complete Bun test suite.

```bash
bun run lint
bun test --timeout=30000
```

Builds, local deployment, Claude settings changes, release publication, and
runtime acceptance remain explicit operations. The initial contract does not
run `deploy:local --apply` or `--rollback`. See [errors.md](errors.md) after a
failure.
