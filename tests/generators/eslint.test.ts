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

  it('opts non-.ts root-level config files into the projectService default-project fallback when TS type-aware linting is enabled (regression: projectService:true alone throws a parsing error on any file outside every tsconfig — not just eslint.config.mjs itself, but siblings like postcss.config.mjs too, reproduced against a real create-next-app project)', async () => {
    const files = await generateEslintConfig(
      makeOptions({ detectedTools: ['typescript'] })
    );
    const [, content] = files.find(([f]) => f === 'eslint.config.mjs')!;
    expect(content).toContain(
      'allowDefaultProject: ["*.config.js", "*.config.mjs", "*.config.cjs"]'
    );
    expect(content).toContain('tsconfigRootDir: import.meta.dirname');
  });

  it('excludes .ts/.mts from the default-project glob (regression: a .ts config like next.config.ts is typically already covered by the tsconfig\'s own **/*.ts include, and typescript-eslint errors if a file matches both the real project and the fallback glob, reproduced against a real create-next-app project)', async () => {
    const files = await generateEslintConfig(
      makeOptions({ detectedTools: ['typescript'] })
    );
    const [, content] = files.find(([f]) => f === 'eslint.config.mjs')!;
    expect(content).not.toContain('*.config.ts');
    expect(content).not.toContain('*.config.mts');
  });

  it('does NOT add projectService options when TS is not detected (no type-aware linting, so no parsing issue to work around)', async () => {
    const files = await generateEslintConfig(makeOptions({ detectedTools: [] }));
    const [, content] = files.find(([f]) => f === 'eslint.config.mjs')!;
    expect(content).not.toContain('projectService');
  });

  it('ignores Next.js build output when nextjs is detected (regression: without it, ESLint lints .next/types/**\'s generated files too — reproduced against a real create-next-app project, which flagged unrelated no-explicit-any errors in .next/types/validator.ts)', async () => {
    const files = await generateEslintConfig(
      makeOptions({ detectedTools: ['nextjs'] })
    );
    const [, content] = files.find(([f]) => f === 'eslint.config.mjs')!;
    expect(content).toContain('.next/**');
    expect(content).toContain('out/**');
    expect(content).toContain('next-env.d.ts');
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

  it('injects into a config array wrapped in a helper call and exported via a variable (regression: create-next-app generates exactly this shape — const eslintConfig = defineConfig([...]); export default eslintConfig; — and the old regex, which only matched an array literal ending the file, failed to find the array at all)', async () => {
    const dir = makeTmpDir();
    await writeExisting(
      dir,
      'eslint.config.mjs',
      `import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

const eslintConfig = defineConfig([
  ...nextVitals,
  globalIgnores(['.next/**']),
]);

export default eslintConfig;
`
    );

    const files = await generateEslintConfig(makeOptions({ projectDir: dir }));
    const [, content] = files.find(([f]) => f === 'eslint.config.mjs')!;
    expect(content).toContain('import checkFile from "eslint-plugin-check-file"');
    expect(content).toContain('check-file/filename-naming-convention');
    // The pre-existing entries must survive the injection untouched.
    expect(content).toContain('nextVitals');
    expect(content).toContain("globalIgnores([\".next/**\"])");
    expect(content).toContain('export default eslintConfig');
  });

  it('injects into a CJS config array wrapped in a helper call (module.exports = defineConfig([...]))', async () => {
    const dir = makeTmpDir();
    await writeExisting(
      dir,
      'eslint.config.cjs',
      `const { defineConfig } = require('eslint/config');
const js = require('@eslint/js');

module.exports = defineConfig([js.configs.recommended]);
`
    );

    const files = await generateEslintConfig(makeOptions({ projectDir: dir }));
    const [, content] = files.find(([f]) => f === 'eslint.config.cjs')!;
    expect(content).toContain('require("eslint-plugin-check-file")');
    expect(content).toContain('check-file/filename-naming-convention');
    expect(content).toContain('js.configs.recommended');
  });

  it('warns and returns no files when the config array cannot be found at all', async () => {
    const dir = makeTmpDir();
    await writeExisting(
      dir,
      'eslint.config.mjs',
      `// no default export, no module.exports — nothing to find\nconst x = 1;\n`
    );

    const files = await generateEslintConfig(makeOptions({ projectDir: dir }));
    expect(files).toEqual([]);
  });
});
