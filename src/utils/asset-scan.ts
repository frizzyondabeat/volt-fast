import fs from 'fs-extra';
import path from 'path';
import { DEFAULT_SOURCE_EXTENSIONS, walkSourceFiles } from './walk-source-files.js';

export const DEFAULT_ASSET_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'woff', 'woff2', 'ttf', 'otf',
];
export const DEFAULT_ASSET_SOURCE_EXTENSIONS = [
  ...DEFAULT_SOURCE_EXTENSIONS, 'html', 'json', 'md', 'mdx', 'vue', 'svelte', 'astro',
];
export const DEFAULT_ASSET_DIRS = ['public', 'static', 'assets'];
export const DEFAULT_ASSET_EXCLUDES = ['.next', 'dist', 'build', '.graphify'];

export type AssetUsage = {
  assetPath: string;
  directHitFiles: string[];
  dynamicHitFiles: string[];
};

export type AssetScanPlan = {
  used: string[];
  unused: string[];
  sourceOriginal: { asset: string; keptBecause: string[] }[];
  dynamicMaybe: { asset: string; matchedIn: string[] }[];
};

function dirAndStem(assetPath: string): { dir: string; stem: string } {
  const dir = path.posix.dirname(assetPath);
  const base = path.posix.basename(assetPath);
  const dotIndex = base.indexOf('.');
  const stem = dotIndex <= 0 ? base : base.slice(0, dotIndex);
  return { dir, stem };
}

/** Pure: given the full list of asset paths and per-asset usage evidence
 * (already gathered), categorizes each asset. Never resolves ambiguity
 * toward `unused` — that's the only bucket `--fix` deletes. */
export function computeAssetScanPlan(
  assets: string[],
  usage: Map<string, AssetUsage>
): AssetScanPlan {
  const used: string[] = [];
  const unused: string[] = [];
  const sourceOriginal: { asset: string; keptBecause: string[] }[] = [];
  const dynamicMaybe: { asset: string; matchedIn: string[] }[] = [];

  for (const asset of assets) {
    const info = usage.get(asset);
    if (info && info.directHitFiles.length > 0) {
      used.push(asset);
      continue;
    }

    const { dir, stem } = dirAndStem(asset);
    const referencedSiblings = assets.filter((other) => {
      if (other === asset) return false;
      const otherInfo = dirAndStem(other);
      if (otherInfo.dir !== dir || otherInfo.stem !== stem) return false;
      const otherUsage = usage.get(other);
      return !!otherUsage && otherUsage.directHitFiles.length > 0;
    });

    if (referencedSiblings.length > 0) {
      sourceOriginal.push({ asset, keptBecause: referencedSiblings });
      continue;
    }

    if (info && info.dynamicHitFiles.length > 0) {
      dynamicMaybe.push({ asset, matchedIn: info.dynamicHitFiles });
      continue;
    }

    unused.push(asset);
  }

  return { used, unused, sourceOriginal, dynamicMaybe };
}

/** Impure: one walk over `projectDir` (assets + source extensions together,
 * so results share a root and `--fix` can delete by the same relative
 * path source scanning matched against), partitioned into asset files
 * (under `assetDirs`) and source files (everything else, content read and
 * scanned). For each asset: a direct hit is any source file whose content
 * contains the asset's basename; a dynamic hit is a source file whose
 * content contains the asset's directory (relative to its matched asset
 * dir — i.e. the URL path a browser/CSS would use, not the disk path) and
 * also looks like it builds paths at runtime (a template-literal backtick
 * or `.replace(`). `ponytail:` basename/dir substring matching, not AST —
 * upgrade to real parsing if false positive/negative rate proves too high. */
export async function gatherAssetUsage(
  projectDir: string,
  assetDirs: string[],
  assetExtensions: string[],
  sourceExtensions: string[],
  extraExcludes: string[] = []
): Promise<{ assets: string[]; usage: Map<string, AssetUsage> }> {
  const allExtensions = [...new Set([...assetExtensions, ...sourceExtensions])];
  const allFiles = await walkSourceFiles(projectDir, allExtensions, extraExcludes);

  const assetExtSet = new Set(assetExtensions.map((ext) => ext.replace(/^\./, '').toLowerCase()));
  const normalizedAssetDirs = assetDirs.map((dir) => dir.replace(/\/+$/, ''));
  const underAssetDir = (file: string): string | undefined =>
    normalizedAssetDirs.find((dir) => file === dir || file.startsWith(`${dir}/`));

  const assets: string[] = [];
  const sourceFiles: string[] = [];
  for (const file of allFiles) {
    const ext = path.posix.extname(file).slice(1).toLowerCase();
    if (underAssetDir(file) && assetExtSet.has(ext)) {
      assets.push(file);
    } else {
      sourceFiles.push(file);
    }
  }

  const contents = new Map<string, string>();
  for (const file of sourceFiles) {
    contents.set(file, await fs.readFile(path.join(projectDir, file), 'utf-8'));
  }

  const usage = new Map<string, AssetUsage>();
  for (const asset of assets) {
    const basename = path.posix.basename(asset);
    const matchedAssetDir = underAssetDir(asset)!;
    const urlPath = asset.slice(matchedAssetDir.length + 1);
    const urlDir = path.posix.dirname(urlPath);

    const directHitFiles: string[] = [];
    const dynamicHitFiles: string[] = [];
    for (const [file, content] of contents) {
      if (content.includes(basename)) {
        directHitFiles.push(file);
        continue;
      }
      if (urlDir !== '.' && content.includes(urlDir) && (content.includes('`') || content.includes('.replace('))) {
        dynamicHitFiles.push(file);
      }
    }

    usage.set(asset, { assetPath: asset, directHitFiles, dynamicHitFiles });
  }

  return { assets, usage };
}

/** Impure: deletes the given asset paths from disk. Kept separate from
 * planning so `--fix` is unit-testable without spawning the CLI. */
export async function deleteAssets(projectDir: string, relativePaths: string[]): Promise<void> {
  for (const relativePath of relativePaths) {
    await fs.remove(path.join(projectDir, relativePath));
  }
}
