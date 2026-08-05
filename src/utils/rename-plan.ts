import path from 'path';
import type { FilenameConvention } from '../generators/types.js';
import { convertBasename } from './naming.js';

export type FileRename = { from: string; to: string };
export type RenamePlanConflict = { targetPath: string; sources: string[] };
export type RenamePlan = {
  renames: FileRename[];
  unchanged: string[];
  conflicts: RenamePlanConflict[];
};

function toPosix(relPath: string): string {
  return relPath.split(path.sep).join('/');
}

const NEXTJS_RESERVED_BASENAMES = new Set([
  'page',
  'layout',
  'route',
  'loading',
  'error',
  'global-error',
  'template',
  'not-found',
  'default',
  'middleware',
  'instrumentation',
]);

/** Returns the FilenameConvention that should actually apply to this file's
 * basename, or null if the file must never be renamed. Next.js reserved
 * filenames (page.tsx, route.ts, etc.) are exact framework requirements, not
 * a style choice, so they're always left untouched. CSS/SCSS basenames
 * always use kebab-case, independent of the requested convention, matching
 * ecosystem norms regardless of what convention the rest of the project uses. */
function resolveConventionForPath(
  posixPath: string,
  convention: FilenameConvention
): FilenameConvention | null {
  const base = path.posix.basename(posixPath);
  const dotIndex = base.indexOf('.');
  const nameBeforeExt = dotIndex <= 0 ? base : base.slice(0, dotIndex);

  if (NEXTJS_RESERVED_BASENAMES.has(nameBeforeExt)) return null;

  const ext = path.posix.extname(base).slice(1).toLowerCase();
  if (ext === 'css' || ext === 'scss') return 'KEBAB_CASE';

  return convention;
}

/** Pure: given a flat list of relative file paths, computes which need
 * renaming to conform to `convention`, and flags any collisions where two+
 * source paths (renamed or already-conformant) would resolve to the same
 * target path. Collisions are excluded from `renames` entirely — never
 * partially apply one side of a collision. */
export function computeRenamePlan(
  relativePaths: string[],
  convention: FilenameConvention
): RenamePlan {
  const targets = relativePaths.map((relPath) => {
    const posixPath = toPosix(relPath);
    const dir = path.posix.dirname(posixPath);
    const base = path.posix.basename(posixPath);
    const resolvedConvention = resolveConventionForPath(posixPath, convention);
    const newBase =
      resolvedConvention === null ? base : convertBasename(base, resolvedConvention);
    const target = dir === '.' ? newBase : `${dir}/${newBase}`;
    return { source: posixPath, target, changed: newBase !== base };
  });

  const groups = new Map<string, string[]>();
  for (const { source, target } of targets) {
    const key = target.toLowerCase();
    const group = groups.get(key);
    if (group) group.push(source);
    else groups.set(key, [source]);
  }

  const conflictSources = new Set<string>();
  const conflicts: RenamePlanConflict[] = [];
  for (const [, sources] of groups) {
    if (sources.length > 1) {
      const target = targets.find((t) => t.source === sources[0])!.target;
      conflicts.push({ targetPath: target, sources });
      for (const source of sources) conflictSources.add(source);
    }
  }

  const renames: FileRename[] = [];
  const unchanged: string[] = [];
  for (const { source, target, changed } of targets) {
    if (conflictSources.has(source)) continue;
    if (!changed) {
      unchanged.push(source);
    } else {
      renames.push({ from: source, to: target });
    }
  }

  return { renames, unchanged, conflicts };
}
