#!/usr/bin/env node

import fs from 'fs-extra';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { detect as detectPM } from '@antfu/ni';
import {
  confirm,
  text,
  multiselect,
  select,
  isCancel,
  cancel,
} from '@clack/prompts';
import boxen from 'boxen';
import consola from 'consola';
import { execa } from 'execa';
import ora from 'ora';
import { bold, underline, bgMagenta, black, white, dim, whiteBright } from 'colorette';
import prettier from 'prettier';
import { Command } from 'commander';
import { retro } from 'gradient-string';
import stripJsonComments from 'strip-json-comments';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


// H-4: Lazy-load with fallback so --help/--version never crash on a missing package.json
function loadPkg(): { name?: string; version?: string; description?: string } {
  try {
    return fs.readJSONSync(path.join(__dirname, '../package.json'));
  } catch {
    return {
      name: 'volt-fast',
      version: 'unknown',
      description: 'Configure your frontend project with ease',
    };
  }
}

function handlePromptCancel(
  value: unknown
): asserts value is NonNullable<unknown> {
  if (isCancel(value)) {
    cancel('Operation cancelled.');
    process.exit(0);
  }
}

// M-1: Single Promise.all instead of three sequential batches
async function detectProjectTools(dir: string): Promise<string[]> {
  const [
    hasNextConfigJs,
    hasNextConfigMjs,
    hasNextConfigCjs,
    hasNextConfigTs,
    hasViteConfigJs,
    hasViteConfigTs,
    hasViteConfigMjs,
    hasTsConfig,
  ] = await Promise.all([
    fs.pathExists(`${dir}/next.config.js`),
    fs.pathExists(`${dir}/next.config.mjs`),
    fs.pathExists(`${dir}/next.config.cjs`),
    fs.pathExists(`${dir}/next.config.ts`),
    fs.pathExists(`${dir}/vite.config.js`),
    fs.pathExists(`${dir}/vite.config.ts`),
    fs.pathExists(`${dir}/vite.config.mjs`),
    fs.pathExists(`${dir}/tsconfig.json`),
  ]);

  const tools: string[] = [];
  if (
    [hasNextConfigJs, hasNextConfigMjs, hasNextConfigCjs, hasNextConfigTs].some(
      Boolean
    )
  ) {
    tools.push('nextjs');
  }
  if ([hasViteConfigJs, hasViteConfigTs, hasViteConfigMjs].some(Boolean)) {
    tools.push('vite');
  }
  if (hasTsConfig) {
    tools.push('typescript');
  }

  // Detect existing tailwind installation via package.json
  try {
    const pkgPath = path.join(dir, 'package.json');
    if (await fs.pathExists(pkgPath)) {
      const pkg = await fs.readJSON(pkgPath);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if ('tailwindcss' in allDeps) {
        tools.push('tailwind');
      }
    }
  } catch {
    // ignore — package.json missing or malformed
  }

  return tools;
}

async function detectPackageManager(cwd: string): Promise<string> {
  const result = await detectPM({ programmatic: true, cwd });
  if (result === 'yarn@berry') return 'yarn';
  if (result === 'pnpm@6') return 'pnpm';
  if (result === 'bun') return 'bun';
  return result ?? 'npm';
}

// M-4: Spinner with elapsed time so users see activity during 30-90s installs
async function runCommand(
  pm: string,
  command: string,
  args: string[],
  cwd: string,
  messages: [string, string, string]
): Promise<void> {
  const displayCommand: string =
    pm === 'npm' && command === 'add' ? 'install' : command;
  consola.info(
    boxen(`\n${pm} ${displayCommand} ${args.join(' ')}\n`, {
      title: 'CLI will run the following command:',
      borderStyle: 'round',
      borderColor: 'magenta',
      margin: 1,
      padding: 1,
    })
  );
  const proceed = await confirm({ message: 'Continue?' });
  if (!proceed) {
    consola.info(messages[2]);
    return;
  }

  const spinner = ora(messages[0]).start();
  const startTime = Date.now();
  const ticker = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    spinner.text = `${messages[0]} (${elapsed}s elapsed)`;
  }, 1000);

  try {
    await execa(pm, [displayCommand, ...args], { cwd });
    clearInterval(ticker);
    spinner.succeed(messages[1]);
  } catch (error) {
    clearInterval(ticker);
    spinner.fail('Installation failed.');
    throw error;
  }
}

type FilenameConvention = 'KEBAB_CASE' | 'PASCAL_CASE' | 'CAMEL_CASE' | 'SNAKE_CASE';

// M-3: Typed settings replacing the previous `any`
type GeneratorSettings = {
  tailwind?: { cssPath?: string | null };
  husky?: HuskySettings;
  filenameConvention?: FilenameConvention;
};

type HuskySettings = {
  enablePreCommit: boolean;
  enablePrePush: boolean;
  runFormatOnCommit: boolean;
  runTestsOnCommit: boolean;
  runBuildOnPush: boolean;
  testRunner: 'vitest' | 'jest' | null;
};

type GeneratorOptions = {
  enabledTools: string[];
  detectedTools: string[];
  settings: GeneratorSettings;
  packageManager: string;
  projectDir: string;
};

type GeneratorFunction = (
  options: GeneratorOptions
) => Promise<[string, string][]>;

const createConfigFiles =
  (
    enabledTools: string[],
    detectedTools: string[],
    projectDir: string,
    settings: GeneratorSettings,
    packageManager: string
  ) =>
  async (label: string, generator: GeneratorFunction): Promise<void> => {
    await writeConfigFiles(
      label,
      generator,
      enabledTools,
      detectedTools,
      projectDir,
      settings,
      packageManager
    );
  };

async function writeConfigFiles(
  label: string,
  generator: GeneratorFunction,
  enabledTools: string[],
  detectedTools: string[],
  projectDir: string,
  settings: GeneratorSettings,
  packageManager: string
): Promise<void> {
  const spinner = ora(`Setting up ${label}`).start();
  const files: [string, string][] = await generator({
    enabledTools,
    detectedTools,
    settings,
    packageManager,
    projectDir,
  });
  for (const [filename, content] of files) {
    const filePath = path.resolve(projectDir, filename);
    fs.outputFileSync(filePath, content, 'utf-8');
    spinner.text = `Writing ${bold(filename)}`;
  }
  spinner.succeed(`Added ${label}`);
}

// H-3: Updated for ESLint v9+ flat config — generates eslint.config.mjs
function calculateDependencies(
  selectedTools: string[],
  detectedTools: string[]
): string[] {
  const deps: string[] = [];
  if (selectedTools.includes('tailwind')) {
    deps.push('tailwindcss');
    if (detectedTools.includes('vite')) {
      deps.push('@tailwindcss/vite');
    }
  }
  if (selectedTools.includes('eslint')) {
    deps.push(
      'eslint',
      '@eslint/js',
      'eslint-plugin-react',
      'eslint-plugin-react-hooks',
      'eslint-plugin-check-file'
    );
    if (detectedTools.includes('typescript')) {
      // typescript-eslint replaces @typescript-eslint/parser + @typescript-eslint/eslint-plugin
      deps.push('typescript-eslint');
    }
    if (detectedTools.includes('nextjs')) {
      deps.push('@next/eslint-plugin-next');
    }
    if (selectedTools.includes('prettier')) {
      // eslint-config-prettier replaces eslint-plugin-prettier for flat config
      deps.push('eslint-config-prettier');
    }
  }
  if (selectedTools.includes('prettier')) {
    deps.push('prettier', '@trivago/prettier-plugin-sort-imports');
    if (selectedTools.includes('tailwind') || detectedTools.includes('tailwind')) {
      deps.push('prettier-plugin-tailwindcss');
    }
  }
  if (selectedTools.includes('husky')) {
    deps.push('husky');
  }
  // C-3: commitlint is now an explicit opt-in with its required packages
  if (selectedTools.includes('commitlint')) {
    deps.push('@commitlint/cli', '@commitlint/config-conventional');
  }
  return deps;
}

function validateDirectory(dir: string): string | true {
  const resolved = path.resolve(dir);
  const exists = fs.existsSync(resolved);
  const stat = fs.lstatSync(resolved, { throwIfNoEntry: false });
  const isDir = stat?.isDirectory();
  if (!exists) {
    return `${bold(dir)} does not exist. Please enter an existing directory; this CLI won't create a full project from scratch.`;
  }
  if (!isDir) {
    return `${bold(dir)} is not a directory.`;
  }
  return true;
}

async function promptProjectDirectory({
  projectdir,
}: {
  projectdir?: string;
}): Promise<string | symbol> {
  if (projectdir) return projectdir;
  return await text({
    message: 'Where would you like to add the config files?',
    initialValue: '.',
    validate: (input: string): string | undefined => {
      const result = validateDirectory(input);
      return result === true ? undefined : result;
    },
  });
}

async function promptTools(): Promise<string[] | symbol> {
  return await multiselect({
    message: `What tools would you like to use?\n${bold('Recommended')}: All of them. They work really well together.`,
    options: [
      { value: 'tailwind', label: 'Tailwind CSS' },
      { value: 'eslint', label: 'ESLint' },
      { value: 'prettier', label: 'Prettier' },
      { value: 'husky', label: 'Husky (git hooks)' },
      // C-3: commitlint is now a first-class opt-in with full config generation
      {
        value: 'commitlint',
        label: 'Commitlint (enforce conventional commit messages)',
      },
      { value: 'shadcn', label: 'Shadcn UI' },
    ],
  });
}

async function promptCustomHooks(): Promise<boolean | symbol> {
  return await confirm({ message: 'Do you want to include custom hooks?' });
}

async function promptFilenameConvention(): Promise<FilenameConvention | symbol> {
  return await select({
    message: 'Filename naming convention?',
    options: [
      { value: 'KEBAB_CASE', label: 'kebab-case', hint: 'default — e.g. my-component.tsx' },
      { value: 'PASCAL_CASE', label: 'PascalCase', hint: 'e.g. MyComponent.tsx' },
      { value: 'CAMEL_CASE', label: 'camelCase', hint: 'e.g. myComponent.tsx' },
      { value: 'SNAKE_CASE', label: 'snake_case', hint: 'e.g. my_component.tsx' },
    ],
    initialValue: 'KEBAB_CASE',
  });
}

async function formatCode(
  code: string,
  parser: string = 'babel'
): Promise<string> {
  return await prettier.format(code, { parser });
}

// H-3: ESLint v9+ flat config — generates eslint.config.mjs instead of .eslintrc.cjs
async function generateEslintConfig(
  options: GeneratorOptions
): Promise<[string, string][]> {
  const { enabledTools, detectedTools, settings, projectDir } = options;
  const hasTs = detectedTools.includes('typescript');
  const hasNext = detectedTools.includes('nextjs');
  const hasPrettier = enabledTools.includes('prettier');
  const convention: FilenameConvention = settings.filenameConvention ?? 'KEBAB_CASE';

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

    // Build only the new entries we're adding
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

    // Prepend missing imports before the first non-import line
    const missingImports = newImports.filter((imp) => !existing.includes(imp));
    if (missingImports.length > 0) {
      existing = `${missingImports.join('\n')}\n${existing}`;
    }

    // Inject new entries before the FINAL `]` that closes the export default array.
    // Use a greedy `[\s\S]*` so the regex consumes as much as possible, leaving only
    // the very last `]` (and optional `;\n`) for the tail groups — this correctly
    // skips any `]` characters inside string keys like configs['recommended-latest'].
    // Match the final `]` that closes the config array, optionally followed by
    // closing parens (e.g. `defineConfig([...])`) and an optional semicolon.
    const closeArrayMatch = existing.match(/^([\s\S]*)\](\)*\s*;?\s*)$/);
    if (closeArrayMatch) {
      // Trim trailing whitespace from group 1 and ensure exactly one trailing comma
      // before injecting — avoids double-comma when the existing config already
      // has a trailing comma (which Prettier always adds).
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

  // Check for a legacy .eslintrc.* — warn and skip rather than create a conflicting file
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

  if (hasTs) {
    importLines.push("import tseslint from 'typescript-eslint';");
  }
  if (hasNext) {
    importLines.push("import nextPlugin from '@next/eslint-plugin-next';");
  }
  if (hasPrettier) {
    importLines.push("import prettierConfig from 'eslint-config-prettier';");
  }

  const configEntries: string[] = [
    'js.configs.recommended',
    '...reactPlugin.configs.flat.recommended',
    "reactHooksPlugin.configs['recommended-latest']",
  ];

  if (hasTs) {
    configEntries.push('...tseslint.configs.recommended');
  }
  if (hasNext) {
    configEntries.push(
      `{ plugins: { '@next/next': nextPlugin }, rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs['core-web-vitals'].rules } }`
    );
  }
  if (hasPrettier) {
    configEntries.push('prettierConfig');
  }

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

async function generatePrettierConfig(
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
        ${plugins.map((plugin) => `"${plugin}"`).join(', ')}
      ],
    };

    export default config;
  `);
  return [['prettier.config.mjs', configContent]];
}

// H-2: Read existing CSS content and prepend rather than silently overwrite
// Tailwind v4 no longer needs a postcss.config — just the CSS import is sufficient
async function generateTailwindConfig(
  options: GeneratorOptions
): Promise<[string, string][]> {
  const results: [string, string][] = [];

  const cssPath: string | null | undefined =
    options.settings?.tailwind?.cssPath ||
    getDefaultTailwindCssPath(options.detectedTools);

  if (cssPath) {
    const tailwindImport = '@import "tailwindcss";';
    const fullCssPath = path.resolve(options.projectDir, cssPath);

    let existingContent: string | null = null;
    try {
      existingContent = await fs.readFile(fullCssPath, 'utf-8');
    } catch {
      // file doesn't exist yet — will be created fresh
    }

    if (existingContent?.includes(tailwindImport)) {
      consola.info(
        `Tailwind import already present in ${cssPath}, skipping CSS write.`
      );
    } else if (existingContent) {
      // Prepend import rather than destroying existing styles
      results.push([cssPath, `${tailwindImport}\n\n${existingContent}`]);
    } else {
      results.push([cssPath, await formatCode(`${tailwindImport}\n`, 'css')]);
    }
  }

  // For Vite projects, inject tailwindcss() plugin into vite.config
  if (options.detectedTools.includes('vite')) {
    const viteConfigPathTs = path.join(options.projectDir, 'vite.config.ts');
    const viteConfigPathJs = path.join(options.projectDir, 'vite.config.js');
    const viteConfigPathMjs = path.join(options.projectDir, 'vite.config.mjs');

    let viteConfigPath: string | null = null;
    if (await fs.pathExists(viteConfigPathTs)) viteConfigPath = viteConfigPathTs;
    else if (await fs.pathExists(viteConfigPathJs)) viteConfigPath = viteConfigPathJs;
    else if (await fs.pathExists(viteConfigPathMjs)) viteConfigPath = viteConfigPathMjs;

    if (viteConfigPath) {
      let viteConfig = await fs.readFile(viteConfigPath, 'utf-8');
      if (!viteConfig.includes('@tailwindcss/vite')) {
        if (!viteConfig.includes("import tailwindcss from '@tailwindcss/vite'")) {
          viteConfig = `import tailwindcss from '@tailwindcss/vite';\n${viteConfig}`;
        }
        viteConfig = viteConfig.replace(
          /plugins\s*:\s*\[/,
          'plugins: [tailwindcss(), '
        );
        await fs.writeFile(viteConfigPath, viteConfig, 'utf-8');
        consola.success(
          `Updated ${path.basename(viteConfigPath)} with @tailwindcss/vite plugin.`
        );
      }
    }
  }

  return results;
}

async function findExistingConfig(
  dir: string,
  candidates: string[]
): Promise<string | null> {
  for (const candidate of candidates) {
    if (await fs.pathExists(path.join(dir, candidate))) return candidate;
  }
  return null;
}

function getDefaultTailwindCssPath(detectedTools: string[]): string {
  if (detectedTools.includes('nextjs')) {
    return './src/app/globals.css';
  }
  if (detectedTools.includes('vite')) {
    return './src/index.css';
  }
  return './src/styles.css';
}

async function resolveTailwindCssInitialPath(
  projectDir: string,
  detectedTools: string[]
): Promise<string> {
  if (detectedTools.includes('nextjs')) {
    const nextCssCandidates: string[] = [
      './src/app/globals.css',
      './app/globals.css',
    ];
    for (const cssCandidate of nextCssCandidates) {
      if (await fs.pathExists(path.join(projectDir, cssCandidate))) {
        return cssCandidate;
      }
    }
    return nextCssCandidates[0];
  }

  if (detectedTools.includes('vite')) {
    const viteCssPath = './src/index.css';
    if (await fs.pathExists(path.join(projectDir, viteCssPath))) {
      return viteCssPath;
    }
    return viteCssPath;
  }

  return './src/styles.css';
}

async function promptTailwindCSSFile({
  projectDir,
  detectedTools,
}: {
  projectDir: string;
  detectedTools: string[];
}): Promise<{ cssPath: string | null }> {
  const writeCSSResult = await confirm({ message: 'Write Tailwind CSS file?' });
  handlePromptCancel(writeCSSResult);
  const writeCSS: boolean = writeCSSResult as boolean;

  let cssPath: string | null = null;
  if (writeCSS) {
    const initialCssPath: string = await resolveTailwindCssInitialPath(
      projectDir,
      detectedTools
    );
    const cssPathResult = await text({
      message: 'Where would you like to write the Tailwind CSS file?',
      initialValue: initialCssPath,
    });
    handlePromptCancel(cssPathResult);
    cssPath = cssPathResult as string;
  }
  return { cssPath };
}

async function promptHuskySettings(): Promise<HuskySettings> {
  const hookTypesResult = await multiselect({
    message: 'Which Husky hooks would you like to set up?',
    options: [
      { value: 'pre-commit', label: 'Pre-commit' },
      { value: 'pre-push', label: 'Pre-push (build)' },
    ],
  });
  handlePromptCancel(hookTypesResult);
  const hookTypes: string[] = hookTypesResult as string[];

  const enablePreCommit = hookTypes.includes('pre-commit');
  const enablePrePush = hookTypes.includes('pre-push');

  let runFormatOnCommit = false;
  let runTestsOnCommit = false;
  let runBuildOnPush = false;
  let testRunner: 'vitest' | 'jest' | null = null;

  if (enablePreCommit) {
    const formatResult = await confirm({
      message: 'Run format before every commit?',
    });
    handlePromptCancel(formatResult);
    runFormatOnCommit = formatResult as boolean;

    const testsResult = await confirm({
      message: 'Run tests before every commit?',
    });
    handlePromptCancel(testsResult);
    runTestsOnCommit = testsResult as boolean;

    if (runTestsOnCommit) {
      const testRunnerResult = await select({
        message: 'Which test runner should we set up?',
        options: [
          { value: 'vitest', label: 'Vitest' },
          { value: 'jest', label: 'Jest' },
        ],
      });
      handlePromptCancel(testRunnerResult);
      testRunner = testRunnerResult as 'vitest' | 'jest';
    }
  }

  if (enablePrePush) {
    const buildResult = await confirm({
      message: 'Run build before every push?',
    });
    handlePromptCancel(buildResult);
    runBuildOnPush = buildResult as boolean;
  }

  return {
    enablePreCommit,
    enablePrePush,
    runFormatOnCommit,
    runTestsOnCommit,
    runBuildOnPush,
    testRunner,
  };
}

// C-1: Use detected package manager in hook script content
// C-3: Only add commit-msg hook when commitlint is explicitly selected
async function generateHuskyConfig(
  options: GeneratorOptions
): Promise<[string, string][]> {
  const huskySettings: HuskySettings | undefined = options.settings?.husky;
  const { enabledTools, packageManager: pm } = options;
  const files: [string, string][] = [];

  if (huskySettings?.enablePreCommit) {
    const preCommitCommands: string[] = [`${pm} lint`];
    if (huskySettings.runFormatOnCommit) {
      preCommitCommands.push(`${pm} format:fix`);
    }
    if (huskySettings.runTestsOnCommit) {
      preCommitCommands.push(`${pm} test`);
    }
    files.push(['.husky/pre-commit', `${preCommitCommands.join('\n')}\n`]);
  }

  if (huskySettings?.enablePrePush && huskySettings.runBuildOnPush) {
    files.push(['.husky/pre-push', `${pm} build\n`]);
  }

  // Only emit commit-msg hook when user explicitly opted into commitlint
  if (enabledTools.includes('commitlint')) {
    const execBin =
      pm === 'pnpm'
        ? 'pnpx'
        : pm === 'yarn'
          ? 'yarn'
          : pm === 'bun'
            ? 'bunx'
            : 'npx';
    files.push(['.husky/commit-msg', `${execBin} commitlint --edit $1\n`]);
  }

  return files;
}

// C-3: Full commitlint setup with config file generation
async function generateCommitlintConfig(
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

// M-5: Warn on conflicting existing scripts instead of silently skipping
async function ensurePackageScripts(
  projectDir: string,
  scripts: Record<string, string>
): Promise<void> {
  const packageJsonPath = path.join(projectDir, 'package.json');
  if (!(await fs.pathExists(packageJsonPath))) {
    consola.warn('Could not find package.json to update scripts.');
    return;
  }

  const packageJson = await fs.readJSON(packageJsonPath);
  packageJson.scripts = packageJson.scripts || {};

  let updated = false;
  for (const [scriptName, scriptValue] of Object.entries(scripts)) {
    if (!packageJson.scripts[scriptName]) {
      packageJson.scripts[scriptName] = scriptValue;
      updated = true;
    } else if (packageJson.scripts[scriptName] !== scriptValue) {
      consola.warn(
        `Script ${bold(`"${scriptName}"`)} already exists as ${bold(`"${packageJson.scripts[scriptName]}"`)}, skipping (wanted: "${scriptValue}").`
      );
    }
  }

  if (updated) {
    await fs.writeJSON(packageJsonPath, packageJson, { spaces: 2 });
    consola.success('Updated package.json scripts.');
  }
}

// C-2: Run `husky init` to create git hook infrastructure before writing hook files
async function configureHusky(
  projectDir: string,
  pm: string
): Promise<void> {
  const execBin =
    pm === 'pnpm'
      ? 'pnpx'
      : pm === 'yarn'
        ? 'yarn'
        : pm === 'bun'
          ? 'bunx'
          : 'npx';
  try {
    await execa(execBin, ['husky', 'init'], { cwd: projectDir });
    consola.success('Initialized Husky git hooks.');
  } catch {
    // Fallback: manually point git at the hooks directory
    try {
      await execa('git', ['config', 'core.hooksPath', '.husky'], {
        cwd: projectDir,
      });
      consola.success('Configured Git hooks path to .husky.');
    } catch {
      consola.warn(
        'Could not initialize Husky automatically. Run "npx husky init" in your project manually.'
      );
    }
  }
}

async function copyCustomHooks(projectDir: string): Promise<void> {
  const hooksSrc: string = path.join(__dirname, '../templates', 'hooks');
  const hooksDest: string = path.join(projectDir, './hooks');
  await fs.copy(hooksSrc, hooksDest);
  consola.success('Custom hooks copied successfully.');
}

const setupCommand = new Command('setup')
  .description('Pull in all the dependencies and configuration files you need')
  .argument('[projectdir]', 'Root directory where the project is located')
  // H-5: Top-level try-catch so unexpected errors show a user-friendly message
  .action(async (projectdir?: string) => {
    try {
      const G = '\x1b[48;2;191;255;0m  \x1b[0m';   // lime green block
      const D = '\x1b[48;2;58;76;0m  \x1b[0m';     // dark bolt block
      const _ = '  ';                               // empty (terminal bg)
      // Lightning bolt goes upper-right → lower-left with classic jag
      const logo = [
        `${_}${_}${G}${G}${G}${G}${G}${G}${_}${_}`,  // rounded top
        `${_}${G}${G}${G}${G}${G}${G}${G}${G}${_}`,
        `${G}${G}${G}${G}${G}${D}${D}${D}${G}${G}`,  // bolt top (upper-right)
        `${G}${G}${G}${G}${D}${D}${D}${G}${G}${G}`,  // stepping down-left
        `${G}${G}${G}${D}${D}${D}${G}${G}${G}${G}`,  // stepping down-left
        `${G}${D}${D}${D}${D}${D}${D}${D}${G}${G}`,  // wide jag (classic bolt shape)
        `${G}${G}${G}${D}${D}${D}${G}${G}${G}${G}`,  // bottom continuing down-left
        `${G}${G}${D}${D}${D}${G}${G}${G}${G}${G}`,  // bottom tip (lower-left)
        `${_}${G}${G}${G}${G}${G}${G}${G}${G}${_}`,
        `${_}${_}${G}${G}${G}${G}${G}${G}${_}${_}`,  // rounded bottom
      ].join('\n');
      console.log('\n' + logo + '\n');
      const { version } = loadPkg();
      console.log(bold(white('Volt-fast')) + dim(white(` v${version ?? 'unknown'}`)));
      console.log(dim(white(`Let's set up your project!\n`)));

      const targetDirResult = await promptProjectDirectory({ projectdir });
      handlePromptCancel(targetDirResult);
      const targetDir = targetDirResult as string;
      const resolvedDir: string = path.resolve(targetDir);

      const proceedWithOverride = await confirm({
        message: `Depending on which tools you enable, we will OVERRIDE these files:
eslint.config.mjs, prettier.config.mjs, commitlint.config.mjs, tailwind CSS entry, .husky/pre-commit, .husky/pre-push, .husky/commit-msg

Continue?`,
      });
      handlePromptCancel(proceedWithOverride);
      if (!proceedWithOverride) {
        consola.info('Operation cancelled.');
        process.exit(0);
      }

      const selectedToolsResult = await promptTools();
      handlePromptCancel(selectedToolsResult);
      const selectedTools: string[] = selectedToolsResult as string[];
      const detected: string[] = await detectProjectTools(resolvedDir);

      const filenameConventionResult = selectedTools.includes('eslint')
        ? await promptFilenameConvention()
        : null;
      if (filenameConventionResult !== null) handlePromptCancel(filenameConventionResult);
      const filenameConvention = filenameConventionResult as FilenameConvention | null;

      const huskySettings = selectedTools.includes('husky')
        ? await promptHuskySettings()
        : null;

      if (
        huskySettings?.runFormatOnCommit &&
        !selectedTools.includes('prettier')
      ) {
        selectedTools.push('prettier');
      }

      const tailwindSettings = selectedTools.includes('tailwind')
        ? await promptTailwindCSSFile({
            projectDir: resolvedDir,
            detectedTools: detected,
          })
        : null;

      const includeHooksResult = await promptCustomHooks();
      handlePromptCancel(includeHooksResult);
      const includeHooks: boolean = includeHooksResult as boolean;
      const packageManager: string = await detectPackageManager(
        targetDir ?? '.'
      );

      const extraDeps: string[] = [];
      if (huskySettings?.runTestsOnCommit) {
        if (huskySettings.testRunner === 'vitest') {
          extraDeps.push('vitest');
        }
        if (huskySettings.testRunner === 'jest') {
          extraDeps.push('jest');
          if (detected.includes('typescript')) {
            extraDeps.push('ts-jest', '@types/jest');
          }
        }
      }

      const dependencies: string[] = Array.from(
        new Set([
          ...calculateDependencies(selectedTools, detected),
          ...extraDeps,
        ])
      );

      const generatorSettings: GeneratorSettings = {
        ...(tailwindSettings ? { tailwind: tailwindSettings } : {}),
        ...(huskySettings ? { husky: huskySettings } : {}),
        ...(filenameConvention ? { filenameConvention } : {}),
      };

      const createFiles = createConfigFiles(
        selectedTools,
        detected,
        resolvedDir,
        generatorSettings,
        packageManager
      );

      if (dependencies.length > 0) {
        await runCommand(
          packageManager,
          'add',
          ['-D', ...dependencies],
          resolvedDir,
          [
            'Installing dependencies',
            'Installed dependencies successfully',
            'Skipped installation. Please run the above command manually.',
          ]
        );
      }

      if (selectedTools.includes('tailwind')) {
        await createFiles('Tailwind CSS', generateTailwindConfig);
      }
      if (selectedTools.includes('prettier')) {
        await createFiles('Prettier', generatePrettierConfig);
      }
      if (selectedTools.includes('eslint')) {
        await createFiles('ESLint', generateEslintConfig);
      }
      if (selectedTools.includes('commitlint')) {
        await createFiles('Commitlint', generateCommitlintConfig);
      }
      if (selectedTools.includes('husky')) {
        const scriptsToEnsure: Record<string, string> = {};
        if (huskySettings?.runFormatOnCommit) {
          scriptsToEnsure['format:fix'] = 'prettier . --write';
        }
        if (huskySettings?.runTestsOnCommit) {
          scriptsToEnsure['test'] =
            huskySettings.testRunner === 'vitest' ? 'vitest' : 'jest';
        }
        if (Object.keys(scriptsToEnsure).length > 0) {
          await ensurePackageScripts(resolvedDir, scriptsToEnsure);
        }

        // C-2: Init husky FIRST so the hook infrastructure exists before we write files
        await configureHusky(resolvedDir, packageManager);
        await createFiles('Husky', generateHuskyConfig);
      }
      if (includeHooks) {
        await copyCustomHooks(resolvedDir);
      }

      if (selectedTools.includes('shadcn')) {
        consola.start('Configuring import aliases for Shadcn UI...');
        try {
          const isVite = detected.includes('vite');

          const tsconfigPathsToUpdate = [
            path.join(resolvedDir, 'tsconfig.json'),
          ];

          if (
            isVite &&
            fs.existsSync(path.join(resolvedDir, 'tsconfig.app.json'))
          ) {
            tsconfigPathsToUpdate.push(
              path.join(resolvedDir, 'tsconfig.app.json')
            );
          }

          const hasSrcDir = fs.existsSync(path.join(resolvedDir, 'src'));
          const aliasTarget = hasSrcDir ? './src/*' : './*';

          for (const tsconfigPath of tsconfigPathsToUpdate) {
            if (fs.existsSync(tsconfigPath)) {
              const rawTsconfig = fs.readFileSync(tsconfigPath, 'utf-8');
              const tsconfig = JSON.parse(stripJsonComments(rawTsconfig));
              if (!tsconfig.compilerOptions) tsconfig.compilerOptions = {};

              tsconfig.compilerOptions.baseUrl = '.';
              tsconfig.compilerOptions.paths = {
                ...tsconfig.compilerOptions.paths,
                '@/*': [aliasTarget],
              };

              fs.writeJSONSync(tsconfigPath, tsconfig, { spaces: 2 });
              consola.success(
                `Updated ${path.basename(tsconfigPath)} with import aliases.`
              );
            }
          }

          if (isVite) {
            const viteConfigPathTs = path.join(resolvedDir, 'vite.config.ts');
            const viteConfigPathJs = path.join(resolvedDir, 'vite.config.js');

            let viteConfigPath: string | null = null;
            if (fs.existsSync(viteConfigPathTs))
              viteConfigPath = viteConfigPathTs;
            else if (fs.existsSync(viteConfigPathJs))
              viteConfigPath = viteConfigPathJs;

            if (viteConfigPath) {
              let viteConfig = fs.readFileSync(viteConfigPath, 'utf-8');
              if (!viteConfig.includes('vite-tsconfig-paths')) {
                consola.start('Installing vite-tsconfig-paths...');
                await execa(
                  packageManager,
                  ['add', '-D', 'vite-tsconfig-paths'],
                  { cwd: resolvedDir }
                );

                if (
                  !viteConfig.includes(
                    "import tsconfigPaths from 'vite-tsconfig-paths'"
                  )
                ) {
                  viteConfig =
                    `import tsconfigPaths from 'vite-tsconfig-paths';\n` +
                    viteConfig;
                  // H-1: Regex handles varying whitespace/newlines after 'plugins: ['
                  viteConfig = viteConfig.replace(
                    /plugins\s*:\s*\[/,
                    'plugins: [tsconfigPaths(), '
                  );
                  fs.writeFileSync(viteConfigPath, viteConfig, 'utf-8');
                  consola.success(
                    'Updated vite.config with tsconfigPaths plugin.'
                  );
                }
              }
            }
          }

          consola.start('Initializing Shadcn UI...');
          await execa('npx', ['shadcn@latest', 'init'], {
            cwd: resolvedDir,
            stdio: 'inherit',
          });
          consola.success('Shadcn UI initialized successfully.');
        } catch (error) {
          consola.error(
            'Failed to initialize Shadcn UI. You may need to run it manually: npx shadcn@latest init'
          );
          if (error instanceof Error) {
            console.error(error.message);
          }
        }
      }

      consola.log(
        `\u{1F973} Done! You just saved ${bgMagenta(black('a few minutes'))} in your day. Enjoy the little things in life. \u2728`
      );
    } catch (error) {
      if (error instanceof Error) {
        consola.error(`Setup failed: ${error.message}`);
      } else {
        consola.error('Setup failed with an unexpected error.');
      }
      process.exit(1);
    }
  });

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

async function main(): Promise<void> {
  // H-4: pkg loaded here so --help/--version never crash on missing package.json
  const pkg = loadPkg();
  const program = new Command()
    .name(pkg.name || 'volt-fast')
    .description(pkg.description || 'Configure your frontend project with ease')
    .version(
      pkg.version || 'unknown',
      '-v, --version',
      'Output the current CLI version'
    );
  program.addCommand(setupCommand);
  program.parse();
}

main();
