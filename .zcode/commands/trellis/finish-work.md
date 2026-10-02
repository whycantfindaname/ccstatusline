# Finish Work

Wrap up the current session: archive the active task (and any other completed-but-unarchived tasks the user wants to clean up) and record the session journal. Resolve the user's commit decision in workflow Phase 3.4. An explicit decision to leave verified work uncommitted permits completion with the dirty paths preserved. This command creates no commits.

## Step 1: Survey current state

```bash
python3 ./.trellis/scripts/get_context.py --mode record
```

This prints:

- **My active tasks** — review whether any besides the current one are actually done (required checks and acceptance criteria met) and should be archived this round.
- **Git status** — quick visual on what's dirty.
- **Recent commits** — record actual work-commit hashes in Step 4 only when such commits exist; `--commit` is evidence, never approval.

If `--mode record` surfaces other completed tasks not tied to the current session, surface them to the user with a one-shot confirmation: "These N tasks look done — archive them too in this round? [y/N]". Default is no; the current active task is always archived in Step 3 regardless.

## Step 2: Sanity check — classify dirty paths

Run:

```bash
git status --porcelain
```

Compare every dirty path, including `.trellis/workspace/` and
`.trellis/tasks/`, with the recorded baseline. Distinguish this task's changes,
pre-existing changes, and concurrent changes before archiving or writing the
journal; their location alone does not establish ownership. Preserve unrelated
records and archive only the current accepted task or separately confirmed
tasks. Archive and journal writes use `--no-commit` and may leave owned
bookkeeping dirty. Keep `session_auto_commit: false` in `.trellis/config.yaml`.
Do not stage or commit those records automatically.

For each remaining dirty path, decide whether it belongs to **the current task** or to **other parallel work** (e.g., another terminal window editing the same repo). Heuristics:

- Paths referenced in the current task's `prd.md` / `implement.jsonl` / `check.jsonl` → current task
- Paths in code areas matching the task's stated scope, or that you remember editing this session → current task
- Paths in unrelated areas you have no recollection of touching this session → other parallel work

Then route:

- **Current-task changes with an unresolved commit decision** — show the owned
  paths and resolve the choice in Phase 3.4 before archiving. Reuse an earlier
  explicit decision covering the same repository and scope.
- **The user explicitly declined a commit or chose manual handling** — record
  that decision, preserve the dirty paths, and continue. No later manual commit
  or clean working tree is required; checks and acceptance must still pass.
- **An approved commit has not been made** — complete only that approved scoped
  plan in Phase 3.4, or obtain the user's revised decision before continuing.
- **Unrelated or parallel changes** — report them once, preserve them, and
  continue. If ownership is unclear, ask before changing or including them.

## Step 3: Archive task(s)

```bash
python3 ./.trellis/scripts/task.py archive <task-name> --no-commit
```

At minimum: the current active task (if any). Plus any extra tasks the user confirmed in Step 1. Archive only tasks that meet their acceptance criteria. `--no-commit` writes the archive without staging or committing; retain and report any resulting bookkeeping changes.

If there is no active task and the user did not confirm any cleanup archives, skip this step.

## Step 4: Record session journal

```bash
python3 ./.trellis/scripts/add_session.py --no-commit \
  --title "Session Title" \
  --commit "hash1,hash2" \
  --summary "Brief summary"
```

Use only actual work-commit hashes for `--commit`. When no work commit was
approved or made, omit `--commit` and record the uncommitted paths and the user's
decision in the summary. The argument records evidence and grants no permission
to stage, commit, or push. `--no-commit` writes the journal without creating a
`chore` commit.

Report verified work, the commit decision, archived tasks, saved journal, and
remaining owned/parallel/bookkeeping changes separately. Any separately
approved commit follows workflow Phase 3.4 and its canonical Agent Infra
**Commit provenance** reference; publication retains its own approval gate.
