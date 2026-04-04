import { describe, expect, it } from 'vitest';
import { generateHuskyConfig } from '../../src/generators/husky.js';
import type { GeneratorOptions, HuskySettings } from '../../src/generators/types.js';

function makeOptions(
  overrides: Partial<GeneratorOptions> & { husky?: Partial<HuskySettings> }
): GeneratorOptions {
  const huskySettings: HuskySettings = {
    enablePreCommit: false,
    enablePrePush: false,
    runFormatOnCommit: false,
    runTestsOnCommit: false,
    runBuildOnPush: false,
    testRunner: null,
    ...overrides.husky,
  };
  return {
    enabledTools: overrides.enabledTools ?? [],
    detectedTools: overrides.detectedTools ?? [],
    packageManager: overrides.packageManager ?? 'npm',
    projectDir: overrides.projectDir ?? '/fake/project',
    settings: { husky: huskySettings, ...overrides.settings },
  };
}

describe('generateHuskyConfig', () => {
  // ── pre-commit hook ───────────────────────────────────────────────────────
  describe('pre-commit', () => {
    it('produces a pre-commit hook with the correct PM command', async () => {
      const files = await generateHuskyConfig(
        makeOptions({ packageManager: 'pnpm', husky: { enablePreCommit: true } })
      );
      const preCommit = files.find(([f]) => f === '.husky/pre-commit');
      expect(preCommit).toBeTruthy();
      expect(preCommit![1]).toContain('pnpm lint');
    });

    it('uses npm for npm projects', async () => {
      const files = await generateHuskyConfig(
        makeOptions({ packageManager: 'npm', husky: { enablePreCommit: true } })
      );
      const content = files.find(([f]) => f === '.husky/pre-commit')![1];
      expect(content).toContain('npm lint');
    });

    it('uses yarn for yarn projects', async () => {
      const files = await generateHuskyConfig(
        makeOptions({ packageManager: 'yarn', husky: { enablePreCommit: true } })
      );
      const content = files.find(([f]) => f === '.husky/pre-commit')![1];
      expect(content).toContain('yarn lint');
    });

    it('uses bun for bun projects', async () => {
      const files = await generateHuskyConfig(
        makeOptions({ packageManager: 'bun', husky: { enablePreCommit: true } })
      );
      const content = files.find(([f]) => f === '.husky/pre-commit')![1];
      expect(content).toContain('bun lint');
    });

    it('includes format:fix command when runFormatOnCommit is true', async () => {
      const files = await generateHuskyConfig(
        makeOptions({
          packageManager: 'pnpm',
          husky: { enablePreCommit: true, runFormatOnCommit: true },
        })
      );
      const content = files.find(([f]) => f === '.husky/pre-commit')![1];
      expect(content).toContain('pnpm format:fix');
    });

    it('includes test command when runTestsOnCommit is true', async () => {
      const files = await generateHuskyConfig(
        makeOptions({
          packageManager: 'npm',
          husky: { enablePreCommit: true, runTestsOnCommit: true },
        })
      );
      const content = files.find(([f]) => f === '.husky/pre-commit')![1];
      expect(content).toContain('npm test');
    });

    it('omits pre-commit hook when enablePreCommit is false', async () => {
      const files = await generateHuskyConfig(
        makeOptions({ husky: { enablePreCommit: false } })
      );
      expect(files.find(([f]) => f === '.husky/pre-commit')).toBeUndefined();
    });
  });

  // ── pre-push hook ─────────────────────────────────────────────────────────
  describe('pre-push', () => {
    it('produces a pre-push hook when enabled and runBuildOnPush is true', async () => {
      const files = await generateHuskyConfig(
        makeOptions({
          packageManager: 'pnpm',
          husky: { enablePrePush: true, runBuildOnPush: true },
        })
      );
      const prePush = files.find(([f]) => f === '.husky/pre-push');
      expect(prePush).toBeTruthy();
      expect(prePush![1]).toContain('pnpm build');
    });

    it('omits pre-push when runBuildOnPush is false', async () => {
      const files = await generateHuskyConfig(
        makeOptions({ husky: { enablePrePush: true, runBuildOnPush: false } })
      );
      expect(files.find(([f]) => f === '.husky/pre-push')).toBeUndefined();
    });
  });

  // ── commit-msg hook (commitlint) ──────────────────────────────────────────
  describe('commit-msg', () => {
    it('adds commit-msg hook when commitlint is in enabledTools', async () => {
      const files = await generateHuskyConfig(
        makeOptions({ enabledTools: ['commitlint'], packageManager: 'pnpm' })
      );
      const commitMsg = files.find(([f]) => f === '.husky/commit-msg');
      expect(commitMsg).toBeTruthy();
      expect(commitMsg![1]).toContain('pnpx commitlint --edit $1');
    });

    it('uses npx for npm projects', async () => {
      const files = await generateHuskyConfig(
        makeOptions({ enabledTools: ['commitlint'], packageManager: 'npm' })
      );
      const content = files.find(([f]) => f === '.husky/commit-msg')![1];
      expect(content).toContain('npx commitlint --edit $1');
    });

    it('uses yarn for yarn projects', async () => {
      const files = await generateHuskyConfig(
        makeOptions({ enabledTools: ['commitlint'], packageManager: 'yarn' })
      );
      const content = files.find(([f]) => f === '.husky/commit-msg')![1];
      expect(content).toContain('yarn commitlint --edit $1');
    });

    it('uses bunx for bun projects', async () => {
      const files = await generateHuskyConfig(
        makeOptions({ enabledTools: ['commitlint'], packageManager: 'bun' })
      );
      const content = files.find(([f]) => f === '.husky/commit-msg')![1];
      expect(content).toContain('bunx commitlint --edit $1');
    });

    it('does NOT add commit-msg when commitlint is NOT in enabledTools (C-3 regression)', async () => {
      const files = await generateHuskyConfig(
        makeOptions({ enabledTools: ['husky'], packageManager: 'pnpm' })
      );
      expect(files.find(([f]) => f === '.husky/commit-msg')).toBeUndefined();
    });

    it('returns empty array when no hooks are configured', async () => {
      const files = await generateHuskyConfig(makeOptions({}));
      expect(files).toEqual([]);
    });
  });
});
