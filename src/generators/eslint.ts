import consola from 'consola';
import fs from 'fs-extra';
import path from 'path';
import { findExistingConfig } from '../utils/find-config.js';
import { formatCode } from '../utils/format.js';
import type { FilenameConvention, GeneratorOptions } from './types.js';

/** Whether a given existing flat-config filename is CommonJS (so injected
 * code must use `require()`, not `import`) — `.cjs` always is, `.mjs`/`.ts`/
 * `.mts` never are, and plain `.js` depends on the nearest package.json's
 * `"type"` field (CommonJS unless it says `"module"`). Pure — takes the
 * already-read package.json `type` value rather than doing its own I/O. */
export function isCommonJsConfigFile(
  filename: string,
  packageJsonType: string | undefined
): boolean {
  if (filename.endsWith('.cjs')) return true;
  if (filename.endsWith('.mjs') || filename.endsWith('.mts')) return false;
  if (filename.endsWith('.ts')) return false;
  return packageJsonType !== 'module';
}

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

    let packageJsonType: string | undefined;
    try {
      const pkg = await fs.readJSON(path.join(projectDir, 'package.json'));
      packageJsonType = pkg.type;
    } catch {
      packageJsonType = undefined;
    }
    const isCjs = isCommonJsConfigFile(existingFlat, packageJsonType);

    // `.cjs` (and `.js` without "type": "module") can't use `import` syntax —
    // Node throws a hard SyntaxError loading it. Match whatever module
    // system the existing config actually uses.
    const importStatement = (name: string, pkg: string): string =>
      isCjs ? `const ${name} = require('${pkg}');` : `import ${name} from '${pkg}';`;

    const newImports: string[] = [
      importStatement('checkFile', 'eslint-plugin-check-file'),
    ];
    const newEntries: string[] = [
      `{ plugins: { 'check-file': checkFile }, rules: { 'check-file/filename-naming-convention': ['error', { '**/*': '${convention}' }, { ignoreMiddleExtensions: true }] } }`,
    ];
    if (hasPrettier && !existing.includes('eslint-config-prettier')) {
      newImports.unshift(importStatement('prettierConfig', 'eslint-config-prettier'));
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

  const configEntries: string[] = [];

  if (hasTs) {
    // `projectService: true` (below) requires every linted file to belong
    // to a tsconfig project — eslint.config.mjs itself never does (it's
    // outside any tsconfig's `include`/`references`), which otherwise
    // throws a parsing error on itself the moment ESLint lints the repo.
    configEntries.push(`{ ignores: ['eslint.config.mjs'] }`);
  }

  configEntries.push(
    'js.configs.recommended',
    'reactPlugin.configs.flat.recommended',
    // Every current scaffold (Vite, Next.js, CRA) uses the automatic JSX
    // runtime — must come after `recommended` to override its
    // `react-in-jsx-scope`/`jsx-uses-react` rules, which assume the old
    // classic transform and otherwise flag every JSX-using file.
    "reactPlugin.configs.flat['jsx-runtime']",
    "reactHooksPlugin.configs.flat['recommended-latest']"
  );

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
