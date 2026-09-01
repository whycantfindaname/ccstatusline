# Qoder Statusline Managed Sync Errors

## QODER_STATUSLINE_LINT_FAILED

- Stage: project workflow.
- Meaning: the repository-defined TypeScript and ESLint command failed or
  timed out.
- Action: fix the reported source issue without disabling lint rules, then
  rerun `bun run lint`.
- Stop condition: the test stage remains blocked.

## QODER_STATUSLINE_TEST_FAILED

- Stage: project workflow.
- Meaning: `bun test --timeout=30000` failed or timed out.
- Action: fix the first failing behavior and rerun the complete test suite.
- Stop condition: do not run Qoder deployment or activation until lint and
  tests pass.
