# MCP Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 bugs identified in PR #1 (`feat/mcp` branch) that violate the generator contract, invert husky setup order, and cause `plan_test_setup` to silently return empty configs.

**Architecture:** All fixes are isolated changes — one touches `src/generators/tailwind.ts`, one touches the husky note string in `mcp-server.ts`, and two touch the `plan_test_setup` tool handler in `mcp-server.ts`. A single unit test file covers the tailwind fix.

**Tech Stack:** TypeScript, Vitest, `fs-extra` (mocked in tests), `@modelcontextprotocol/sdk`, Zod

---

## File Map

- Modify: `src/generators/tailwind.ts:52-70` — remove `fs.writeFile`, return vite.config patch as file pair
- Create: `tests/generators/tailwind.test.ts` — unit tests for Fix 1
- Modify: `mcp-server.ts:179-183` — fix husky note to say init BEFORE writing hook files
- Modify: `mcp-server.ts:213-286` — `plan_test_setup` schema and handler: make `projectDir` required, add `packageManager`, always detect PM when projectDir provided, remove `process.cwd()` fallback

---

### Task 1: Fix tailwind generator — return vite.config as file pair

**Files:**
- Modify: `src/generators/tailwind.ts:52-70`

- [ ] **Step 1: Replace the `fs.writeFile` block with a `results.push` call**

In `src/generators/tailwind.ts`, replace lines 64-67 with a `results.push`:

```typescript
    if (viteConfigPath) {
      let viteConfig = await fs.readFile(viteConfigPath, 'utf-8');
      if (!viteConfig.includes('@tailwindcss/vite')) {
        if (
          !viteConfig.includes("import tailwindcss from '@tailwindcss/vite'")
        ) {
          viteConfig = `import tailwindcss from '@tailwindcss/vite';\n${viteConfig}`;
        }
        viteConfig = viteConfig.replace(
          /plugins\s*:\s*\[/,
          'plugins: [tailwindcss(), '
        );
        const relativePath = path.relative(options.projectDir, viteConfigPath);
        results.push([relativePath, viteConfig]);
      }
    }
```

Remove the `consola` import if it becomes unused (check — it is still used in the CSS block for `consola.info`, so keep it).

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: No errors

---

### Task 2: Write unit tests for tailwind generator Fix 1

**Files:**
- Create: `tests/generators/tailwind.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock('consola', () => ({
  default: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/utils/find-config.js', () => ({
  getDefaultTailwindCssPath: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/utils/format.js', () => ({
  formatCode: vi.fn().mockImplementation((content: string) => Promise.resolve(content)),
}));

import fs from 'fs-extra';
import { generateTailwindConfig } from '../../src/generators/tailwind.js';
import type { GeneratorOptions } from '../../src/generators/types.js';

const baseOptions: GeneratorOptions = {
  enabledTools: ['tailwind'],
  detectedTools: ['vite'],
  packageManager: 'npm',
  projectDir: '/fake/project',
  settings: {},
};

describe('generateTailwindConfig — vite.config patching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns vite.config as a file pair instead of writing to disk', async () => {
    vi.mocked(fs.pathExists).mockImplementation(async (p) =>
      String(p).endsWith('vite.config.ts')
    );
    vi.mocked(fs.readFile).mockResolvedValue(
      `import { defineConfig } from 'vite';\nexport default defineConfig({\n  plugins: [],\n});\n` as never
    );

    const files = await generateTailwindConfig(baseOptions);

    expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    const viteEntry = files.find(([p]) => p.includes('vite.config'));
    expect(viteEntry).toBeTruthy();
    expect(viteEntry![1]).toContain("import tailwindcss from '@tailwindcss/vite'");
    expect(viteEntry![1]).toContain('plugins: [tailwindcss(), ');
  });

  it('skips patching when @tailwindcss/vite is already present', async () => {
    vi.mocked(fs.pathExists).mockImplementation(async (p) =>
      String(p).endsWith('vite.config.ts')
    );
    vi.mocked(fs.readFile).mockResolvedValue(
      `import tailwindcss from '@tailwindcss/vite';\nimport { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [tailwindcss()] });\n` as never
    );

    const files = await generateTailwindConfig(baseOptions);

    expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    expect(files.find(([p]) => p.includes('vite.config'))).toBeUndefined();
  });

  it('falls through to vite.config.js when .ts does not exist', async () => {
    vi.mocked(fs.pathExists).mockImplementation(async (p) =>
      String(p).endsWith('vite.config.js')
    );
    vi.mocked(fs.readFile).mockResolvedValue(
      `import { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [] });\n` as never
    );

    const files = await generateTailwindConfig(baseOptions);

    expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    const viteEntry = files.find(([p]) => p === 'vite.config.js');
    expect(viteEntry).toBeTruthy();
  });

  it('returns empty array when no vite.config is found', async () => {
    vi.mocked(fs.pathExists).mockResolvedValue(false as never);

    const files = await generateTailwindConfig(baseOptions);

    expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
    expect(files).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (before fix is applied)**

Run: `pnpm test tests/generators/tailwind.test.ts`
Expected: FAIL — `fs.writeFile` is called by the current implementation

- [ ] **Step 3: After applying Fix 1 (Task 1), run tests again to verify they pass**

Run: `pnpm test tests/generators/tailwind.test.ts`
Expected: PASS — all 4 tests green

---

### Task 3: Fix husky note order in mcp-server.ts

**Files:**
- Modify: `mcp-server.ts:179-183`

- [ ] **Step 1: Update the husky note string**

Change the note from instructing `husky init` *after* install to *before writing hook files*:

```typescript
    if (tools.includes('husky')) {
      notes.push(
        'husky requires initialising git hooks before writing hook files: run `npx husky init` inside the project directory first, then write the .husky/ hook files from the configs above'
      );
    }
```

---

### Task 4: Fix plan_test_setup — required projectDir, add packageManager, fix PM detection

**Files:**
- Modify: `mcp-server.ts:213-286`

- [ ] **Step 1: Make `projectDir` required and add `packageManager` to inputSchema**

Replace the `plan_test_setup` `inputSchema` block:

```typescript
    inputSchema: {
      projectDir: z
        .string()
        .describe(
          'Absolute path to the project directory. The framework is auto-detected from config files in this directory.'
        ),
      framework: z
        .enum(['nextjs', 'vite', 'generic'])
        .optional()
        .describe("Target framework. Auto-detected when projectDir is provided. Falls back to 'generic'."),
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
```

- [ ] **Step 2: Update the handler to always detect PM and use projectDir directly**

Replace the handler body:

```typescript
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
```

---

### Task 5: Run full test suite and typecheck, then commit

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit all changes**

```bash
git add src/generators/tailwind.ts tests/generators/tailwind.test.ts mcp-server.ts
git commit -m "fix(mcp): resolve 4 PR review issues in mcp-server and tailwind generator"
```
