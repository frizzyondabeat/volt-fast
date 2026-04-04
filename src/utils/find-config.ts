import fs from 'fs-extra';
import path from 'path';

export async function findExistingConfig(
  dir: string,
  candidates: string[]
): Promise<string | null> {
  for (const candidate of candidates) {
    if (await fs.pathExists(path.join(dir, candidate))) return candidate;
  }
  return null;
}

export function getDefaultTailwindCssPath(detectedTools: string[]): string {
  if (detectedTools.includes('nextjs')) return './src/app/globals.css';
  if (detectedTools.includes('vite')) return './src/index.css';
  return './src/styles.css';
}
