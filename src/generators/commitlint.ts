import consola from 'consola';
import { findExistingConfig } from '../utils/find-config.js';
import { formatCode } from '../utils/format.js';
import type { GeneratorOptions } from './types.js';

export async function generateCommitlintConfig(
  options: GeneratorOptions
): Promise<[string, string][]> {
  const existing = await findExistingConfig(options.projectDir, [
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
  ]);

  if (existing) {
    consola.info(
      `Commitlint config already exists (${existing}), skipping generation.`
    );
    return [];
  }

  const configContent = await formatCode(
    `/** @type {import('@commitlint/types').UserConfig} */
    const config = { extends: ['@commitlint/config-conventional'] };
    export default config;`
  );

  return [['commitlint.config.mjs', configContent]];
}
