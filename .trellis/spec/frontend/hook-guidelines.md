# React Hooks and Side Effects

ccstatusline uses React hooks inside the Ink TUI; it does not use a server-state
or browser data-fetching framework. Keep hook use tied to terminal interaction,
screen lifecycle, and derived callbacks.

## Local hook pattern

`src/tui/App.tsx` is the main reference for `useState`, `useEffect`, and
`useCallback`. Screen components use Ink's `useInput` to map keys to callbacks
supplied by their owner.

- Call hooks only at component top level.
- Include every captured value in effect/callback dependencies; the repository
  enforces `react-hooks/rules-of-hooks` and reports exhaustive-deps warnings.
- Clean up timers, subscriptions, and asynchronous lifecycle work in the effect
  cleanup function.
- Keep a screen's keyboard map in one `useInput` handler or delegate complex
  transitions to a pure helper.
- Use functional state updates when the result depends on previous state.

Complex input transitions should be testable without mounting the full TUI.
`src/tui/components/items-editor/input-handlers.ts` takes explicit state,
catalog, key, and setter interfaces; `src/tui/components/color-menu/mutations.ts`
contains immutable pure transformations.

## Async work

Async operations such as config loading, update checks, package inspection,
font checks, and installation are coordinated by `src/tui/App.tsx` and utility
modules. Components receive the resulting state and action callbacks.

When an effect starts async work, guard against applying stale results after a
screen change or unmount when that race is reachable. Errors that affect the
user must become visible TUI state; background best-effort probes may degrade
only where the existing utility contract explicitly allows it.

## Non-React hooks

Claude lifecycle hooks are a different subsystem. Their desired set is derived
from active widgets and synchronized by `src/utils/hooks.ts` after a successful
settings save. Hook input is handled at the executable boundary through
`src/utils/hook-handler.ts`. Do not confuse these command hooks with React
hooks or install them from a component render path.

## Anti-patterns

- Do not introduce a custom hook solely to wrap one trivial `useState` call.
- Do not omit dependencies to suppress reruns or disable a lint rule in a
  comment; repository rules explicitly forbid lint suppressions.
- Do not duplicate a large key-handling state machine across components.
- Do not fetch usage, parse transcripts, or run Git commands from React render.
- Do not write Claude hook configuration before the underlying settings save
  succeeds.

## Verification

Run `bun run lint` for hook-rule validation. Exercise extracted input logic with
its colocated test, such as
`bun test src/tui/components/items-editor/__tests__/input-handlers.test.ts`.
Run `bun test src/utils/__tests__/hooks.test.ts src/utils/__tests__/hook-handler.test.ts`
when Claude lifecycle hook behavior changes.
