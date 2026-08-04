import fs from 'fs-extra';
import path from 'path';
import { Project, ts } from 'ts-morph';
import type { FileRename } from './rename-plan.js';

const REWRITABLE_EXT = /\.(tsx?|jsx?)$/i;

export type AppliedRename = {
  from: string;
  to: string;
  referencesUpdated: string[];
};
export type RenameResult = {
  applied: AppliedRename[];
  skippedNoRewrite: FileRename[];
  manualCheckNeeded: string[];
  usedTsconfig: boolean;
};

function toRelative(projectDir: string, absPath: string): string {
  return path.relative(projectDir, absPath).split(path.sep).join('/');
}

/** Renames files and rewrites relative imports/exports/dynamic-imports/
 * require() calls that reference them, via ts-morph. `.css`/`.scss` renames
 * have no import-rewriting concept and are moved directly on disk (or
 * reported only, under dry-run). Never touches disk when `dryRun` is true —
 * ts-morph's `move()` is purely in-memory until `project.save()` is called. */
export async function applyRenamePlan(
  projectDir: string,
  allSourceFiles: string[],
  renames: FileRename[],
  { dryRun }: { dryRun: boolean }
): Promise<RenameResult> {
  const manageable = renames.filter((r) => REWRITABLE_EXT.test(r.from));
  const assetOnly = renames.filter((r) => !REWRITABLE_EXT.test(r.from));

  const tsConfigFilePath = path.join(projectDir, 'tsconfig.json');
  const usedTsconfig = await fs.pathExists(tsConfigFilePath);

  const project = usedTsconfig
    ? new Project({ tsConfigFilePath, skipAddingFilesFromTsConfig: true })
    : new Project({
        compilerOptions: {
          allowJs: true,
          jsx: ts.JsxEmit.React,
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
        },
      });

  const tsJsFiles = allSourceFiles.filter((f) => REWRITABLE_EXT.test(f));
  project.addSourceFilesAtPaths(
    tsJsFiles.map((f) => path.resolve(projectDir, f))
  );

  const applied: AppliedRename[] = [];
  for (const rename of manageable) {
    const fromAbs = path.resolve(projectDir, rename.from);
    const toAbs = path.resolve(projectDir, rename.to);
    const sourceFile = project.getSourceFileOrThrow(fromAbs);

    // ponytail: re-snapshotting every source file's full text per rename is
    // O(renames * files) — fine for a one-shot CLI command against typical
    // repo sizes; revisit with an incremental diff if this is ever reused
    // in a watch mode / hot path.
    const before = new Map(
      project.getSourceFiles().map((f) => [f, f.getFullText()])
    );
    sourceFile.move(toAbs);

    const referencesUpdated: string[] = [];
    for (const [file, prevText] of before) {
      if (file === sourceFile) continue;
      if (file.getFullText() !== prevText) {
        referencesUpdated.push(toRelative(projectDir, file.getFilePath()));
      }
    }
    applied.push({ from: rename.from, to: rename.to, referencesUpdated });
  }

  // Best-effort check for references ts-morph's relative-specifier rewriting
  // wouldn't catch (e.g. tsconfig `paths` aliases) — surfaced, not hidden.
  const manualCheckNeeded: string[] = [];
  for (const rename of manageable) {
    const oldBase = path.basename(rename.from).replace(REWRITABLE_EXT, '');
    for (const file of project.getSourceFiles()) {
      const text = file.getFullText();
      const pattern = new RegExp(`['"\`][^'"\`]*/${oldBase}['"\`]`);
      if (pattern.test(text)) {
        manualCheckNeeded.push(
          `${toRelative(projectDir, file.getFilePath())} still references "${oldBase}" — check for a path-alias import that wasn't rewritten`
        );
      }
    }
  }

  if (!dryRun) {
    await project.save();
    for (const rename of assetOnly) {
      await fs.move(
        path.resolve(projectDir, rename.from),
        path.resolve(projectDir, rename.to)
      );
    }
  }

  return { applied, skippedNoRewrite: assetOnly, manualCheckNeeded, usedTsconfig };
}
