import consola from 'consola';
import fs from 'fs-extra';
import path from 'path';
import { getDefaultTailwindCssPath } from '../utils/find-config.js';
import { formatCode } from '../utils/format.js';
import type { GeneratorOptions } from './types.js';

export async function generateTailwindConfig(
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
    else if (await fs.pathExists(viteConfigPathJs))
      viteConfigPath = viteConfigPathJs;
    else if (await fs.pathExists(viteConfigPathMjs))
      viteConfigPath = viteConfigPathMjs;

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
        results.push([path.relative(options.projectDir, viteConfigPath), viteConfig]);
      }
    }
  }

  return results;
}
