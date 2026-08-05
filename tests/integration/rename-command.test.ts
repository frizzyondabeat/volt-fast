import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeRenamePlan } from '../../src/utils/rename-plan.js';
import { applyRenamePlan } from '../../src/utils/rename-project.js';
import { walkSourceFiles } from '../../src/utils/walk-source-files.js';

let tmpDir: string | undefined;

function makeTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volt-fast-fix-filenames-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) fs.removeSync(tmpDir);
  tmpDir = undefined;
});

async function runFixFilenames(dir: string, dryRun: boolean) {
  const files = await walkSourceFiles(dir);
  const plan = computeRenamePlan(files, 'KEBAB_CASE');
  const result = await applyRenamePlan(dir, files, plan.renames, { dryRun });
  return { files, plan, result };
}

describe('fix-filenames integration', () => {
  it('renames a file and rewrites a relative import', async () => {
    const dir = makeTmpDir();
    fs.outputFileSync(
      path.join(dir, 'src/MyComponent.tsx'),
      `export function MyComponent() { return null; }\n`
    );
    fs.outputFileSync(
      path.join(dir, 'src/entry.tsx'),
      `import { MyComponent } from './MyComponent';\nexport const App = MyComponent;\n`
    );

    const { plan, result } = await runFixFilenames(dir, false);

    expect(plan.renames).toContainEqual({
      from: 'src/MyComponent.tsx',
      to: 'src/my-component.tsx',
    });
    expect(fs.existsSync(path.join(dir, 'src/my-component.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'src/MyComponent.tsx'))).toBe(false);

    const appContent = fs.readFileSync(path.join(dir, 'src/entry.tsx'), 'utf-8');
    expect(appContent).toContain("from './my-component'");

    const applied = result.applied.find((r) => r.from === 'src/MyComponent.tsx');
    expect(applied?.referencesUpdated).toContain('src/entry.tsx');
  });

  it('rewrites a barrel re-export', async () => {
    const dir = makeTmpDir();
    fs.outputFileSync(path.join(dir, 'src/OldName.ts'), `export const value = 1;\n`);
    fs.outputFileSync(
      path.join(dir, 'src/index.ts'),
      `export * from './OldName';\n`
    );

    await runFixFilenames(dir, false);

    const indexContent = fs.readFileSync(path.join(dir, 'src/index.ts'), 'utf-8');
    expect(indexContent).toContain("from './old-name'");
  });

  it('rewrites a dynamic import', async () => {
    const dir = makeTmpDir();
    fs.outputFileSync(path.join(dir, 'src/OldName.ts'), `export const value = 1;\n`);
    fs.outputFileSync(
      path.join(dir, 'src/loader.ts'),
      `export const load = () => import('./OldName');\n`
    );

    await runFixFilenames(dir, false);

    const loaderContent = fs.readFileSync(path.join(dir, 'src/loader.ts'), 'utf-8');
    expect(loaderContent).toContain("import('./old-name')");
  });

  it('rewrites require() in a plain .js file with no tsconfig present', async () => {
    const dir = makeTmpDir();
    fs.outputFileSync(path.join(dir, 'src/OldName.js'), `module.exports = 1;\n`);
    fs.outputFileSync(
      path.join(dir, 'src/main.js'),
      `const value = require('./OldName');\nmodule.exports = value;\n`
    );

    const { result } = await runFixFilenames(dir, false);

    expect(result.usedTsconfig).toBe(false);
    const mainContent = fs.readFileSync(path.join(dir, 'src/main.js'), 'utf-8');
    expect(mainContent).toContain("require('./old-name')");
  });

  it('leaves disk untouched in dry-run mode but still computes a full plan', async () => {
    const dir = makeTmpDir();
    fs.outputFileSync(path.join(dir, 'src/MyComponent.tsx'), `export const x = 1;\n`);

    const { plan, result } = await runFixFilenames(dir, true);

    expect(plan.renames).toHaveLength(1);
    expect(result.applied).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, 'src/MyComponent.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'src/my-component.tsx'))).toBe(false);
  });

  it('skips renaming files that would collide', async () => {
    const dir = makeTmpDir();
    fs.outputFileSync(path.join(dir, 'src/MyComponent.tsx'), `export const a = 1;\n`);
    fs.outputFileSync(path.join(dir, 'src/my-component.tsx'), `export const b = 2;\n`);

    const { plan } = await runFixFilenames(dir, false);

    expect(plan.conflicts).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, 'src/MyComponent.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'src/my-component.tsx'))).toBe(true);
  });

  it('applies a case-only rename and updates the referencing import (regression: Windows/macOS treat App.tsx and app.tsx as the same path)', async () => {
    const dir = makeTmpDir();
    fs.outputFileSync(path.join(dir, 'src/App.tsx'), `export function App() { return null; }\n`);
    fs.outputFileSync(
      path.join(dir, 'src/main.tsx'),
      `import { App } from './App';\nApp();\n`
    );

    const { plan, result } = await runFixFilenames(dir, false);

    expect(plan.renames).toContainEqual({ from: 'src/App.tsx', to: 'src/app.tsx' });
    expect(fs.existsSync(path.join(dir, 'src/app.tsx'))).toBe(true);

    const mainContent = fs.readFileSync(path.join(dir, 'src/main.tsx'), 'utf-8');
    expect(mainContent).not.toContain("from './App'");
    expect(mainContent).toContain("from './app'");

    const applied = result.applied.find((r) => r.from === 'src/App.tsx');
    expect(applied?.referencesUpdated).toContain('src/main.tsx');
  });

  it('rewrites a plain CSS import specifier when the stylesheet is renamed', async () => {
    const dir = makeTmpDir();
    fs.outputFileSync(path.join(dir, 'src/MyStyle.css'), `.a { color: red; }\n`);
    fs.outputFileSync(
      path.join(dir, 'src/App.tsx'),
      `import './MyStyle.css';\nexport const App = () => null;\n`
    );

    await runFixFilenames(dir, false);

    expect(fs.existsSync(path.join(dir, 'src/my-style.css'))).toBe(true);
    const appContent = fs.readFileSync(path.join(dir, 'src/app.tsx'), 'utf-8');
    expect(appContent).toContain("import './my-style.css'");
  });

  it('does not cross-contaminate a same-basename sibling pair (regression: App.tsx + App.css both renaming to app.*)', async () => {
    const dir = makeTmpDir();
    fs.outputFileSync(
      path.join(dir, 'src/App.tsx'),
      `import './App.css';\nimport { UserProfile } from './components/UserProfile';\nexport const App = () => UserProfile;\n`
    );
    fs.outputFileSync(path.join(dir, 'src/App.css'), `.a { color: red; }\n`);
    fs.outputFileSync(
      path.join(dir, 'src/components/UserProfile.tsx'),
      `export const UserProfile = 1;\n`
    );
    fs.outputFileSync(
      path.join(dir, 'src/main.tsx'),
      `import App from './App';\nApp;\n`
    );

    await runFixFilenames(dir, false);

    expect(fs.existsSync(path.join(dir, 'src/app.css'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'src/app.tsx'))).toBe(true);

    const appContent = fs.readFileSync(path.join(dir, 'src/app.tsx'), 'utf-8');
    // The CSS import must point at the renamed stylesheet, not at itself.
    expect(appContent).toContain("import './app.css'");
    expect(appContent).toContain("from './components/user-profile'");

    const mainContent = fs.readFileSync(path.join(dir, 'src/main.tsx'), 'utf-8');
    expect(mainContent).toContain("from './app'");
  });

  it('respects a nested .gitignore', async () => {
    const dir = makeTmpDir();
    fs.outputFileSync(path.join(dir, 'packages/foo/.gitignore'), 'ignored-dir\n');
    fs.outputFileSync(
      path.join(dir, 'packages/foo/ignored-dir/MyComponent.tsx'),
      `export const x = 1;\n`
    );
    fs.outputFileSync(
      path.join(dir, 'packages/foo/MyComponent.tsx'),
      `export const y = 1;\n`
    );

    const files = await walkSourceFiles(dir);

    expect(files).toContain('packages/foo/MyComponent.tsx');
    expect(files).not.toContain('packages/foo/ignored-dir/MyComponent.tsx');
  });
});
