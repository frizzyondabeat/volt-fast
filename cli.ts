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
    deps.push('tailwindcss', 'postcss', 'autoprefixer');
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
    'tailwind.config.cjs',
    await formatCode(`
      /** @type {import('tailwindcss').Config} */
      export default {
        content: [],
        theme: {
          extend: {},
        },
        plugins: [],
      }
    `),
  ]);
  results.push([
    'postcss.config.cjs',
    await formatCode(`
      module.exports = {
        plugins: {
          tailwindcss: {},
          autoprefixer: {},
        }
      }
    `),
  ]);
  const cssPath: string =
    options.settings?.tailwind?.cssPath || './src/styles.css';
  results.push([
    cssPath,
    await formatCode(
      `
      @tailwind base;
      @tailwind components;
      @tailwind utilities;
    `,
      'css'
    ),
  ]);
  return results;
}

async function promptTailwindCSSFile(): Promise<{ cssPath: string | null }> {
  const writeCSSResult = await confirm({ message: 'Write Tailwind CSS file?' });
  handlePromptCancel(writeCSSResult);
  const writeCSS: boolean = writeCSSResult as boolean;

  let cssPath: string | null = null;
  if (writeCSS) {
    const cssPathResult = await text({
      message: 'Where would you like to write the Tailwind CSS file?',
      initialValue: './src/styles.css',
    });
    handlePromptCancel(cssPathResult);
    cssPath = cssPathResult as string;
  }
  return { cssPath };
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
.eslintrc.cjs, prettier.config.cjs, tailwind.config.cjs, ./src/styles.css

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

    const tailwindSettings = selectedTools.includes('tailwind')
      ? await promptTailwindCSSFile()
      : null;

    const includeHooksResult = await promptCustomHooks();
    handlePromptCancel(includeHooksResult);
    const includeHooks: boolean = includeHooksResult as boolean;
    const detected: string[] = await detectProjectTools(resolvedDir);
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

    if (selectedTools.includes('tailwind')) {
      await createFiles('Tailwind', generateTailwindConfig);
    }
    if (selectedTools.includes('prettier')) {
      await createFiles('Prettier', generatePrettierConfig);
    }
    if (selectedTools.includes('eslint')) {
      await createFiles('ESLint', generateEslintConfig);
    }
    if (includeHooks) {
      await copyCustomHooks(resolvedDir);
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
