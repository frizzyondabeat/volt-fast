import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeAssetScanPlan, deleteAssets, gatherAssetUsage } from '../../src/utils/asset-scan.js';

let tmpDir: string | undefined;

function makeTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volt-fast-scan-assets-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) fs.removeSync(tmpDir);
  tmpDir = undefined;
});

async function runScanAssets(dir: string) {
  const { assets, usage } = await gatherAssetUsage(
    dir,
    ['public'],
    ['png', 'webp'],
    ['ts', 'tsx', 'json'],
    ['.graphify']
  );
  return computeAssetScanPlan(assets, usage);
}

describe('scan-assets integration', () => {
  it('marks a directly referenced asset as used', async () => {
    const dir = makeTmpDir();
    fs.outputFileSync(path.join(dir, 'public/logo.png'), 'fake-png');
    fs.outputFileSync(
      path.join(dir, 'src/App.tsx'),
      `export const Logo = () => <img src="/logo.png" />;\n`
    );

    const plan = await runScanAssets(dir);

    expect(plan.used).toContain('public/logo.png');
  });

  it('marks a truly orphaned asset as unused', async () => {
    const dir = makeTmpDir();
    fs.outputFileSync(path.join(dir, 'public/old-banner.png'), 'fake-png');

    const plan = await runScanAssets(dir);

    expect(plan.unused).toContain('public/old-banner.png');
  });

  it('rescues a source-original png whose referenced webp sibling exists', async () => {
    const dir = makeTmpDir();
    fs.outputFileSync(path.join(dir, 'public/hero.png'), 'fake-png');
    fs.outputFileSync(path.join(dir, 'public/hero.webp'), 'fake-webp');
    fs.outputFileSync(
      path.join(dir, 'src/App.tsx'),
      `export const Hero = () => <img src="/hero.webp" />;\n`
    );

    const plan = await runScanAssets(dir);

    expect(plan.sourceOriginal).toContainEqual({
      asset: 'public/hero.png',
      keptBecause: ['public/hero.webp'],
    });
  });

  it('flags an asset only reachable via a dynamic template-literal path', async () => {
    const dir = makeTmpDir();
    fs.outputFileSync(path.join(dir, 'public/avatars/default.png'), 'fake-png');
    fs.outputFileSync(
      path.join(dir, 'src/getAvatar.ts'),
      "export const getAvatar = (id: string) => `/avatars/${id}.png`;\n"
    );

    const plan = await runScanAssets(dir);

    expect(plan.dynamicMaybe).toContainEqual({
      asset: 'public/avatars/default.png',
      matchedIn: ['src/getAvatar.ts'],
    });
  });

  it('ignores a stale reference inside an excluded .graphify cache', async () => {
    const dir = makeTmpDir();
    fs.outputFileSync(path.join(dir, 'public/old-banner.png'), 'fake-png');
    fs.outputFileSync(
      path.join(dir, '.graphify/report.json'),
      JSON.stringify({ note: 'old-banner.png used to be referenced here' })
    );

    const plan = await runScanAssets(dir);

    expect(plan.unused).toContain('public/old-banner.png');
  });

  it('deleteAssets removes only the given paths from disk', async () => {
    const dir = makeTmpDir();
    fs.outputFileSync(path.join(dir, 'public/old-banner.png'), 'fake-png');
    fs.outputFileSync(path.join(dir, 'public/logo.png'), 'fake-png');
    fs.outputFileSync(
      path.join(dir, 'src/App.tsx'),
      `export const Logo = () => <img src="/logo.png" />;\n`
    );

    const plan = await runScanAssets(dir);
    await deleteAssets(dir, plan.unused);

    expect(fs.existsSync(path.join(dir, 'public/old-banner.png'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'public/logo.png'))).toBe(true);
  });
});
