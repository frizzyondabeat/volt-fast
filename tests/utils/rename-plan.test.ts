import { describe, expect, it } from 'vitest';
import { computeRenamePlan } from '../../src/utils/rename-plan.js';

describe('computeRenamePlan', () => {
  it('returns empty plan for empty input', () => {
    const plan = computeRenamePlan([], 'KEBAB_CASE');
    expect(plan).toEqual({ renames: [], unchanged: [], conflicts: [] });
  });

  it('treats already-conformant files as unchanged', () => {
    const plan = computeRenamePlan(['src/my-component.tsx'], 'KEBAB_CASE');
    expect(plan.unchanged).toContain('src/my-component.tsx');
    expect(plan.renames).toEqual([]);
  });

  it('plans a simple rename', () => {
    const plan = computeRenamePlan(['src/MyComponent.tsx'], 'KEBAB_CASE');
    expect(plan.renames).toEqual([
      { from: 'src/MyComponent.tsx', to: 'src/my-component.tsx' },
    ]);
    expect(plan.conflicts).toEqual([]);
  });

  it('flags a rename-vs-rename conflict and excludes both from renames', () => {
    const plan = computeRenamePlan(
      ['src/MyComponent.tsx', 'src/my_component.tsx'],
      'KEBAB_CASE'
    );
    expect(plan.renames).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].sources.sort()).toEqual(
      ['src/MyComponent.tsx', 'src/my_component.tsx'].sort()
    );
  });

  it('flags a rename-vs-unchanged-file conflict', () => {
    const plan = computeRenamePlan(
      ['src/MyComponent.tsx', 'src/my-component.tsx'],
      'KEBAB_CASE'
    );
    expect(plan.renames).toEqual([]);
    expect(plan.unchanged).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
  });

  it('treats case-only collisions on the target name as conflicts', () => {
    const plan = computeRenamePlan(
      ['src/Foo.tsx', 'src/foo.tsx'],
      'PASCAL_CASE'
    );
    // Foo.tsx -> Foo.tsx (unchanged), foo.tsx -> Foo.tsx (renamed) — same
    // target, case-insensitively, so both must be treated as conflicting.
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.renames).toEqual([]);
  });

  it('does not flag an unrelated pair as a conflict', () => {
    const plan = computeRenamePlan(
      ['src/MyComponent.tsx', 'src/OtherThing.tsx'],
      'KEBAB_CASE'
    );
    expect(plan.conflicts).toEqual([]);
    expect(plan.renames).toHaveLength(2);
  });

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
});
