#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'node:module';
import { z } from 'zod';
import {
  generateCommitlintConfig,
  generateEslintConfig,
  generateHuskyConfig,
  generatePrettierConfig,
  generateTailwindConfig,
  generateTestConfig,
} from './src/generators/index.js';
import type { GeneratorOptions, HuskySettings } from './src/generators/types.js';
import { calculateDependencies } from './src/utils/calculate-deps.js';
import { detectPackageManager, detectProjectTools } from './src/utils/detect-project.js';
import {
  calculateTestDependencies,
  testScripts,
  type TestFramework,
  type TestRunner,
} from './src/utils/test-deps.js';

const _req = createRequire(import.meta.url);
const { version } = _req('../package.json') as { version: string };

function buildInstallCommand(pm: string, packages: string[]): string {
  if (packages.length === 0) return '';
  const subCmd = pm === 'npm' ? 'install' : 'add';
  return `${pm} ${subCmd} -D ${packages.join(' ')}`;
}

const server = new McpServer({
  name: 'volt-fast',
  version,
  title: 'volt-fast',
  description:
    'Scaffolds frontend projects with zero interaction. Use volt-fast to generate config files and install commands for ESLint, Prettier, Tailwind CSS, Husky git hooks, Commitlint, and test runners (Vitest, Jest, Cypress). ' +
    'Tools: • detect_project — inspect a directory to identify its framework, package manager, and TypeScript usage. ' +
    '• plan_setup — generate all config file contents and the exact install command for any combination of tools. ' +
    '• plan_test_setup — generate test runner configs, package.json scripts, and the install command for Vitest, Jest, or Cypress. ' +
    'All tools are advisory: they return file contents and commands for you to apply — nothing is written to disk.',
  websiteUrl: 'https://voltfast.dev',
  icons: [
    {
      src: 'https://voltfast.dev/favicon.ico',
      mimeType: 'image/x-icon',
    },
  ],
});

// ─── Tool 1: detect_project ────────────────────────────────────────────────

server.registerTool(
  'detect_project',
  {
    description: 'Detects the framework, package manager, and installed toolchain for a given project directory. Call this first before plan_setup or plan_test_setup to get accurate auto-detection.',
    inputSchema: {
      projectDir: z
        .string()
        .describe('Absolute path to the project directory to inspect'),
    },
  },
  async ({ projectDir }) => {
    const [detectedTools, packageManager] = await Promise.all([
      detectProjectTools(projectDir),
      detectPackageManager(projectDir),
    ]);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              packageManager,
              detectedTools,
              hasTypeScript: detectedTools.includes('typescript'),
              hasNextjs: detectedTools.includes('nextjs'),
              hasVite: detectedTools.includes('vite'),
              hasTailwind: detectedTools.includes('tailwind'),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Tool 2: plan_setup ────────────────────────────────────────────────────

const huskySettingsSchema = z.object({
  enablePreCommit: z.boolean().default(true),
  enablePrePush: z.boolean().default(false),
  runFormatOnCommit: z.boolean().default(false),
  runTestsOnCommit: z.boolean().default(false),
  runBuildOnPush: z.boolean().default(false),
  testRunner: z.enum(['vitest', 'jest', 'cypress']).nullable().default(null),
});

server.registerTool(
  'plan_setup',
  {
    description: 'Generates an advisory scaffolding plan for a frontend project. Returns all config file contents and the exact install command. The agent is responsible for writing the files and running the install. This tool never writes to disk.',
    inputSchema: {
      tools: z
        .array(z.enum(['tailwind', 'eslint', 'prettier', 'husky', 'commitlint', 'shadcn']))
        .min(1)
        .describe("Tools to configure. Valid values: 'tailwind', 'eslint', 'prettier', 'husky', 'commitlint', 'shadcn'"),
      projectDir: z
        .string()
        .optional()
        .describe(
          'Absolute path to the project directory. When provided, framework and package manager are auto-detected. Use detect_project first if you need to inspect the project before planning.'
        ),
      detectedTools: z
        .array(z.string())
        .optional()
        .describe(
          "Override auto-detected tools. Valid values: 'nextjs', 'vite', 'typescript', 'tailwind'. Takes precedence over projectDir detection."
        ),
      packageManager: z
        .enum(['npm', 'yarn', 'pnpm', 'bun'])
        .optional()
        .default('npm')
        .describe('Package manager to use in the install command. Auto-detected when projectDir is provided.'),
      settings: z
        .object({
          filenameConvention: z
            .enum(['KEBAB_CASE', 'PASCAL_CASE', 'CAMEL_CASE', 'SNAKE_CASE'])
            .optional()
            .describe('ESLint filename convention rule (default: KEBAB_CASE)'),
          tailwindCssPath: z
            .string()
            .optional()
            .describe("Path to the Tailwind CSS entry file, e.g. './src/app/globals.css'"),
          huskySettings: huskySettingsSchema.optional(),
        })
        .optional(),
    },
  },
  async ({ tools, projectDir, detectedTools: inputDetectedTools, packageManager: inputPm, settings }) => {
    let detected: string[] = inputDetectedTools ?? [];
    let pm: string = inputPm ?? 'npm';

    if (projectDir && !inputDetectedTools) {
      [detected, pm] = await Promise.all([
        detectProjectTools(projectDir),
        detectPackageManager(projectDir),
      ]);
    }

    const packages = [...new Set(calculateDependencies(tools, detected))];
    const notes: string[] = [];

    const huskyInput = settings?.huskySettings;
    const resolvedHusky: HuskySettings | undefined = huskyInput
      ? {
          enablePreCommit: huskyInput.enablePreCommit,
          enablePrePush: huskyInput.enablePrePush,
          runFormatOnCommit: huskyInput.runFormatOnCommit,
          runTestsOnCommit: huskyInput.runTestsOnCommit,
          runBuildOnPush: huskyInput.runBuildOnPush,
          testRunner: huskyInput.testRunner,
        }
      : undefined;

    const genOptions: GeneratorOptions = {
      enabledTools: tools,
      detectedTools: detected,
      settings: {
        tailwind: settings?.tailwindCssPath ? { cssPath: settings.tailwindCssPath } : undefined,
        husky: resolvedHusky,
        filenameConvention: settings?.filenameConvention,
      },
      packageManager: pm,
      projectDir: projectDir ?? process.cwd(),
    };

    const generatorResults = await Promise.all([
      tools.includes('tailwind') ? generateTailwindConfig(genOptions) : Promise.resolve([] as [string, string][]),
      tools.includes('eslint') ? generateEslintConfig(genOptions) : Promise.resolve([] as [string, string][]),
      tools.includes('prettier') ? generatePrettierConfig(genOptions) : Promise.resolve([] as [string, string][]),
      tools.includes('husky') ? generateHuskyConfig(genOptions) : Promise.resolve([] as [string, string][]),
      tools.includes('commitlint') ? generateCommitlintConfig(genOptions) : Promise.resolve([] as [string, string][]),
    ]);

    if (tools.includes('shadcn')) {
      notes.push(
        'shadcn requires running an interactive CLI: npx shadcn@latest init (run inside the project directory)'
      );
    }

    if (tools.includes('husky')) {
      notes.push(
        'husky requires initialising git hooks before writing hook files: run `npx husky init` inside the project directory first, then write the .husky/ hook files from the configs above'
      );
    }

    const configs = generatorResults
      .flat()
      .map(([filePath, content]) => ({ path: filePath, content }));

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              packageManager: pm,
              detectedTools: detected,
              packages,
              installCommand: buildInstallCommand(pm, packages),
              configs,
              notes,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Tool 3: plan_test_setup ───────────────────────────────────────────────

server.registerTool(
  'plan_test_setup',
  {
    description: 'Generates an advisory plan for scaffolding a test runner (Vitest, Jest, or Cypress). Returns config file contents, the install command, and package.json scripts to add. The agent is responsible for writing files and running installs. This tool never writes to disk.',
    inputSchema: {
      projectDir: z
        .string()
        .describe(
          'Absolute path to the project directory. The framework and package manager are auto-detected from config files in this directory.'
        ),
      framework: z
        .enum(['nextjs', 'vite', 'generic'])
        .optional()
        .describe("Target framework. Auto-detected from projectDir when omitted. Falls back to 'generic'."),
      packageManager: z
        .enum(['npm', 'yarn', 'pnpm', 'bun'])
        .optional()
        .default('npm')
        .describe('Package manager to use in the install command. Auto-detected from projectDir when not provided.'),
      runner: z
        .enum(['vitest', 'jest', 'cypress'])
        .default('vitest')
        .describe('Test runner to scaffold (default: vitest)'),
      hasTs: z.boolean().default(true).describe('Whether the project uses TypeScript (default: true)'),
    },
  },
  async ({ projectDir, framework: inputFramework, packageManager: inputPm, runner, hasTs }) => {
    let framework: TestFramework = inputFramework ?? 'generic';
    let pm: string = inputPm ?? 'npm';

    const [detected, detectedPm] = await Promise.all([
      detectProjectTools(projectDir),
      detectPackageManager(projectDir),
    ]);
    if (!inputPm) pm = detectedPm;
    if (!inputFramework) {
      framework = detected.includes('nextjs') ? 'nextjs' : detected.includes('vite') ? 'vite' : 'generic';
    }

    const packages = calculateTestDependencies(framework, runner as TestRunner, hasTs);
    const scripts = testScripts(runner as TestRunner);
    const configs = await generateTestConfig({
      framework,
      runner: runner as TestRunner,
      hasTs,
      projectDir,
    });

    const notes: string[] = [];
    if (configs.length === 0) {
      notes.push(
        `A ${runner} config already exists in the project directory. Remove the existing config file before running plan_test_setup again to regenerate it.`
      );
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              framework,
              runner,
              packageManager: pm,
              packages,
              installCommand: buildInstallCommand(pm, packages),
              scripts,
              configs: configs.map(([filePath, content]) => ({ path: filePath, content })),
              notes,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Start server ──────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
