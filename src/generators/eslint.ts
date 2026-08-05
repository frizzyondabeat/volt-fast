import consola from 'consola';
import fs from 'fs-extra';
import path from 'path';
import { Node, Project } from 'ts-morph';
import type { ArrayLiteralExpression, Expression, SourceFile } from 'ts-morph';
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

/** Resolves an expression down to the array literal it ultimately points at,
 * unwrapping a single level of helper-function wrapping (`defineConfig([...])`,
 * `tseslint.config([...])`, etc. — the first array-typed argument) and
 * variable references (`const eslintConfig = ...; export default eslintConfig;`).
 * Returns null if it can't be resolved to an array literal at all. */
function resolveToArrayLiteral(
  expr: Expression | undefined,
  sourceFile: SourceFile
): ArrayLiteralExpression | null {
  if (!expr) return null;
  if (Node.isArrayLiteralExpression(expr)) return expr;

  if (Node.isCallExpression(expr)) {
    const arrayArg = expr.getArguments().find((arg) => Node.isArrayLiteralExpression(arg));
    return arrayArg && Node.isArrayLiteralExpression(arrayArg) ? arrayArg : null;
  }

  if (Node.isIdentifier(expr)) {
    for (const decl of sourceFile.getVariableDeclarations()) {
      if (decl.getName() === expr.getText()) {
        const resolved = resolveToArrayLiteral(decl.getInitializer(), sourceFile);
        if (resolved) return resolved;
      }
    }
  }

  return null;
}

/** Finds the config array in an ESLint flat config file, however it's
 * structured — a direct `export default [...]`/`module.exports = [...]`,
 * one wrapped in a helper call like `defineConfig([...])`, or assigned to a
 * variable first and exported/assigned separately (the pattern
 * `create-next-app` itself now generates: `const eslintConfig =
 * defineConfig([...]); export default eslintConfig;`). Returns null if none
 * of these shapes match, so the caller can fall back to warning the user. */
function findConfigArray(sourceFile: SourceFile): ArrayLiteralExpression | null {
  const exportAssignment = sourceFile
    .getExportAssignments()
    .find((ea) => !ea.isExportEquals());
  if (exportAssignment) {
    const resolved = resolveToArrayLiteral(exportAssignment.getExpression(), sourceFile);
    if (resolved) return resolved;
  }

  for (const statement of sourceFile.getStatements()) {
    if (!Node.isExpressionStatement(statement)) continue;
    const inner = statement.getExpression();
    if (
      Node.isBinaryExpression(inner) &&
      inner.getOperatorToken().getText() === '=' &&
      inner.getLeft().getText() === 'module.exports'
    ) {
      const resolved = resolveToArrayLiteral(inner.getRight(), sourceFile);
      if (resolved) return resolved;
    }
  }

  return null;
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

    // AST-based injection (not a regex/text splice) so it survives whatever
    // shape the config's array is in — a direct `export default [...]`, one
    // wrapped in a helper call like `defineConfig([...])`, or (as
    // create-next-app itself now generates) assigned to a variable first and
    // exported separately.
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(fullPath, existing);
    const configArray = findConfigArray(sourceFile);

    if (configArray) {
      for (const entry of newEntries) configArray.addElement(entry);
      const formatted = await formatCode(sourceFile.getFullText(), 'babel');
      return [[existingFlat, formatted]];
    }

    consola.warn(
      `Could not inject into ${existingFlat} — add these entries manually:\n${newEntries.join('\n')}`
    );
    return [];
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
    'reactPlugin.configs.flat.recommended',
    // Every current scaffold (Vite, Next.js, CRA) uses the automatic JSX
    // runtime — must come after `recommended` to override its
    // `react-in-jsx-scope`/`jsx-uses-react` rules, which assume the old
    // classic transform and otherwise flag every JSX-using file.
    "reactPlugin.configs.flat['jsx-runtime']",
    "reactHooksPlugin.configs.flat['recommended-latest']",
  ];

  if (hasTs) configEntries.push('...tseslint.configs.recommended');
  if (hasNext) {
    configEntries.push(
      `{ plugins: { '@next/next': nextPlugin }, rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs['core-web-vitals'].rules } }`,
      // Matches what create-next-app's own template ignores — without this,
      // ESLint lints Next's generated `.next/types/**` output too (verified
      // against a real create-next-app project: `.next/types/validator.ts`
      // got flagged with unrelated `no-explicit-any` errors).
      `{ ignores: ['.next/**', 'out/**', 'build/**', 'next-env.d.ts'] }`
    );
  }
  if (hasPrettier) configEntries.push('prettierConfig');

  // `projectService: true` alone requires every linted file to belong to a
  // tsconfig project — root-level config files never do (eslint.config.mjs,
  // postcss.config.mjs, etc. are outside any tsconfig's `include`), which
  // otherwise throws a parsing error the moment ESLint lints them.
  // `allowDefaultProject` opts such files into a non-type-aware fallback
  // lint pass instead of crashing; `tsconfigRootDir` makes the glob resolve
  // relative to this file regardless of ESLint's cwd. Deliberately excludes
  // `.ts`/`.mts` — a `.ts` config file (e.g. next.config.ts) is typically
  // already covered by the tsconfig's own `**/*.ts` include, and
  // typescript-eslint errors if a file matches both real project and
  // fallback (verified against a real create-next-app project).
  const settingsEntry = hasTs
    ? `{ settings: { react: { version: 'detect' } }, languageOptions: { parserOptions: { projectService: { allowDefaultProject: ['*.config.js', '*.config.mjs', '*.config.cjs'] }, tsconfigRootDir: import.meta.dirname } } }`
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
