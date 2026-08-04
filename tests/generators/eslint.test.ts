import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateEslintConfig, isCommonJsConfigFile } from '../../src/generators/eslint.js';
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

describe('isCommonJsConfigFile', () => {
  it('.cjs is always CommonJS regardless of package.json type', () => {
    expect(isCommonJsConfigFile('eslint.config.cjs', 'module')).toBe(true);
    expect(isCommonJsConfigFile('eslint.config.cjs', undefined)).toBe(true);
  });

  it('.mjs and .mts are always ESM regardless of package.json type', () => {
    expect(isCommonJsConfigFile('eslint.config.mjs', undefined)).toBe(false);
    expect(isCommonJsConfigFile('eslint.config.mts', undefined)).toBe(false);
  });

  it('.ts is treated as ESM (flat config .ts files are conventionally ESM)', () => {
    expect(isCommonJsConfigFile('eslint.config.ts', undefined)).toBe(false);
  });

  it('plain .js depends on package.json "type"', () => {
    expect(isCommonJsConfigFile('eslint.config.js', undefined)).toBe(true);
    expect(isCommonJsConfigFile('eslint.config.js', 'commonjs')).toBe(true);
    expect(isCommonJsConfigFile('eslint.config.js', 'module')).toBe(false);
  });
});

describe('generateEslintConfig — extending an existing config', () => {
  async function writeExisting(
    projectDir: string,
    filename: string,
    content: string,
    packageJsonType?: string
  ): Promise<void> {
    await fs.outputFile(path.join(projectDir, filename), content, 'utf-8');
    await fs.outputJSON(path.join(projectDir, 'package.json'), {
      name: 'test',
      ...(packageJsonType ? { type: packageJsonType } : {}),
    });
  }

  it('injects require() into an existing .cjs config, not import (regression: import syntax is a hard SyntaxError in a .cjs file)', async () => {
    const dir = makeTmpDir();
    await writeExisting(
      dir,
      'eslint.config.cjs',
      `const js = require('@eslint/js');\n\nmodule.exports = [\n  js.configs.recommended,\n];\n`
    );

    const files = await generateEslintConfig(makeOptions({ projectDir: dir }));
    const [, content] = files.find(([f]) => f === 'eslint.config.cjs')!;
    expect(content).toContain("require(\"eslint-plugin-check-file\")");
    expect(content).not.toContain('import ');
  });

  it('injects require() into an existing plain .js config without "type": "module"', async () => {
    const dir = makeTmpDir();
    await writeExisting(
      dir,
      'eslint.config.js',
      `const js = require('@eslint/js');\n\nmodule.exports = [\n  js.configs.recommended,\n];\n`
    );

    const files = await generateEslintConfig(makeOptions({ projectDir: dir }));
    const [, content] = files.find(([f]) => f === 'eslint.config.js')!;
    expect(content).toContain("require(\"eslint-plugin-check-file\")");
    expect(content).not.toContain('import ');
  });

  it('injects import syntax into an existing .js config with "type": "module"', async () => {
    const dir = makeTmpDir();
    await writeExisting(
      dir,
      'eslint.config.js',
      `import js from '@eslint/js';\n\nexport default [\n  js.configs.recommended,\n];\n`,
      'module'
    );

    const files = await generateEslintConfig(makeOptions({ projectDir: dir }));
    const [, content] = files.find(([f]) => f === 'eslint.config.js')!;
    expect(content).toContain('import checkFile from "eslint-plugin-check-file"');
    expect(content).not.toContain('require(');
  });

  it('injects import syntax into an existing .mjs config regardless of package.json', async () => {
    const dir = makeTmpDir();
    await writeExisting(
      dir,
      'eslint.config.mjs',
      `import js from '@eslint/js';\n\nexport default [\n  js.configs.recommended,\n];\n`
    );

    const files = await generateEslintConfig(makeOptions({ projectDir: dir }));
    const [, content] = files.find(([f]) => f === 'eslint.config.mjs')!;
    expect(content).toContain('import checkFile from "eslint-plugin-check-file"');
    expect(content).not.toContain('require(');
  });
});
