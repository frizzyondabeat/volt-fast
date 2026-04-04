import consola from 'consola';
import { findExistingConfig } from '../utils/find-config.js';
import { formatCode } from '../utils/format.js';
import type { GeneratorOptions } from './types.js';

export async function generatePrettierConfig(
  options: GeneratorOptions
): Promise<[string, string][]> {
  const { enabledTools, detectedTools, projectDir } = options;

  const existing = await findExistingConfig(projectDir, [
    'prettier.config.js',
    'prettier.config.mjs',
    'prettier.config.cjs',
    'prettier.config.ts',
    '.prettierrc.js',
    '.prettierrc.mjs',
    '.prettierrc.cjs',
    '.prettierrc',
    '.prettierrc.json',
    '.prettierrc.yaml',
    '.prettierrc.yml',
  ]);

  if (existing) {
    consola.info(
      `Prettier config already exists (${existing}), skipping generation.`
    );
    return [];
  }

  const plugins: string[] = ['@trivago/prettier-plugin-sort-imports'];
  if (enabledTools.includes('tailwind') || detectedTools.includes('tailwind')) {
    plugins.push('prettier-plugin-tailwindcss');
  }

  const configContent: string = await formatCode(`
    /** @type {import("prettier").Config} */
    const config = {
      useTabs: false,
      singleQuote: true,
      trailingComma: "es5",
      bracketSpacing: true,
      jsxBracketSameLine: false,
      printWidth: 80,
      tabWidth: 2,
      plugins: [
        ${plugins.map((p) => `"${p}"`).join(', ')}
      ],
    };

    export default config;
  `);

  return [['prettier.config.mjs', configContent]];
}
