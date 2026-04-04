import { detect as detectPM } from '@antfu/ni';
import fs from 'fs-extra';
import path from 'path';

export async function detectProjectTools(dir: string): Promise<string[]> {
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

export async function detectPackageManager(cwd: string): Promise<string> {
  const result = await detectPM({ programmatic: true, cwd });
  if (result === 'yarn@berry') return 'yarn';
  if (result === 'pnpm@6') return 'pnpm';
  if (result === 'bun') return 'bun';
  return result ?? 'npm';
}
