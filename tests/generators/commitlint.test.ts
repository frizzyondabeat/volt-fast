import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fs-extra BEFORE importing the module under test so the mock is in place
vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn(),
  },
}));

// consola is imported by the generator — silence its output in tests
vi.mock('consola', () => ({
  default: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import fs from 'fs-extra';
import { generateCommitlintConfig } from '../../src/generators/commitlint.js';
import type { GeneratorOptions } from '../../src/generators/types.js';

const baseOptions: GeneratorOptions = {
  enabledTools: ['commitlint'],
  detectedTools: [],
  packageManager: 'npm',
  projectDir: '/fake/project',
  settings: {},
};

describe('generateCommitlintConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates commitlint.config.mjs when no existing config is found', async () => {
    vi.mocked(fs.pathExists).mockResolvedValue(false as never);

    const files = await generateCommitlintConfig(baseOptions);

    expect(files).toHaveLength(1);
    const [filename, content] = files[0];
    expect(filename).toBe('commitlint.config.mjs');
    expect(content).toContain('@commitlint/config-conventional');
    expect(content).toContain('export default');
  });

  it('returns empty array and skips generation when existing config is found', async () => {
    // First candidate in the list matches
    vi.mocked(fs.pathExists).mockImplementation(async (p) => {
      return String(p).includes('commitlint.config.js');
    });

    const files = await generateCommitlintConfig(baseOptions);
    expect(files).toEqual([]);
  });

  it('checks all known config filenames before deciding no config exists', async () => {
    vi.mocked(fs.pathExists).mockResolvedValue(false as never);
    await generateCommitlintConfig(baseOptions);

    const checkedPaths = vi
      .mocked(fs.pathExists)
      .mock.calls.map(([p]) => String(p));

    // Should have checked all standard config filename candidates
    const expectedCandidates = [
      'commitlint.config.js',
      'commitlint.config.mjs',
      'commitlint.config.cjs',
      'commitlint.config.ts',
      '.commitlintrc.js',
      '.commitlintrc.mjs',
      '.commitlintrc.cjs',
      '.commitlintrc',
      '.commitlintrc.json',
      '.commitlintrc.yaml',
      '.commitlintrc.yml',
    ];

    for (const candidate of expectedCandidates) {
      expect(checkedPaths.some((p) => p.endsWith(candidate))).toBe(true);
    }
  });

  it('generated config uses ESM export default syntax', async () => {
    vi.mocked(fs.pathExists).mockResolvedValue(false as never);

    const [[, content]] = await generateCommitlintConfig(baseOptions);
    // Must be ESM flat config, not CJS module.exports
    expect(content).toContain('export default');
    expect(content).not.toContain('module.exports');
  });
});
