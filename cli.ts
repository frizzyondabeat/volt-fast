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
} from './src/generators/index.js';
import type {
  FilenameConvention,
  GeneratorFunction,
  GeneratorSettings,
  HuskySettings,
} from './src/generators/types.js';
import { calculateDependencies } from './src/utils/calculate-deps.js';
import { detectPackageManager, detectProjectTools } from './src/utils/detect-project.js';

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
      console.log('\n' + logo + '\n');
      const { version } = loadPkg();
      console.log(bold(white('Volt-fast')) + dim(white(` v${version ?? 'unknown'}`)));
      console.log(dim(white(`Let's set up your project!\n`)));

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
        if (huskySettings?.runTestsOnCommit) {
          scriptsToEnsure['test'] =
            huskySettings.testRunner === 'vitest' ? 'vitest' : 'jest';
        }
        if (Object.keys(scriptsToEnsure).length > 0 && !dryRun) {
          await ensurePackageScripts(resolvedDir, scriptsToEnsure);
        }

        // C-2: Init husky FIRST so the hook infrastructure exists before we write files
        if (!dryRun) {
          await configureHusky(resolvedDir, packageManager);
        }
        await createFiles('Husky', generateHuskyConfig);
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
