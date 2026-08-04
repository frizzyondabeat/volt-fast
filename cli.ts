#!/usr/bin/env node

import { cancel, confirm, isCancel, multiselect, select, text } from '@clack/prompts';
import boxen from 'boxen';
import { bgMagenta, black, bold, dim, white } from 'colorette';
import { Command } from 'commander';
import consola from 'consola';
import { execa } from 'execa';
import fs from 'fs-extra';
import ora from 'ora';
import path, { dirname } from 'path';
import stripJsonComments from 'strip-json-comments';
import { fileURLToPath } from 'url';
import {
  generateCommitlintConfig,
  generateEslintConfig,
  generateHuskyConfig,
  generatePrettierConfig,
  generateTailwindConfig,
  generateTestConfig,
} from './src/generators/index.js';
import type {
  FilenameConvention,
  GeneratorFunction,
  GeneratorSettings,
  HuskySettings,
} from './src/generators/types.js';
import { calculateDependencies } from './src/utils/calculate-deps.js';
import { detectPackageManager, detectProjectTools } from './src/utils/detect-project.js';
import { computeRenamePlan } from './src/utils/rename-plan.js';
import { applyRenamePlan } from './src/utils/rename-project.js';
import { calculateTestDependencies, testScripts } from './src/utils/test-deps.js';
import type { TestFramework, TestRunner } from './src/utils/test-deps.js';
import { DEFAULT_SOURCE_EXTENSIONS, walkSourceFiles } from './src/utils/walk-source-files.js';

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

function printBanner(subtitle: string): void {
  const G = '\x1b[48;2;191;255;0m  \x1b[0m';   // lime green block
  const D = '\x1b[48;2;58;76;0m  \x1b[0m';     // dark bolt block
  const _ = '  ';                               // empty (terminal bg)
  const logo = [
    `${_}${_}${G}${G}${G}${G}${G}${G}${_}${_}`,
    `${_}${G}${G}${G}${G}${G}${G}${G}${G}${_}`,
    `${G}${G}${G}${G}${G}${D}${D}${D}${G}${G}`,
    `${G}${G}${G}${G}${D}${D}${D}${G}${G}${G}`,
    `${G}${G}${G}${D}${D}${D}${G}${G}${G}${G}`,
    `${G}${D}${D}${D}${D}${D}${D}${D}${G}${G}`,
    `${G}${G}${G}${D}${D}${D}${G}${G}${G}${G}`,
    `${G}${G}${D}${D}${D}${G}${G}${G}${G}${G}`,
    `${_}${G}${G}${G}${G}${G}${G}${G}${G}${_}`,
    `${_}${_}${G}${G}${G}${G}${G}${G}${_}${_}`,
  ].join('\n');
  const { version } = loadPkg();
  console.log('\n' + logo + '\n');
  console.log(bold(white('Volt-fast')) + dim(white(` v${version ?? 'unknown'}`)));
  console.log(dim(white(`${subtitle}\n`)));
}

function handlePromptCancel(
  value: unknown
): asserts value is NonNullable<unknown> {
  if (isCancel(value)) {
    cancel('Operation cancelled.');
    process.exit(0);
  }
}

// M-4: Spinner with elapsed time so users see activity during 30-90s installs
async function runCommand(
  pm: string,
  command: string,
  args: string[],
  cwd: string,
  messages: [string, string, string],
  dryRun: boolean = false
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

  if (dryRun) {
    consola.info(`[dry-run] Would run: ${pm} ${displayCommand} ${args.join(' ')}`);
    return;
  }

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

const createConfigFiles =
  (
    enabledTools: string[],
    detectedTools: string[],
    projectDir: string,
    settings: GeneratorSettings,
    packageManager: string,
    dryRun: boolean
  ) =>
  async (label: string, generator: GeneratorFunction): Promise<void> => {
    await writeConfigFiles(
      label,
      generator,
      enabledTools,
      detectedTools,
      projectDir,
      settings,
      packageManager,
      dryRun
    );
  };

async function writeConfigFiles(
  label: string,
  generator: GeneratorFunction,
  enabledTools: string[],
  detectedTools: string[],
  projectDir: string,
  settings: GeneratorSettings,
  packageManager: string,
  dryRun: boolean = false
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
    if (dryRun) {
      spinner.text = `[dry-run] Would write ${bold(filename)}`;
      consola.info(
        `[dry-run] ${filePath}:\n${content.slice(0, 200)}${content.length > 200 ? '...' : ''}`
      );
    } else {
      fs.outputFileSync(filePath, content, 'utf-8');
      spinner.text = `Writing ${bold(filename)}`;
    }
  }
  spinner.succeed(dryRun ? `[dry-run] Would add ${label}` : `Added ${label}`);
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

async function promptFilenameConvention(): Promise<
  FilenameConvention | symbol
> {
  return await select({
    message: 'Filename naming convention?',
    options: [
      {
        value: 'KEBAB_CASE',
        label: 'kebab-case',
        hint: 'default — e.g. my-component.tsx',
      },
      {
        value: 'PASCAL_CASE',
        label: 'PascalCase',
        hint: 'e.g. MyComponent.tsx',
      },
      {
        value: 'CAMEL_CASE',
        label: 'camelCase',
        hint: 'e.g. myComponent.tsx',
      },
      {
        value: 'SNAKE_CASE',
        label: 'snake_case',
        hint: 'e.g. my_component.tsx',
      },
    ],
    initialValue: 'KEBAB_CASE',
  });
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
    return './src/index.css';
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
  let testRunner: 'vitest' | 'jest' | 'cypress' | null = null;

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
          { value: 'vitest', label: 'Vitest', hint: 'unit / component — fast, ESM-native' },
          { value: 'jest', label: 'Jest', hint: 'unit / component — battle-tested' },
          { value: 'cypress', label: 'Cypress', hint: 'E2E (Next.js) or component testing (Vite)' },
        ],
      });
      handlePromptCancel(testRunnerResult);
      testRunner = testRunnerResult as 'vitest' | 'jest' | 'cypress';
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

// ---------------------------------------------------------------------------
// Default HuskySettings used in --yes / non-interactive mode
// ---------------------------------------------------------------------------
const DEFAULT_HUSKY_SETTINGS: HuskySettings = {
  enablePreCommit: true,
  enablePrePush: false,
  runFormatOnCommit: false,
  runTestsOnCommit: false,
  runBuildOnPush: false,
  testRunner: null,
};

const VALID_TOOLS = [
  'tailwind',
  'eslint',
  'prettier',
  'husky',
  'commitlint',
  'shadcn',
] as const;

const setupCommand = new Command('setup')
  .description('Pull in all the dependencies and configuration files you need')
  .argument('[projectdir]', 'Root directory where the project is located')
  // M-2: Non-interactive / CI flags
  .option('--yes', 'Skip all prompts and use defaults (non-interactive / CI mode)')
  .option(
    '--tools <tools>',
    `Comma-separated list of tools to enable — use with --yes.\n  Valid values: ${VALID_TOOLS.join(', ')}`
  )
  .option('--dry-run', 'Preview what would be written without making any changes')
  // H-5: Top-level try-catch so unexpected errors show a user-friendly message
  .action(async (projectdir?: string, options?: { yes?: boolean; tools?: string; dryRun?: boolean }) => {
    try {
      const yes: boolean = options?.yes ?? false;
      const dryRun: boolean = options?.dryRun ?? false;

      printBanner(`Let's set up your project!`);

      if (dryRun) {
        consola.info('[dry-run] No files will be written or commands executed.\n');
      }

      // --- Resolve target directory ---
      let targetDir: string;
      if (yes && projectdir) {
        targetDir = projectdir;
        const check = validateDirectory(targetDir);
        if (check !== true) {
          consola.error(check);
          process.exit(1);
        }
      } else {
        const targetDirResult = await promptProjectDirectory({ projectdir });
        handlePromptCancel(targetDirResult);
        targetDir = targetDirResult as string;
      }
      const resolvedDir: string = path.resolve(targetDir);

      // --- Confirm override (skipped in --yes / --dry-run mode) ---
      if (!yes && !dryRun) {
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
      }

      // --- Select tools ---
      let selectedTools: string[];
      if (yes && options?.tools) {
        selectedTools = options.tools
          .split(',')
          .map((t) => t.trim())
          .filter((t) => (VALID_TOOLS as readonly string[]).includes(t));
        if (selectedTools.length === 0) {
          consola.error(
            `No valid tools specified. Valid values: ${VALID_TOOLS.join(', ')}`
          );
          process.exit(1);
        }
      } else if (yes) {
        // Default to all tools when --yes given without --tools
        selectedTools = [...VALID_TOOLS];
      } else {
        const selectedToolsResult = await promptTools();
        handlePromptCancel(selectedToolsResult);
        selectedTools = selectedToolsResult as string[];
      }

      const detected: string[] = await detectProjectTools(resolvedDir);

      // --- Filename convention ---
      let filenameConvention: FilenameConvention | null = null;
      if (selectedTools.includes('eslint')) {
        if (yes) {
          filenameConvention = 'KEBAB_CASE';
        } else {
          const filenameConventionResult = await promptFilenameConvention();
          handlePromptCancel(filenameConventionResult);
          filenameConvention = filenameConventionResult as FilenameConvention;
        }
      }

      // --- Husky settings ---
      let huskySettings: HuskySettings | null = null;
      if (selectedTools.includes('husky')) {
        huskySettings = yes
          ? DEFAULT_HUSKY_SETTINGS
          : await promptHuskySettings();
      }

      if (
        huskySettings?.runFormatOnCommit &&
        !selectedTools.includes('prettier')
      ) {
        selectedTools.push('prettier');
      }

      // --- Tailwind CSS path ---
      let tailwindSettings: { cssPath: string | null } | null = null;
      if (selectedTools.includes('tailwind')) {
        if (yes) {
          tailwindSettings = { cssPath: null }; // will use detected default
        } else {
          tailwindSettings = await promptTailwindCSSFile({
            projectDir: resolvedDir,
            detectedTools: detected,
          });
        }
      }

      // --- Custom hooks ---
      let includeHooks = false;
      if (!yes) {
        const includeHooksResult = await promptCustomHooks();
        handlePromptCancel(includeHooksResult);
        includeHooks = includeHooksResult as boolean;
      }

      const packageManager: string = await detectPackageManager(
        targetDir ?? '.'
      );

      // --- Build dependency list ---
      const extraDeps: string[] = [];
      if (huskySettings?.runTestsOnCommit && huskySettings.testRunner) {
        const testFramework: TestFramework = detected.includes('nextjs')
          ? 'nextjs'
          : detected.includes('vite')
            ? 'vite'
            : 'generic';
        extraDeps.push(
          ...calculateTestDependencies(
            testFramework,
            huskySettings.testRunner,
            detected.includes('typescript')
          )
        );
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
        packageManager,
        dryRun
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
          ],
          dryRun
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
        if (huskySettings?.runTestsOnCommit && huskySettings.testRunner) {
          // Add the full set of test scripts (test, test:run/test:watch, test:coverage)
          Object.assign(scriptsToEnsure, testScripts(huskySettings.testRunner));
        }
        if (Object.keys(scriptsToEnsure).length > 0 && !dryRun) {
          await ensurePackageScripts(resolvedDir, scriptsToEnsure);
        }

        // C-2: Init husky FIRST so the hook infrastructure exists before we write files
        if (!dryRun) {
          await configureHusky(resolvedDir, packageManager);
        }
        await createFiles('Husky', generateHuskyConfig);

        // Scaffold the full test runner config if the user opted into tests during
        // husky setup and no config already exists.
        if (huskySettings?.runTestsOnCommit && huskySettings.testRunner) {
          const testFramework: TestFramework = detected.includes('nextjs')
            ? 'nextjs'
            : detected.includes('vite')
              ? 'vite'
              : 'generic';
          const testFiles = await generateTestConfig({
            framework: testFramework,
            runner: huskySettings.testRunner,
            hasTs: detected.includes('typescript'),
            projectDir: resolvedDir,
          });
          for (const [filename, content] of testFiles) {
            const filePath = path.resolve(resolvedDir, filename);
            if (dryRun) {
              consola.info(`[dry-run] Would write ${bold(filename)}`);
            } else {
              fs.outputFileSync(filePath, content, 'utf-8');
              consola.success(`Written ${bold(filename)}`);
            }
          }
        }
      }
      if (includeHooks && !dryRun) {
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

          if (!dryRun) {
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
          } else {
            consola.info(
              `[dry-run] Would patch tsconfig paths (alias: @/* → ${aliasTarget}) and run: npx shadcn@latest init`
            );
          }
        } catch (error) {
          consola.error(
            'Failed to initialize Shadcn UI. You may need to run it manually: npx shadcn@latest init'
          );
          if (error instanceof Error) {
            console.error(error.message);
          }
        }
      }

      if (dryRun) {
        consola.success('[dry-run] Preview complete. No files were written.');
      } else {
        consola.log(
          `\u{1F973} Done! You just saved ${bgMagenta(black('a few minutes'))} in your day. Enjoy the little things in life. \u2728`
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        consola.error(`Setup failed: ${error.message}`);
      } else {
        consola.error('Setup failed with an unexpected error.');
      }
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// `volt-fast test [projectdir]`
// Scaffolds a test runner (Vitest or Jest) following the official guides:
//   Next.js + Vitest → https://nextjs.org/docs/app/guides/testing/vitest
//   Next.js + Jest   → https://nextjs.org/docs/app/guides/testing/jest
//   Vite + Vitest    → https://vitest.dev/guide/
// ---------------------------------------------------------------------------
const testCommand = new Command('test')
  .description('Add a test runner (Vitest or Jest) to an existing project')
  .argument('[projectdir]', 'Root directory of the target project')
  .option('--yes', 'Skip prompts — auto-detect framework and use Vitest')
  .option('--dry-run', 'Preview files that would be written without making changes')
  .action(async (projectdir?: string, options?: { yes?: boolean; dryRun?: boolean }) => {
    try {
      const yes: boolean = options?.yes ?? false;
      const dryRun: boolean = options?.dryRun ?? false;

      printBanner(`Let's add a test runner to your project!`);

      if (dryRun) {
        consola.info('[dry-run] No files will be written or commands executed.\n');
      }

      // --- Resolve target directory ---
      let targetDir: string;
      if (yes && projectdir) {
        targetDir = projectdir;
        const check = validateDirectory(targetDir);
        if (check !== true) {
          consola.error(check);
          process.exit(1);
        }
      } else {
        const targetDirResult = await promptProjectDirectory({ projectdir });
        handlePromptCancel(targetDirResult);
        targetDir = targetDirResult as string;
      }
      const resolvedDir = path.resolve(targetDir);

      // --- Detect project tools ---
      const detected = await detectProjectTools(resolvedDir);
      const hasTs = detected.includes('typescript');

      // --- Auto-detect framework ---
      let framework: TestFramework;
      if (detected.includes('nextjs')) {
        framework = 'nextjs';
        consola.info(`Detected framework: ${bold('Next.js')}`);
      } else if (detected.includes('vite')) {
        framework = 'vite';
        consola.info(`Detected framework: ${bold('Vite')}`);
      } else {
        framework = 'generic';
        consola.info(`No Next.js or Vite config detected — using generic setup.`);
      }

      // --- Select test runner ---
      let runner: TestRunner;
      if (yes) {
        runner = 'vitest';
        consola.info(`Using default runner: ${bold('Vitest')}`);
      } else {
        const runnerResult = await select({
          message: 'Which test runner would you like to use?',
          options: [
            {
              value: 'vitest',
              label: 'Vitest',
              hint: 'recommended — fast, ESM-native, unit/component',
            },
            {
              value: 'jest',
              label: 'Jest',
              hint: 'battle-tested, large ecosystem, unit/component',
            },
            {
              value: 'cypress',
              label: 'Cypress',
              hint: 'E2E (Next.js) or component testing (Vite)',
            },
          ],
          initialValue: 'vitest',
        });
        handlePromptCancel(runnerResult);
        runner = runnerResult as TestRunner;
      }

      const packageManager = await detectPackageManager(targetDir ?? '.');

      // --- Show what will be installed ---
      const deps = calculateTestDependencies(framework, runner, hasTs);
      const scripts = testScripts(runner);

      consola.info(
        boxen(
          `Framework : ${framework}\nRunner    : ${runner}\nTypeScript: ${hasTs ? 'yes' : 'no'}\nDeps      : ${deps.join(', ')}\nScripts   : ${Object.entries(scripts).map(([k, v]) => `${k}="${v}"`).join(', ')}`,
          {
            title: 'Test setup summary',
            borderStyle: 'round',
            borderColor: 'cyan',
            padding: 1,
            margin: 1,
          }
        )
      );

      if (!yes && !dryRun) {
        const proceed = await confirm({ message: 'Continue?' });
        handlePromptCancel(proceed);
        if (!proceed) {
          consola.info('Operation cancelled.');
          process.exit(0);
        }
      }

      // --- Install dependencies ---
      if (deps.length > 0) {
        await runCommand(
          packageManager,
          'add',
          ['-D', ...deps],
          resolvedDir,
          [
            'Installing test dependencies',
            'Test dependencies installed',
            'Skipped installation. Run the above command manually.',
          ],
          dryRun
        );
      }

      // --- Generate config files ---
      const files = await generateTestConfig({ framework, runner, hasTs, projectDir: resolvedDir });

      for (const [filename, content] of files) {
        const filePath = path.resolve(resolvedDir, filename);
        if (dryRun) {
          consola.info(
            `[dry-run] Would write ${bold(filename)}:\n${content.slice(0, 300)}${content.length > 300 ? '...' : ''}`
          );
        } else {
          fs.outputFileSync(filePath, content, 'utf-8');
          consola.success(`Written ${bold(filename)}`);
        }
      }

      // --- Update package.json scripts ---
      if (!dryRun) {
        await ensurePackageScripts(resolvedDir, scripts);
      } else {
        consola.info(
          `[dry-run] Would add scripts: ${Object.entries(scripts).map(([k, v]) => `"${k}": "${v}"`).join(', ')}`
        );
      }

      if (dryRun) {
        consola.success('[dry-run] Preview complete. No files were written.');
      } else {
        consola.success(
          `Test runner configured! Run ${bold(`${packageManager} ${runner === 'vitest' ? 'test:run' : 'test'}`)} to execute your tests.`
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        consola.error(`Test setup failed: ${error.message}`);
      } else {
        consola.error('Test setup failed with an unexpected error.');
      }
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// `volt-fast fix-filenames [projectdir]`
// Scans a project for source files, renames them to match a chosen
// FilenameConvention, and rewrites imports/requires that reference them.
// ---------------------------------------------------------------------------
const CONVENTION_ALIASES: Record<string, FilenameConvention> = {
  'kebab-case': 'KEBAB_CASE',
  kebab: 'KEBAB_CASE',
  pascalcase: 'PASCAL_CASE',
  'pascal-case': 'PASCAL_CASE',
  pascal: 'PASCAL_CASE',
  camelcase: 'CAMEL_CASE',
  'camel-case': 'CAMEL_CASE',
  camel: 'CAMEL_CASE',
  'snake-case': 'SNAKE_CASE',
  snake: 'SNAKE_CASE',
};

function resolveConvention(input: string): FilenameConvention | null {
  const normalized = input.toLowerCase().replace(/_/g, '-');
  return CONVENTION_ALIASES[normalized] ?? null;
}

const fixFilenamesCommand = new Command('fix-filenames')
  .description('Rename source files to match a naming convention and update imports')
  .argument('[projectdir]', 'Root directory of the target project')
  .option(
    '--convention <convention>',
    'Naming convention: kebab-case, PascalCase, camelCase, or snake_case'
  )
  .option('--include <extensions>', 'Comma-separated file extensions to scan (default: ts,tsx,js,jsx,css,scss)')
  .option('--yes', 'Skip prompts — use --convention (default kebab-case) and skip the confirmation')
  .option('--dry-run', 'Preview renames and import rewrites without touching disk')
  .action(
    async (
      projectdir?: string,
      options?: { convention?: string; include?: string; yes?: boolean; dryRun?: boolean }
    ) => {
      try {
        const yes: boolean = options?.yes ?? false;
        const dryRun: boolean = options?.dryRun ?? false;

        printBanner('Renaming files to match your naming convention...');

        if (dryRun) {
          consola.info('[dry-run] No files will be changed.\n');
        }

        // --- Resolve target directory ---
        let targetDir: string;
        if (yes && projectdir) {
          targetDir = projectdir;
          const check = validateDirectory(targetDir);
          if (check !== true) {
            consola.error(check);
            process.exit(1);
          }
        } else {
          const targetDirResult = await promptProjectDirectory({ projectdir });
          handlePromptCancel(targetDirResult);
          targetDir = targetDirResult as string;
        }
        const resolvedDir = path.resolve(targetDir);

        // --- Resolve convention ---
        let convention: FilenameConvention;
        if (options?.convention) {
          const resolved = resolveConvention(options.convention);
          if (!resolved) {
            consola.error(
              `Unknown convention "${options.convention}". Use kebab-case, PascalCase, camelCase, or snake_case.`
            );
            process.exit(1);
          }
          convention = resolved as FilenameConvention;
        } else if (yes) {
          convention = 'KEBAB_CASE';
        } else {
          const conventionResult = await promptFilenameConvention();
          handlePromptCancel(conventionResult);
          convention = conventionResult as FilenameConvention;
        }

        // --- Resolve extensions ---
        const extensions = options?.include
          ? options.include.split(',').map((ext) => ext.trim()).filter(Boolean)
          : DEFAULT_SOURCE_EXTENSIONS;

        // --- Scan + compute plan ---
        consola.info(`Scanning ${bold(resolvedDir)} for source files (respecting .gitignore)...`);
        const files = await walkSourceFiles(resolvedDir, extensions);
        const plan = computeRenamePlan(files, convention);

        consola.info(
          `Found ${files.length} candidate file(s) (${plan.unchanged.length} already conform).`
        );

        if (plan.renames.length === 0 && plan.conflicts.length === 0) {
          consola.success('Nothing to rename — every file already matches the convention.');
          return;
        }

        if (plan.renames.length > 0) {
          consola.info(
            boxen(plan.renames.map((r) => `${r.from}  ->  ${r.to}`).join('\n'), {
              title: `Renames (${plan.renames.length})`,
              borderStyle: 'round',
              borderColor: 'cyan',
              padding: 1,
              margin: 1,
            })
          );
        }

        if (plan.conflicts.length > 0) {
          consola.warn(
            boxen(
              plan.conflicts
                .map((c) => `${c.sources.join(', ')}  ->  ${c.targetPath}`)
                .join('\n'),
              {
                title: `Conflicts (${plan.conflicts.length}) — skipped, not renamed`,
                borderStyle: 'round',
                borderColor: 'yellow',
                padding: 1,
                margin: 1,
              }
            )
          );
        }

        if (dryRun) {
          consola.success('[dry-run] No files were changed.');
          return;
        }

        if (!yes) {
          const proceed = await confirm({
            message: `Apply ${plan.renames.length} rename(s) and update imports?`,
          });
          handlePromptCancel(proceed);
          if (!proceed) {
            consola.info('Operation cancelled.');
            process.exit(0);
          }
        }

        const result = await applyRenamePlan(resolvedDir, files, plan.renames, { dryRun: false });

        if (!result.usedTsconfig) {
          consola.warn(
            'No tsconfig.json found — path-alias imports (e.g. "@/...") cannot be rewritten, only relative imports.'
          );
        }

        const importsUpdated = new Set(result.applied.flatMap((r) => r.referencesUpdated)).size;
        consola.success(
          `Done. Renamed ${plan.renames.length} file(s), updated imports in ${importsUpdated} file(s).${plan.conflicts.length > 0 ? ` Skipped ${plan.conflicts.length} conflict(s) — see above.` : ''}`
        );

        if (result.skippedNoRewrite.length > 0) {
          consola.info(
            `Renamed without import rewriting (no import concept for these file types): ${result.skippedNoRewrite.map((r) => r.to).join(', ')}`
          );
        }

        if (result.manualCheckNeeded.length > 0) {
          consola.warn(
            boxen(result.manualCheckNeeded.join('\n'), {
              title: 'Manual check needed',
              borderStyle: 'round',
              borderColor: 'yellow',
              padding: 1,
              margin: 1,
            })
          );
        }
      } catch (error) {
        if (error instanceof Error) {
          consola.error(`fix-filenames failed: ${error.message}`);
        } else {
          consola.error('fix-filenames failed with an unexpected error.');
        }
        process.exit(1);
      }
    }
  );

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
  program.addCommand(testCommand);
  program.addCommand(fixFilenamesCommand);
  program.parse();
}

main();
