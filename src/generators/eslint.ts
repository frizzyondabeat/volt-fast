import consola from 'consola';
import fs from 'fs-extra';
import path from 'path';
import { findExistingConfig } from '../utils/find-config.js';
import { formatCode } from '../utils/format.js';
import type { FilenameConvention, GeneratorOptions } from './types.js';

export async function generateEslintConfig(
  options: GeneratorOptions
): Promise<[string, string][]> {
  const { enabledTools, detectedTools, settings, projectDir } = options;
  const hasTs = detectedTools.includes('typescript');
  const hasNext = detectedTools.includes('nextjs');
  const hasPrettier = enabledTools.includes('prettier');
  const convention: FilenameConvention =
    settings.filenameConvention ?? 'KEBAB_CASE';

  // Check for an existing ESLint flat config to extend rather than overwrite
  const existingFlat = await findExistingConfig(projectDir, [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
    'eslint.config.mts',
  ]);

  if (existingFlat) {
    const fullPath = path.join(projectDir, existingFlat);
    let existing = await fs.readFile(fullPath, 'utf-8');

    const newImports: string[] = [
      "import checkFile from 'eslint-plugin-check-file';",
    ];
    const newEntries: string[] = [
      `{ plugins: { 'check-file': checkFile }, rules: { 'check-file/filename-naming-convention': ['error', { '**/*': '${convention}' }, { ignoreMiddleExtensions: true }] } }`,
    ];
    if (hasPrettier && !existing.includes('eslint-config-prettier')) {
      newImports.unshift("import prettierConfig from 'eslint-config-prettier';");
      newEntries.push('prettierConfig');
    }

    const missingImports = newImports.filter((imp) => !existing.includes(imp));
    if (missingImports.length > 0) {
      existing = `${missingImports.join('\n')}\n${existing}`;
    }

    // Inject new entries before the FINAL `]` closing the export default array.
    // Greedy `[\s\S]*` consumes as much as possible, leaving only the last `]`
    // for the tail — correctly skips any `]` inside string keys like
    // configs['recommended-latest'].
    const closeArrayMatch = existing.match(/^([\s\S]*)\](\)*\s*;?\s*)$/);
    if (closeArrayMatch) {
      const before = closeArrayMatch[1].trimEnd();
      const beforeNormalized = before.endsWith(',') ? before : `${before},`;
      existing = `${beforeNormalized}\n  ${newEntries.join(',\n  ')},\n]${closeArrayMatch[2]}`;
    } else {
      consola.warn(
        `Could not inject into ${existingFlat} — add these entries manually:\n${newEntries.join('\n')}`
      );
      return [];
    }

    const formatted = await formatCode(existing, 'babel');
    return [[existingFlat, formatted]];
  }

  // Check for a legacy .eslintrc.* — warn and skip
  const existingLegacy = await findExistingConfig(projectDir, [
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.mjs',
    '.eslintrc.json',
    '.eslintrc.yaml',
    '.eslintrc.yml',
    '.eslintrc',
  ]);
  if (existingLegacy) {
    consola.warn(
      `Found legacy ESLint config (${existingLegacy}). Migrate to eslint.config.mjs (flat config) to use volt-fast's ESLint setup.`
    );
    return [];
  }

  // No existing config — generate fresh
  const importLines: string[] = [
    "import js from '@eslint/js';",
    "import reactPlugin from 'eslint-plugin-react';",
    "import reactHooksPlugin from 'eslint-plugin-react-hooks';",
    "import checkFile from 'eslint-plugin-check-file';",
  ];

  if (hasTs) importLines.push("import tseslint from 'typescript-eslint';");
  if (hasNext)
    importLines.push("import nextPlugin from '@next/eslint-plugin-next';");
  if (hasPrettier)
    importLines.push("import prettierConfig from 'eslint-config-prettier';");

  const configEntries: string[] = [
    'js.configs.recommended',
    '...reactPlugin.configs.flat.recommended',
    "reactHooksPlugin.configs['recommended-latest']",
  ];

  if (hasTs) configEntries.push('...tseslint.configs.recommended');
  if (hasNext) {
    configEntries.push(
      `{ plugins: { '@next/next': nextPlugin }, rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs['core-web-vitals'].rules } }`
    );
  }
  if (hasPrettier) configEntries.push('prettierConfig');

  const settingsEntry = hasTs
    ? `{ settings: { react: { version: 'detect' } }, languageOptions: { parserOptions: { projectService: true } } }`
    : `{ settings: { react: { version: 'detect' } } }`;
  configEntries.push(settingsEntry);

  configEntries.push(
    `{ plugins: { 'check-file': checkFile }, rules: { 'check-file/filename-naming-convention': ['error', { '**/*': '${convention}' }, { ignoreMiddleExtensions: true }] } }`
  );

  const configContent = await formatCode(
    `${importLines.join('\n')}

/** @type {import('eslint').Linter.Config[]} */
export default [
  ${configEntries.join(',\n  ')},
];
`
  );

  return [['eslint.config.mjs', configContent]];
}
