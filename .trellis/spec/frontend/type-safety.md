# Type Safety and Boundary Validation

The project uses strict TypeScript plus Zod at untrusted JSON boundaries.
`tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`,
`noFallthroughCasesInSwitch`, and `noImplicitOverride`; code must remain valid
under those settings.

## Schema ownership

- `src/types/StatusJSON.ts` validates Claude status-line stdin. Its loose object
  shape intentionally tolerates upstream fields while coercing known numeric
  strings and validating fields the renderer consumes.
- `src/types/Settings.ts` validates persisted user settings, applies defaults,
  and infers the `Settings` type.
- `src/types/Widget.ts` owns `WidgetItemSchema`, responsive variants, and the
  `Widget` interface.
- Utility-specific external data contracts stay beside the utility when they
  are not shared package types, as in `src/utils/usage-types.ts`.

Parse `unknown` once at the input boundary, then pass inferred types inward.
Use `safeParse` when invalid user data should produce a recoverable result and
`parse` when applying trusted defaults or when failure is a programmer error.

## Forward compatibility

`WidgetItemSchema.type` is intentionally `string`, and `WidgetItemType` remains
`string`, so configs containing newer or unknown widget IDs can be loaded.
Runtime lookup uses `getWidget()`/`isKnownWidgetType()` in
`src/utils/widgets.ts`. Do not narrow the schema to a closed enum unless the
product explicitly abandons this compatibility contract.

Stable renamed widget IDs use `LEGACY_WIDGET_TYPE_ALIASES` and
`upgradeLegacyWidgetTypes()` rather than scattered string replacement.

## Type organization

- Define props and state interfaces next to the component when only that module
  owns them; export only when tests or another module need the contract.
- Re-export genuinely shared types through `src/types/index.ts`.
- Use `import type` for type-only imports; ESLint enforces consistent type
  imports.
- Prefer discriminated unions for state with mode-specific fields, following
  `InstallationMetadataSchema` in `src/types/Settings.ts`.
- Check indexed values before use because `noUncheckedIndexedAccess` makes
  missing array/map entries explicit.

## Anti-patterns

- Do not cast raw JSON directly to `StatusJSON`, `Settings`, or usage response
  types.
- Do not use `any` to bypass a boundary; accept `unknown`, narrow it, or define
  the real contract.
- Do not duplicate a Zod schema as a hand-written interface that can drift.
- Do not use non-null assertions to skip empty-list or missing-widget handling.
- Do not remove unknown fields from the loose Claude payload merely because the
  current renderer does not use them.

## Verification

Run `bun run lint`; this is the repository's supported combined typecheck and
ESLint command. Add boundary regressions beside the owner, such as
`src/types/__tests__/StatusJSON.test.ts` for stdin coercion and
`src/utils/__tests__/config.test.ts` for settings validation.
