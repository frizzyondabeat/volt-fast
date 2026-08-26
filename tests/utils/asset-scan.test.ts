import { describe, expect, it } from 'vitest';
import { computeAssetScanPlan, type AssetUsage } from '../../src/utils/asset-scan.js';

function usageMap(entries: [string, AssetUsage][]): Map<string, AssetUsage> {
  return new Map(entries);
}

describe('computeAssetScanPlan', () => {
  it('categorizes an asset with a direct hit as used', () => {
    const assets = ['public/logo.png'];
    const usage = usageMap([
      ['public/logo.png', { assetPath: 'public/logo.png', directHitFiles: ['src/App.tsx'], dynamicHitFiles: [] }],
    ]);

    const plan = computeAssetScanPlan(assets, usage);

    expect(plan.used).toEqual(['public/logo.png']);
    expect(plan.unused).toEqual([]);
  });

  it('rescues a source original whose referenced derivative sibling shares dir and stem', () => {
    const assets = ['public/logo.png', 'public/logo.webp'];
    const usage = usageMap([
      ['public/logo.png', { assetPath: 'public/logo.png', directHitFiles: [], dynamicHitFiles: [] }],
      ['public/logo.webp', { assetPath: 'public/logo.webp', directHitFiles: ['src/App.tsx'], dynamicHitFiles: [] }],
    ]);

    const plan = computeAssetScanPlan(assets, usage);

    expect(plan.sourceOriginal).toEqual([
      { asset: 'public/logo.png', keptBecause: ['public/logo.webp'] },
    ]);
    expect(plan.unused).toEqual([]);
  });

  it('flags a dynamic-path match instead of marking unused', () => {
    const assets = ['public/avatars/default.png'];
    const usage = usageMap([
      [
        'public/avatars/default.png',
        { assetPath: 'public/avatars/default.png', directHitFiles: [], dynamicHitFiles: ['src/getAvatar.ts'] },
      ],
    ]);

    const plan = computeAssetScanPlan(assets, usage);

    expect(plan.dynamicMaybe).toEqual([
      { asset: 'public/avatars/default.png', matchedIn: ['src/getAvatar.ts'] },
    ]);
    expect(plan.unused).toEqual([]);
  });

  it('marks a true orphan as unused', () => {
    const assets = ['public/old-banner.png'];
    const usage = usageMap([
      ['public/old-banner.png', { assetPath: 'public/old-banner.png', directHitFiles: [], dynamicHitFiles: [] }],
    ]);

    const plan = computeAssetScanPlan(assets, usage);

    expect(plan.unused).toEqual(['public/old-banner.png']);
  });

  it('does not rescue via a sibling that is itself unreferenced', () => {
    const assets = ['public/logo.png', 'public/logo.webp'];
    const usage = usageMap([
      ['public/logo.png', { assetPath: 'public/logo.png', directHitFiles: [], dynamicHitFiles: [] }],
      ['public/logo.webp', { assetPath: 'public/logo.webp', directHitFiles: [], dynamicHitFiles: [] }],
    ]);

    const plan = computeAssetScanPlan(assets, usage);

    expect(plan.sourceOriginal).toEqual([]);
    expect(plan.unused).toEqual(['public/logo.png', 'public/logo.webp']);
  });

  it('does not treat a same-stem file in a different directory as a sibling', () => {
    const assets = ['public/icons/logo.png', 'public/other/logo.webp'];
    const usage = usageMap([
      ['public/icons/logo.png', { assetPath: 'public/icons/logo.png', directHitFiles: [], dynamicHitFiles: [] }],
      ['public/other/logo.webp', { assetPath: 'public/other/logo.webp', directHitFiles: ['src/App.tsx'], dynamicHitFiles: [] }],
    ]);

    const plan = computeAssetScanPlan(assets, usage);

    expect(plan.sourceOriginal).toEqual([]);
    expect(plan.unused).toEqual(['public/icons/logo.png']);
    expect(plan.used).toEqual(['public/other/logo.webp']);
  });
});
