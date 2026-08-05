# fix-filenames Special-Case Naming Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `computeRenamePlan` skip Next.js reserved filenames entirely and always force `.css`/`.scss` files to kebab-case, regardless of the chosen `FilenameConvention`.

**Architecture:** Add one pure function `resolveConventionForPath` to `src/utils/rename-plan.ts` that, per file, returns the `FilenameConvention` to actually use (or `null` to skip renaming). `computeRenamePlan` calls it before `convertBasename` instead of using the requested convention directly. No other files change.

**Tech Stack:** TypeScript, Vitest.

## Global Constraints

- No new CLI flags — no `--include-reserved`, no configurable reserved-name list (spec: Scope).
- Directory renaming stays out of scope entirely — this plan only touches file basename logic (spec: Scope).
- `RenamePlan`'s shape (`renames` / `unchanged` / `conflicts`) must not change (spec: Design).
- Reserved-name matching is case-sensitive, exact match on the basename before the first extension (spec: Design).
- `.css`/`.scss` files always resolve to `'KEBAB_CASE'` regardless of the requested convention (spec: Design).

---

### Task 1: Add `resolveConventionForPath` and wire it into `computeRenamePlan`

**Files:**
- Modify: `src/utils/rename-plan.ts`
- Test: `tests/utils/rename-plan.test.ts`

**Interfaces:**
- Consumes: `FilenameConvention` from `../generators/types.js` (already imported in `rename-plan.ts`); `convertBasename` from `./naming.js` (already imported).
- Produces: `resolveConventionForPath(posixPath: string, convention: FilenameConvention): FilenameConvention | null` — not exported (internal to `rename-plan.ts`), used only by `computeRenamePlan` in the same file.

- [ ] **Step 1: Write the failing tests**

Add to `tests/utils/rename-plan.test.ts` (append inside the existing `describe('computeRenamePlan', ...)` block, before the final closing `});`):

```typescript
  it('never renames Next.js reserved filenames', () => {
    const plan = computeRenamePlan(
      ['app/dashboard/page.tsx', 'app/api/users/route.ts', 'middleware.ts'],
      'PASCAL_CASE'
    );
    expect(plan.renames).toEqual([]);
    expect(plan.unchanged).toEqual([
      'app/dashboard/page.tsx',
      'app/api/users/route.ts',
      'middleware.ts',
    ]);
    expect(plan.conflicts).toEqual([]);
  });

  it('forces css/scss files to kebab-case regardless of the chosen convention', () => {
    const plan = computeRenamePlan(
      ['src/styles/ButtonGroup.css', 'src/styles/CardLayout.scss'],
      'PASCAL_CASE'
    );
    expect(plan.renames).toEqual([
      { from: 'src/styles/ButtonGroup.css', to: 'src/styles/button-group.css' },
      { from: 'src/styles/CardLayout.scss', to: 'src/styles/card-layout.scss' },
    ]);
  });

  it('treats an already-kebab-case css file as unchanged even under a non-kebab convention', () => {
    const plan = computeRenamePlan(['src/styles/button-group.css'], 'PASCAL_CASE');
    expect(plan.unchanged).toEqual(['src/styles/button-group.css']);
    expect(plan.renames).toEqual([]);
  });

  it('flags a conflict between a reserved file and a colliding renamed file', () => {
    const plan = computeRenamePlan(
      ['app/page.tsx', 'app/Page.tsx'],
      'KEBAB_CASE'
    );
    // page.tsx is reserved -> unchanged, target "page.tsx"
    // Page.tsx -> kebab-case -> "page.tsx" -- same target, case-insensitively
    expect(plan.renames).toEqual([]);
    expect(plan.unchanged).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].sources.sort()).toEqual(
      ['app/Page.tsx', 'app/page.tsx'].sort()
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- rename-plan`
Expected: FAIL — the new tests fail because reserved filenames currently get renamed by convention and CSS files currently follow the requested convention instead of always kebab-case (e.g. `page.tsx` under `PASCAL_CASE` becomes `Page.tsx` under current behavior instead of staying `page.tsx`).

- [ ] **Step 3: Implement `resolveConventionForPath`**

In `src/utils/rename-plan.ts`, add this near the top (after `toPosix`, before `computeRenamePlan`):

```typescript
const NEXTJS_RESERVED_BASENAMES = new Set([
  'page',
  'layout',
  'route',
  'loading',
  'error',
  'global-error',
  'template',
  'not-found',
  'default',
  'middleware',
  'instrumentation',
]);

/** Returns the FilenameConvention that should actually apply to this file's
 * basename, or null if the file must never be renamed. Next.js reserved
 * filenames (page.tsx, route.ts, etc.) are exact framework requirements, not
 * a style choice, so they're always left untouched. CSS/SCSS basenames
 * always use kebab-case, independent of the requested convention, matching
 * ecosystem norms regardless of what convention the rest of the project uses. */
function resolveConventionForPath(
  posixPath: string,
  convention: FilenameConvention
): FilenameConvention | null {
  const base = path.posix.basename(posixPath);
  const dotIndex = base.indexOf('.');
  const nameBeforeExt = dotIndex <= 0 ? base : base.slice(0, dotIndex);

  if (NEXTJS_RESERVED_BASENAMES.has(nameBeforeExt)) return null;

  const ext = path.posix.extname(base).slice(1).toLowerCase();
  if (ext === 'css' || ext === 'scss') return 'KEBAB_CASE';

  return convention;
}
```

- [ ] **Step 4: Wire it into `computeRenamePlan`**

In `src/utils/rename-plan.ts`, replace the `targets` computation inside `computeRenamePlan`:

```typescript
  const targets = relativePaths.map((relPath) => {
    const posixPath = toPosix(relPath);
    const dir = path.posix.dirname(posixPath);
    const base = path.posix.basename(posixPath);
    const newBase = convertBasename(base, convention);
    const target = dir === '.' ? newBase : `${dir}/${newBase}`;
    return { source: posixPath, target, changed: newBase !== base };
  });
```

with:

```typescript
  const targets = relativePaths.map((relPath) => {
    const posixPath = toPosix(relPath);
    const dir = path.posix.dirname(posixPath);
    const base = path.posix.basename(posixPath);
    const resolvedConvention = resolveConventionForPath(posixPath, convention);
    const newBase =
      resolvedConvention === null ? base : convertBasename(base, resolvedConvention);
    const target = dir === '.' ? newBase : `${dir}/${newBase}`;
    return { source: posixPath, target, changed: newBase !== base };
  });
```

(Reserved files get `resolvedConvention === null`, so `newBase === base`, `changed` is `false`, and they fall into `unchanged` via the existing logic later in the function — no other change needed.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- rename-plan`
Expected: PASS — all tests in `tests/utils/rename-plan.test.ts`, including the 4 new ones, pass.

- [ ] **Step 6: Run typecheck and full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: PASS with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/rename-plan.ts tests/utils/rename-plan.test.ts
git commit -m "feat: skip Next.js reserved filenames and force css/scss to kebab-case in fix-filenames"
```

---

## Self-Review Notes

- **Spec coverage:** Next.js reserved-name exclusion ✓ (Task 1, reserved set + null resolution). CSS/SCSS forced kebab-case ✓ (Task 1, extension check). No new CLI flags ✓ (no flag touched). Directory renaming out of scope ✓ (nothing here touches `walkSourceFiles` or directories). `RenamePlan` shape unchanged ✓ (only internal `targets` computation changed).
- **Placeholder scan:** none — all steps contain full code.
- **Type consistency:** `resolveConventionForPath` signature matches its one call site in `computeRenamePlan`; both live in the same file so no cross-task interface risk.
