# Ink Components and Widgets

The project has two compositional UI units: React/Ink components used by the
configuration TUI and `Widget` implementations used by the status-line
renderer. They share `WidgetItem` data but have different responsibilities.

## Ink component pattern

Components are typed functions or `React.FC` values with explicit prop
interfaces. `src/tui/components/MainMenu.tsx` and
`src/tui/components/StatusLinePreview.tsx` demonstrate the local pattern:

- receive state and callbacks through typed props;
- render with Ink primitives such as `Box` and `Text`;
- use `List` for consistent terminal selection behavior;
- report actions upward rather than writing settings directly;
- keep labels, disabled states, help text, and escape behavior visible in the
  screen that owns the interaction.

`src/tui/App.tsx` owns screen navigation and persistence coordination. A child
screen should not invent an independent navigation protocol or mutate the
settings file.

## Widget contract

Every rendered widget implements `Widget` from `src/types/Widget.ts`. The
required methods define its catalog metadata, editor representation,
capabilities, and render behavior. Optional editor behavior belongs behind
`renderEditor`, `getCustomKeybinds`, and `handleEditorAction` on that same
implementation.

To add a widget:

1. Implement it under `src/widgets/` using a nearby widget from the same family.
2. Export it from `src/widgets/index.ts`.
3. Add exactly one constructor entry to `WIDGET_MANIFEST` in
   `src/utils/widget-manifest.ts`.
4. Add focused tests under `src/widgets/__tests__/` and update shared behavior
   tables when the widget joins an existing family.

`src/widgets/__tests__/GitWidgetSharedBehavior.test.ts` is the reference for
table-driven family invariants. Shared display or mutation logic belongs in
`src/widgets/shared/`, as shown by `src/widgets/shared/usage-display.ts`.

## Rendering rules

- `render()` returns `string | null`; use `null` when the widget has no honest
  value so empty items collapse cleanly.
- Read runtime data from `RenderContext`, not directly from stdin or the TUI.
- Keep expensive shared acquisition in orchestration/utilities. The entry point
  prefetches transcript, usage, skills, and speed data only when active widget
  types require them.
- Preserve renderer ownership of color, padding, separators, responsive layout,
  ANSI width, and Powerline composition in `src/utils/renderer.ts`.
- Keep editor updates immutable: return a new `WidgetItem` or `null`, never
  mutate the input object.

## Terminal interaction and accessibility

Accessibility here means predictable keyboard operation and readable terminal
feedback. Preserve Escape/back navigation, disabled-option explanations,
visible focus/selection, and text that remains understandable without color.
The macOS Backspace behavior depends on `patches/ink@6.2.0.patch` applied by
`scripts/apply-install-patches.ts`; do not work around it independently in each
component.

## Anti-patterns

- Do not make widgets call `console.log`; the entry point owns output lines.
- Do not duplicate a widget's display name or category in a TUI component;
  obtain catalog data through `src/utils/widgets.ts`.
- Do not hide side effects in render functions or React render bodies.
- Do not add CSS, DOM, or browser accessibility conventions to Ink components.
- Do not add a widget class without manifest registration and a regression test;
  an exported but unregistered widget is unreachable.

## Verification

Run the affected component/widget test directly with `bun test <test-path>`.
For catalog or renderer integration, also run
`bun test src/utils/__tests__/widgets.test.ts` and `bun run lint`.
