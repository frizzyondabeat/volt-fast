# `scan-assets`: unused static asset scanner

## Problem

Import-graph tools (`knip`/`depcheck`/`ts-prune`) don't catch orphaned static assets under `public/`/`static/`/`assets/`. Asset references are usually plain strings — `<img src="/logos/x.png">`, CSS `url(...)`, Next.js `metadata.icons`, `manifest.json` — not `import`/`require` statements, so import-graph analysis never sees them. This is a grep-based reachability check (content search for a file's basename across source), not an import graph.

## Scope

- **In scope:** flat file reachability for common asset extensions (images, fonts) under detected/declared asset dirs, reported for human review; `--fix` deletes only files with zero evidence of use, behind a confirmation.
- **Out of scope:** resolving fully dynamic paths (`` `/images/${slug}.webp` ``, `.replace('.png', '.webp')`) — flagged as `DYNAMIC_MAYBE` for manual review, never auto-resolved or auto-deleted.
- **No `--src` flag.** The originally sketched CLI shape included `--src <dirs>` to narrow which source dirs get grepped. Dropped: a narrowed source scan can miss a real reference (root `index.html`, `next.config.js` icon metadata, a `.astro`/`.svelte` file) and turn a used asset into a false `UNUSED` verdict — and `UNUSED` is the one bucket `--fix` deletes. A whole-project walk (with `--exclude` as an opt-out, safe by construction since excluding can only ever move something *out* of consideration for deletion... actually excluding a *source* dir can also cause a false UNUSED. See "Known ceiling" below.) is the default; `--exclude` only affects directories excluded from the walk entirely (build output, caches), not source-vs-not classification.
- **Governing principle for every heuristic below: fail toward `USED`, never toward `UNUSED`.** Ambiguity always resolves to "keep."

## Algorithm

1. Walk the project once (`walkSourceFiles`, reused) with the union of asset extensions and an extended source-extension set, honoring `.gitignore` plus hardcoded/`--exclude` excludes.
2. Partition the walk results: paths under a detected/declared asset dir → assets; everything else → source (its content gets read and scanned).
3. For each asset, check every source file's content for the asset's basename (direct hit).
4. For each asset, also check for the "dynamic path" heuristic: a source file whose content contains the asset's directory as a substring *and* contains a template-literal marker or `.replace(` — flagged, not resolved.
5. Categorize (pure function, no I/O):
   - Direct hit → `USED`.
   - No direct hit, but a same-dir/same-stem sibling asset (any extension) has a direct hit → `SOURCE_ORIGINAL` (build input, e.g. a checked-in master `.png` whose `.webp` derivative is what's actually referenced — no derivative-extension allowlist, any referenced sibling counts).
   - No direct hit, no qualifying sibling, but a dynamic-path match exists → `DYNAMIC_MAYBE`.
   - Otherwise → `UNUSED` (the only bucket `--fix` deletes).

## False-positive guards

- **Runtime-constructed paths** → `DYNAMIC_MAYBE`, never silently resolved or deleted.
- **Metadata-only references** (Next.js `icons`, `manifest.json`, sitemap) → covered by scanning `.json`/`.html`/config files, not just component files (see extended source-extension set below).
- **CSS `url(...)` / inline styles** → `.css`/`.scss` already in the source-extension set; CSS-in-JS/inline `style={{}}` is covered incidentally since it lives in `.tsx`/`.jsx` files already scanned.
- **Stale tool caches**: any checked-in generated index/report (e.g. `.graphify/`, this repo's own knowledge-graph cache) must never count as "used" evidence — it can reference files already deleted from source. Always excluded from the walk via `extraExcludes`.

## Known ceiling

Matching is by basename only, not full path — two same-named assets in different directories are indistinguishable to the direct-hit check and will both resolve `USED` together if either is referenced. `ponytail:` documented ceiling of basename-only matching; upgrade to path-aware matching if this ever produces a real false negative (an actually-unused asset hidden behind a same-named used one).

## Design

New file `src/utils/asset-scan.ts`:
- `gatherAssetUsage(projectDir, assetDirs, assetExtensions, sourceExtensions, extraExcludes)` — impure: one `walkSourceFiles` call, partition, read + scan source content. Returns `{ assets: string[], usage: Map<string, AssetUsage> }`.
- `computeAssetScanPlan(assets, usage)` — pure: the categorization in step 5 above. Returns `{ used, unused, sourceOriginal, dynamicMaybe }`, mirroring `RenamePlan`'s shape/testability.
- `deleteAssets(projectDir, relativePaths)` — impure, `fs.remove` per path, exported standalone so `--fix` is unit-testable without spawning the CLI (matches `applyRenamePlan`'s separation from `computeRenamePlan`).

`walkSourceFiles` (`src/utils/walk-source-files.ts`) gains an optional `extraExcludes: string[] = []` param merged into its existing `ignore()` instance — backward compatible, single source of truth for the walk+gitignore logic rather than a second hand-rolled walker.

`DEFAULT_ASSET_SOURCE_EXTENSIONS` extends (not reuses as-is) `fix-filenames`'s `DEFAULT_SOURCE_EXTENSIONS` (`ts,tsx,js,jsx,css,scss`) with `html,json,md,mdx,vue,svelte,astro` — exactly where `<img src>` markup and manifest/metadata icon references live. Reusing the narrower set unmodified would put real, referenced assets in `UNUSED`.

CLI: `volt-fast scan-assets [projectdir] --dir <dirs> --exclude <dirs> --include <extensions> --fix --yes --dry-run`, wired in `cli.ts` mirroring `runFixFilenames`/`fixFilenamesCommand`'s scan → plan → print (`boxen`) → dry-run-early-return → confirm (skipped under `--yes`) → apply → summary shape. Default mode (no `--fix`) is report-only, no confirmation prompt, no deletion.

## Testing

- `tests/utils/asset-scan.test.ts` (pure, no fs): `computeAssetScanPlan` — direct hit → used; sibling rescue → sourceOriginal; dynamic rescue → dynamicMaybe; true orphan → unused; duplicate basename in two dirs → both used (documents the known ceiling).
- `tests/integration/scan-assets.test.ts` (real temp dir, `fs.mkdtempSync`, per the `rename-command.test.ts` precedent): one fixture per category plus a `.graphify`-exclusion fixture and a `deleteAssets`/`--fix` assertion that only the `unused` fixture is actually removed from disk.
