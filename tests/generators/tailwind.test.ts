import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock('consola', () => ({
  default: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/utils/find-config.js', () => ({
  getDefaultTailwindCssPath: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/utils/format.js', () => ({
  formatCode: vi.fn().mockImplementation((content: string) => Promise.resolve(content)),
}));

import fs from 'fs-extra';
import { generateTailwindConfig } from '../../src/generators/tailwind.js';
import type { GeneratorOptions } from '../../src/generators/types.js';

const baseOptions: GeneratorOptions = {
  enabledTools: ['tailwind'],
  detectedTools: ['vite'],
  packageManager: 'npm',
  projectDir: '/fake/project',
  settings: {},
};

describe('generateTailwindConfig — vite.config patching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns vite.config as a file pair instead of writing to disk', async () => {
    vi.mocked(fs.pathExists).mockImplementation(async (p) =>
      String(p).endsWith('vite.config.ts')
    );
    vi.mocked(fs.readFile).mockResolvedValue(
      `import { defineConfig } from 'vite';\nexport default defineConfig({\n  plugins: [],\n});\n` as never
    );

    const files = await generateTailwindConfig(baseOptions);

    expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    const viteEntry = files.find(([p]) => p.includes('vite.config'));
    expect(viteEntry).toBeTruthy();
    expect(viteEntry![1]).toContain("import tailwindcss from '@tailwindcss/vite'");
    expect(viteEntry![1]).toContain('plugins: [tailwindcss(), ');
  });

  it('skips patching when @tailwindcss/vite is already present', async () => {
    vi.mocked(fs.pathExists).mockImplementation(async (p) =>
      String(p).endsWith('vite.config.ts')
    );
    vi.mocked(fs.readFile).mockResolvedValue(
      `import tailwindcss from '@tailwindcss/vite';\nimport { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [tailwindcss()] });\n` as never
    );

    const files = await generateTailwindConfig(baseOptions);

    expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    expect(files.find(([p]) => p.includes('vite.config'))).toBeUndefined();
  });

  it('falls through to vite.config.js when .ts does not exist', async () => {
    vi.mocked(fs.pathExists).mockImplementation(async (p) =>
      String(p).endsWith('vite.config.js')
    );
    vi.mocked(fs.readFile).mockResolvedValue(
      `import { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [] });\n` as never
    );

    const files = await generateTailwindConfig(baseOptions);

    expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    const viteEntry = files.find(([p]) => p === 'vite.config.js');
    expect(viteEntry).toBeTruthy();
  });

  it('returns empty array when no vite.config is found', async () => {
    vi.mocked(fs.pathExists).mockResolvedValue(false as never);

    const files = await generateTailwindConfig(baseOptions);

    expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    expect(files).toEqual([]);
  });
});
