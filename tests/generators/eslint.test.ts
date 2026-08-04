import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateEslintConfig } from '../../src/generators/eslint.js';
import type { GeneratorOptions } from '../../src/generators/types.js';

let tmpDir: string | undefined;

function makeTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volt-fast-eslint-gen-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) fs.removeSync(tmpDir);
  tmpDir = undefined;
});

function makeOptions(overrides: Partial<GeneratorOptions> = {}): GeneratorOptions {
  return {
    enabledTools: overrides.enabledTools ?? ['eslint'],
    detectedTools: overrides.detectedTools ?? [],
    packageManager: overrides.packageManager ?? 'npm',
    projectDir: overrides.projectDir ?? makeTmpDir(),
    settings: overrides.settings ?? {},
  };
}

describe('generateEslintConfig — fresh config generation', () => {
  it('does not spread reactPlugin.configs.flat.recommended (regression: it is a single flat-config object, not an array — spreading it throws "is not iterable" at eslint runtime)', async () => {
    const files = await generateEslintConfig(makeOptions());
    const [, content] = files.find(([f]) => f === 'eslint.config.mjs')!;
    expect(content).not.toContain('...reactPlugin.configs.flat.recommended');
    expect(content).toContain('reactPlugin.configs.flat.recommended');
  });

  it('uses the flat variant of eslint-plugin-react-hooks, not spread (regression: configs["recommended-latest"] has legacy eslintrc-style array plugins that crash flat config; configs.flat["recommended-latest"] is the correct object)', async () => {
    const files = await generateEslintConfig(makeOptions());
    const [, content] = files.find(([f]) => f === 'eslint.config.mjs')!;
    expect(content).not.toContain('...reactHooksPlugin.configs.flat["recommended-latest"]');
    expect(content).toContain('reactHooksPlugin.configs.flat["recommended-latest"]');
    expect(content).not.toContain('reactHooksPlugin.configs["recommended-latest"]');
  });

  it('includes the jsx-runtime override after recommended (regression: without it, every JSX file gets a false-positive react/react-in-jsx-scope error under the automatic JSX runtime used by Vite/Next/CRA)', async () => {
    const files = await generateEslintConfig(makeOptions());
    const [, content] = files.find(([f]) => f === 'eslint.config.mjs')!;
    const recommendedIndex = content.indexOf('reactPlugin.configs.flat.recommended');
    const jsxRuntimeIndex = content.indexOf('reactPlugin.configs.flat["jsx-runtime"]');
    expect(jsxRuntimeIndex).toBeGreaterThan(-1);
    expect(jsxRuntimeIndex).toBeGreaterThan(recommendedIndex);
  });

  it('spreads tseslint.configs.recommended (it genuinely is an array)', async () => {
    const files = await generateEslintConfig(
      makeOptions({ detectedTools: ['typescript'] })
    );
    const [, content] = files.find(([f]) => f === 'eslint.config.mjs')!;
    expect(content).toContain('...tseslint.configs.recommended');
  });

  it('ignores its own config file when TS type-aware linting is enabled (regression: projectService:true otherwise throws a parsing error on eslint.config.mjs itself, since it is outside every tsconfig)', async () => {
    const files = await generateEslintConfig(
      makeOptions({ detectedTools: ['typescript'] })
    );
    const [, content] = files.find(([f]) => f === 'eslint.config.mjs')!;
    expect(content).toContain('{ ignores: ["eslint.config.mjs"] }');
  });

  it('does NOT add the ignores entry when TS is not detected (no projectService, so no parsing issue to work around)', async () => {
    const files = await generateEslintConfig(makeOptions({ detectedTools: [] }));
    const [, content] = files.find(([f]) => f === 'eslint.config.mjs')!;
    expect(content).not.toContain('ignores');
  });

  it('embeds the chosen filename convention', async () => {
    const files = await generateEslintConfig(
      makeOptions({ settings: { filenameConvention: 'PASCAL_CASE' } })
    );
    const [, content] = files.find(([f]) => f === 'eslint.config.mjs')!;
    expect(content).toContain('PASCAL_CASE');
  });
});
