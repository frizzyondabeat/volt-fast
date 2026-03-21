#!/usr/bin/env node

import fs from 'fs-extra';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { detect as detectPM } from '@antfu/ni';
import { confirm, text, multiselect, isCancel, cancel } from '@clack/prompts';
import boxen from 'boxen';
import consola from 'consola';
import { execa } from 'execa';
import ora from 'ora';
import { bold, underline, bgMagenta, black } from 'colorette';
import prettier from 'prettier';
import { Command } from 'commander';
import { retro } from 'gradient-string';
import stripJsonComments from 'strip-json-comments';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = fs.readJSONSync(path.join(__dirname, '../package.json'));

function handlePromptCancel(
  value: unknown
): asserts value is NonNullable<unknown> {
  if (isCancel(value)) {
    cancel('Operation cancelled.');
    process.exit(0);
  }
}

async function detectProjectTools(dir: string): Promise<string[]> {
  const tools: string[] = [];
  const [hasNextConfigJs, hasNextConfigMjs, hasNextConfigCjs, hasNextConfigTs] =
    await Promise.all([
      fs.pathExists(`${dir}/next.config.js`),
      fs.pathExists(`${dir}/next.config.mjs`),
      fs.pathExists(`${dir}/next.config.cjs`),
      fs.pathExists(`${dir}/next.config.ts`),
    ]);
  if (
    [hasNextConfigJs, hasNextConfigMjs, hasNextConfigCjs, hasNextConfigTs].some(
      Boolean
    )
  ) {
    tools.push('nextjs');
  }

  const [hasViteConfigJs, hasViteConfigTs, hasViteConfigMjs] =
    await Promise.all([
      fs.pathExists(`${dir}/vite.config.js`),
      fs.pathExists(`${dir}/vite.config.ts`),
      fs.pathExists(`${dir}/vite.config.mjs`),
    ]);
  if ([hasViteConfigJs, hasViteConfigTs, hasViteConfigMjs].some(Boolean)) {
    tools.push('vite');
  }

  const hasTsConfig: boolean = await fs.pathExists(`${dir}/tsconfig.json`);
  if (hasTsConfig) {
    tools.push('typescript');
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
      title: 'CLI will run the following npm command:',
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
  consola.start(messages[0]);
  await execa(pm, [displayCommand, ...args], { cwd });
  consola.success(messages[1]);
}

type GeneratorOptions = {
  enabledTools: string[];
  detectedTools: string[];
  settings: any;
};

type GeneratorFunction = (
  options: GeneratorOptions
) => Promise<[string, string][]>;

const createConfigFiles =
  (
    enabledTools: string[],
    detectedTools: string[],
    projectDir: string,
    settings: any
  ) =>
  async (label: string, generator: GeneratorFunction): Promise<void> => {
    await writeConfigFiles(
      label,
      generator,
      enabledTools,
      detectedTools,
      projectDir,
      settings
    );
  };

async function writeConfigFiles(
  label: string,
  generator: GeneratorFunction,
  enabledTools: string[],
  detectedTools: string[],
  projectDir: string,
  settings: any
): Promise<void> {
  const spinner = ora(`Setting up ${label}`).start();
  const files: [string, string][] = await generator({
    enabledTools,
    detectedTools,
    settings,
  });
  for (const [filename, content] of files) {
    const filePath = path.resolve(projectDir, filename);
    fs.outputFileSync(filePath, content, 'utf-8');
    spinner.text = `Writing ${bold(filename)}`;
  }
  spinner.succeed(`Added ${label}`);
}

function calculateDependencies(
  selectedTools: string[],
  detectedTools: string[]
): string[] {
  const deps: string[] = [];
  if (selectedTools.includes('tailwind')) {
    deps.push('tailwindcss', 'postcss', '@tailwindcss/postcss');
  }
  if (selectedTools.includes('eslint')) {
    deps.push('eslint', 'eslint-plugin-react', 'eslint-plugin-react-hooks');
    if (detectedTools.includes('typescript')) {
      deps.push('@typescript-eslint/parser');
    }
    if (selectedTools.includes('prettier')) {
      deps.push('eslint-plugin-prettier');
    }
  }
  if (selectedTools.includes('prettier')) {
    deps.push('prettier', '@trivago/prettier-plugin-sort-imports');
    if (selectedTools.includes('tailwind')) {
      deps.push('prettier-plugin-tailwindcss');
    }
  }
  if (selectedTools.includes('husky')) {
    deps.push('husky');
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
      { value: 'tailwind', label: 'Tailwind' },
      { value: 'eslint', label: 'ESLint' },
      { value: 'prettier', label: 'Prettier' },
      { value: 'husky', label: 'Husky' },
      { value: 'shadcn', label: 'Shadcn UI' },
    ],
  });
}

async function promptCustomHooks(): Promise<boolean | symbol> {
  return await confirm({ message: 'Do you want to include custom hooks?' });
}

async function formatCode(
  code: string,
  parser: string = 'babel'
): Promise<string> {
  return await prettier.format(code, { parser });
}

async function generateEslintConfig(
  options: GeneratorOptions
): Promise<[string, string][]> {
  const { enabledTools, detectedTools } = options;
  const tsParser: string = detectedTools.includes('typescript')
    ? 'parser: "@typescript-eslint/parser",'
    : '';
  const extendsArr: string[] = [
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ];
  if (detectedTools.includes('nextjs')) {
    extendsArr.push('next/core-web-vitals');
  }
  if (detectedTools.includes('typescript')) {
    extendsArr.push('plugin:@typescript-eslint/recommended');
  }
  if (enabledTools.includes('prettier')) {
    extendsArr.push('plugin:prettier/recommended');
  }
  const configContent: string = await formatCode(`
    /** @type {import("eslint").Linter.Config} */
    const config = {
      ${tsParser}
      extends: [${extendsArr.map((item) => `"${item}"`).join(', ')}],
      parserOptions: {
        project: true,
      },
      settings: {
        react: {
          version: "detect"
        }
      }
    };

    module.exports = config;
  `);
  return [['.eslintrc.cjs', configContent]];
}

async function generatePrettierConfig(
  options: GeneratorOptions
): Promise<[string, string][]> {
  const { enabledTools } = options;
  const plugins: string[] = ['@trivago/prettier-plugin-sort-imports'];
  if (enabledTools.includes('tailwind')) {
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

    module.exports = config;
  `);
  return [['prettier.config.cjs', configContent]];
}

async function generateTailwindConfig(
  options: GeneratorOptions
): Promise<[string, string][]> {
  const results: [string, string][] = [];
  results.push([
    'postcss.config.cjs',
    await formatCode(`
      module.exports = {
        plugins: {
          "@tailwindcss/postcss": {},
        }
      }
    `),
  ]);
  const cssPath: string =
    options.settings?.tailwind?.cssPath ||
    getDefaultTailwindCssPath(options.detectedTools);
  results.push([
    cssPath,
    await formatCode(
      `
      @import "tailwindcss";
    `,
      'css'
    ),
  ]);
  return results;
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

async function generateHuskyConfig(): Promise<[string, string][]> {
  return [
    ['.husky/pre-commit', 'pnpm lint\npnpm format:fix\n'],
    ['.husky/pre-push', 'pnpm build\n'],
    ['.husky/commit-msg', 'pnpx commitlint --edit $1\n'],
  ];
}

async function configureHusky(projectDir: string): Promise<void> {
  try {
    await execa('git', ['config', 'core.hooksPath', '.husky'], {
      cwd: projectDir,
    });
    consola.success('Configured Git hooks path to .husky.');
  } catch {
    consola.warn(
      'Could not configure Git hooks path automatically. Run "git config core.hooksPath .husky" in your project.'
    );
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
  .action(async (projectdir?: string) => {
    const myArt = `
░       ░░░░      ░░░        ░░  ░░░░░░░░        ░░       ░░░       ░░░  ░░░░░░░░░      ░░░        ░░        ░
▒  ▒▒▒▒  ▒▒  ▒▒▒▒  ▒▒▒▒▒  ▒▒▒▒▒  ▒▒▒▒▒▒▒▒  ▒▒▒▒▒▒▒▒  ▒▒▒▒  ▒▒  ▒▒▒▒  ▒▒  ▒▒▒▒▒▒▒▒  ▒▒▒▒  ▒▒▒▒▒  ▒▒▒▒▒  ▒▒▒▒▒▒▒
▓       ▓▓▓  ▓▓▓▓  ▓▓▓▓▓  ▓▓▓▓▓  ▓▓▓▓▓▓▓▓      ▓▓▓▓       ▓▓▓       ▓▓▓  ▓▓▓▓▓▓▓▓  ▓▓▓▓  ▓▓▓▓▓  ▓▓▓▓▓      ▓▓▓
█  ████  ██  ████  █████  █████  ████████  ████████  ███  ███  ████████  ████████        █████  █████  ███████
█       ████      ███        ██        ██        ██  ████  ██  ████████        ██  ████  █████  █████        █
`;
    const art: string = retro.multiline(myArt);
    consola.log(art);
    consola.log(retro('Boilerplate CLI \u{1F913}'));
    consola.log(underline(`Let's set up your project!\n`));

    const targetDirResult = await promptProjectDirectory({ projectdir });
    handlePromptCancel(targetDirResult);
    const targetDir = targetDirResult as string;
    const resolvedDir: string = path.resolve(targetDir);

    const proceedWithOverride = await confirm({
      message: `Depending on which tools you enable, we will OVERRIDE these files with our own config:
.eslintrc.cjs, prettier.config.cjs, postcss.config.cjs, ./src/styles.css, .husky/pre-commit, .husky/pre-push, .husky/commit-msg

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

    const tailwindSettings = selectedTools.includes('tailwind')
      ? await promptTailwindCSSFile({
          projectDir: resolvedDir,
          detectedTools: detected,
        })
      : null;

    const includeHooksResult = await promptCustomHooks();
    handlePromptCancel(includeHooksResult);
    const includeHooks: boolean = includeHooksResult as boolean;
    const packageManager: string = await detectPackageManager(targetDir ?? '.');
    const dependencies: string[] = calculateDependencies(
      selectedTools,
      detected
    );
    const createFiles = createConfigFiles(
      selectedTools,
      detected,
      resolvedDir,
      { tailwind: tailwindSettings || {} }
    );

    if (dependencies.length > 0) {
      await runCommand(
        packageManager,
        'add',
        ['-D', ...dependencies],
        resolvedDir,
        [
          'Installing dependencies',
          'Installed dependencies',
          'Skipped installation. Please run the above command manually.',
        ]
      );
    }

    if (selectedTools.includes('tailwind')) {
      await createFiles('Tailwind', generateTailwindConfig);
    }
    if (selectedTools.includes('prettier')) {
      await createFiles('Prettier', generatePrettierConfig);
    }
    if (selectedTools.includes('eslint')) {
      await createFiles('ESLint', generateEslintConfig);
    }
    if (selectedTools.includes('husky')) {
      await createFiles('Husky', generateHuskyConfig);
      await configureHusky(resolvedDir);
    }
    if (includeHooks) {
      await copyCustomHooks(resolvedDir);
    }

    if (selectedTools.includes('shadcn')) {
      consola.start('Configuring import aliases for Shadcn UI...');
      try {
        const isVite = detected.includes('vite');
        const isNext = detected.includes('nextjs');

        // Shadcn UI CLI always checks tsconfig.json first
        const tsconfigPathsToUpdate = [path.join(resolvedDir, 'tsconfig.json')];

        // If it's Vite, also update tsconfig.app.json as that's where Vite expects it
        if (
          isVite &&
          fs.existsSync(path.join(resolvedDir, 'tsconfig.app.json'))
        ) {
          tsconfigPathsToUpdate.push(
            path.join(resolvedDir, 'tsconfig.app.json')
          );
        }

        for (const tsconfigPath of tsconfigPathsToUpdate) {
          if (fs.existsSync(tsconfigPath)) {
            const rawTsconfig = fs.readFileSync(tsconfigPath, 'utf-8');
            const tsconfig = JSON.parse(stripJsonComments(rawTsconfig));
            if (!tsconfig.compilerOptions) tsconfig.compilerOptions = {};

            tsconfig.compilerOptions.baseUrl = '.';
            tsconfig.compilerOptions.paths = {
              ...tsconfig.compilerOptions.paths,
              '@/*': ['./src/*'],
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

          let viteConfigPath = null;
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
                  'plugins: [',
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
  });

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

async function main(): Promise<void> {
  const program = new Command()
    .name(bold(pkg.name || '@frizzy/boilerplate-cli'))
    .description(pkg.description || 'Configure your frontend project with ease')
    .version(
      pkg.version || 'Unknown version',
      '-v, --version',
      'Output the current CLI version'
    );
  program.addCommand(setupCommand);
  program.parse();
}

main();
