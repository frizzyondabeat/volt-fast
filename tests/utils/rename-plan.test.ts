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
});
