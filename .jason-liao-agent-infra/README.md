# Qoder Statusline Managed Sync

This directory is the single in-repository entry for the Qoder statusline
managed workflow. The initial contract targets the fork-only
`qoder-statusline` branch; Agent Infra owns repository convergence. Source
verification runs the repository lint command followed by the complete Bun
test suite.

```bash
bun run lint
bun test --timeout=30000
```

QoderCN configuration, isolated deployment, runtime activation, and acceptance
remain explicit platform operations. This branch must not use the Claude
`deploy:local` path. See [errors.md](errors.md) after a failure.
