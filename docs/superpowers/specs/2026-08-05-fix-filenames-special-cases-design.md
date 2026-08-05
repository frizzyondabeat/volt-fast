# fix-filenames: per-file naming exceptions

## Problem

`computeRenamePlan` (`src/utils/rename-plan.ts`) applies one `FilenameConvention` uniformly to every walked file. Two categories of file don't follow the user's chosen convention:

1. **Next.js reserved filenames** (`page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`, `error.tsx`, `global-error.tsx`, `template.tsx`, `not-found.tsx`, `default.tsx`, `middleware.ts`, `instrumentation.ts`) — these are framework-required exact names, not a style choice. Renaming one breaks routing.
2. **`.css`/`.scss` files** — ecosystem convention is kebab-case regardless of what convention the user picked for JS/TS (e.g. a project using `PASCAL_CASE` for components still wants `button-group.css`, not `ButtonGroup.css`).

## Scope

- **In scope:** file basenames only, following the existing extension list (`ts`, `tsx`, `js`, `jsx`, `css`, `scss`).
- **Out of scope:** directory renaming. `walkSourceFiles` never enumerates directories and `applyRenamePlan`'s ts-morph `move()` is built around single-file moves — renaming a folder would require rewriting imports across every file in the subtree, and Next.js folder syntax (`[id]`, `(group)`, `@slot`) is structural, not a casing variant. This is a separate future feature with its own design if ever needed.
- **No new CLI flags.** No `--include-reserved` escape hatch, no configurable reserved-name list. YAGNI until someone hits the wall.

## Design

Add one pure function to `src/utils/rename-plan.ts`:

```ts
function resolveConventionForPath(
  posixPath: string,
  convention: FilenameConvention
): FilenameConvention | null
```

- Reuses `splitFirstExtension`-style logic (already in `naming.ts`) to get the basename before the first dot.
- If that basename matches the fixed reserved-name set (case-sensitive, exact match) → returns `null`.
- Else if the file's extension is `css` or `scss` → returns `'KEBAB_CASE'`.
- Else → returns `convention` unchanged (today's behavior).

`computeRenamePlan` changes minimally: for each path, call `resolveConventionForPath` first.
- `null` → push straight to `unchanged` (same bucket as already-conformant files), skip `convertBasename` entirely.
- non-null → call `convertBasename(base, resolvedConvention)` as today.

Collision detection (case-insensitive grouping across all targets, including `unchanged`) runs unmodified over the resulting target set — a reserved file colliding with a would-be rename is still caught, same as any other collision today.

`RenamePlan`'s shape (`renames` / `unchanged` / `conflicts`) is unchanged. `applyRenamePlan`, ts-morph usage, and CLI flags are untouched — this is a self-contained change to the planning step.

## Testing

Extend `tests/utils/rename-plan.test.ts` (pure function, no fs) with cases:
- `page.tsx`, `route.ts`, `layout.tsx`, `middleware.ts` → left in `unchanged` even when their names would otherwise convert to something case-shaped-differently (use a name that would visibly change under a non-matching convention to prove the exception fires, e.g. run under `SNAKE_CASE`/`PASCAL_CASE` and confirm `page.tsx` stays `page.tsx`).
- A `.css` file renamed under `PASCAL_CASE` convention still lands in `renames` targeting kebab-case, not Pascal-case.
- A `.scss` file already in kebab-case stays in `unchanged`.
- A non-reserved file whose converted target collides with an `unchanged` reserved file's name in the same directory (e.g. a stray `Page.tsx` alongside `page.tsx` on a case-insensitive filesystem) still surfaces in `conflicts`.
