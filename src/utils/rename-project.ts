import fs from 'fs-extra';
import path from 'path';
import { Node, Project, SyntaxKind, ts } from 'ts-morph';
import type { FileRename } from './rename-plan.js';

const REWRITABLE_EXT = /\.(tsx?|jsx?)$/i;

export type AppliedRename = {
  from: string;
  to: string;
  referencesUpdated: string[];
};
export type RenameResult = {
  applied: AppliedRename[];
  manualCheckNeeded: string[];
  usedTsconfig: boolean;
};

function toRelative(projectDir: string, absPath: string): string {
  return path.relative(projectDir, absPath).split(path.sep).join('/');
}

function isCaseOnlyRename(fromAbs: string, toAbs: string): boolean {
  return fromAbs !== toAbs && fromAbs.toLowerCase() === toAbs.toLowerCase();
}

function toRelativeSpecifier(fromDir: string, targetAbs: string): string {
  const rel = path.relative(fromDir, targetAbs).split(path.sep).join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

const OMITTABLE_EXT = /\.(tsx?|jsx?)$/i;

function stripExt(absPath: string): string {
  return absPath.replace(OMITTABLE_EXT, '');
}

function specifierHasExtension(specifier: string): boolean {
  const lastSegment = specifier.split('/').pop() ?? '';
  return lastSegment.includes('.');
}

/** Rewrites any import/export/dynamic-import/require specifier across the
 * project that resolves to `fromAbs` so it points at `toAbs` instead.
 * ts-morph's `SourceFile.move()` does this automatically for genuine renames,
 * but silently keeps the old-cased specifier for a *case-only* rename
 * (`App.tsx` -> `app.tsx`) — its module-specifier recomputation treats the
 * two paths as "the same file" case-insensitively and leaves it alone. This
 * does the retargeting manually instead, and is reused for `.css`/`.scss`
 * renames too, since those files aren't part of the ts-morph project at all
 * and so get no reference tracking from `move()` in the first place. */
function retargetReferences(
  project: Project,
  projectDir: string,
  fromAbs: string,
  toAbs: string
): string[] {
  const touched = new Set<string>();

  // A relative specifier resolves to fromAbs either exactly (it spelled out
  // the real extension, e.g. `./App.css`, `./App.tsx`) or — only when
  // fromAbs's own extension is TS/JS's omittable kind — via the extensionless
  // form (`./App`). Extensionless specifiers must NOT match a same-named
  // sibling of a different type (e.g. `./App` vs a stray `App.css`), so the
  // loose comparison is gated on fromAbs's extension, not the specifier's.
  const resolves = (fileDir: string, specifier: string): boolean => {
    if (!specifier.startsWith('.')) return false;
    const resolved = path.resolve(fileDir, specifier);
    if (resolved === fromAbs) return true;
    return (
      !specifierHasExtension(specifier) &&
      OMITTABLE_EXT.test(fromAbs) &&
      resolved === stripExt(fromAbs)
    );
  };

  // Preserves the original specifier's extension style (most TS/JS imports
  // omit it; CSS/SCSS imports always include it).
  const newSpecifierFor = (fileDir: string, oldSpecifier: string): string => {
    const relative = toRelativeSpecifier(fileDir, toAbs);
    return specifierHasExtension(oldSpecifier) ? relative : stripExt(relative);
  };

  for (const file of project.getSourceFiles()) {
    const fileDir = path.dirname(file.getFilePath());
    let changed = false;

    for (const importDecl of file.getImportDeclarations()) {
      const specifier = importDecl.getModuleSpecifierValue();
      if (resolves(fileDir, specifier)) {
        importDecl.setModuleSpecifier(newSpecifierFor(fileDir, specifier));
        changed = true;
      }
    }

    for (const exportDecl of file.getExportDeclarations()) {
      const specifier = exportDecl.getModuleSpecifierValue();
      if (specifier && resolves(fileDir, specifier)) {
        exportDecl.setModuleSpecifier(newSpecifierFor(fileDir, specifier));
        changed = true;
      }
    }

    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      const isDynamicImport = expr.getKind() === SyntaxKind.ImportKeyword;
      const isRequire = Node.isIdentifier(expr) && expr.getText() === 'require';
      if (!isDynamicImport && !isRequire) continue;

      const [arg] = call.getArguments();
      if (!arg || !Node.isStringLiteral(arg)) continue;
      const specifier = arg.getLiteralValue();
      if (resolves(fileDir, specifier)) {
        arg.setLiteralValue(newSpecifierFor(fileDir, specifier));
        changed = true;
      }
    }

    if (changed) touched.add(toRelative(projectDir, file.getFilePath()));
  }

  return [...touched];
}

/** Renames files and rewrites relative imports/exports/dynamic-imports/
 * require() calls that reference them. Genuine (non-case-only) TS/JS renames
 * go through ts-morph's `SourceFile.move()`, which handles all reference
 * kinds automatically. Case-only TS/JS renames and all `.css`/`.scss`
 * renames use `retargetReferences` instead — see its doc comment for why.
 * Never touches disk when `dryRun` is true — all edits are in-memory until
 * `project.save()` / `fs.move` are called. */
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
          // Without this, extensionless relative imports (e.g. `./App`, the
          // common style in projects without a tsconfig.json) aren't
          // resolved to their source file at all, so ts-morph never links
          // the reference and reference-rewriting on rename silently no-ops.
          moduleResolution: ts.ModuleResolutionKind.Bundler,
        },
      });

  const tsJsFiles = allSourceFiles.filter((f) => REWRITABLE_EXT.test(f));
  project.addSourceFilesAtPaths(
    tsJsFiles.map((f) => path.resolve(projectDir, f))
  );

  const applied: AppliedRename[] = [];
  // ts-morph's `SourceFile.move()`/`project.save()` never actually applies a
  // pure case change on disk — a case-insensitive filesystem (Windows/macOS
  // default) sees old and new path as the same file, so save() ends up
  // writing content to the existing entry without renaming it. These are
  // physically renamed separately, via a real two-hop fs rename, after
  // project.save() — see below.
  const casePhysicalRenames: FileRename[] = [];

  for (const rename of manageable) {
    const fromAbs = path.resolve(projectDir, rename.from);
    const toAbs = path.resolve(projectDir, rename.to);
    const sourceFile = project.getSourceFileOrThrow(fromAbs);

    let referencesUpdated: string[];
    if (isCaseOnlyRename(fromAbs, toAbs)) {
      // Leave the SourceFile at its original path — only retarget what
      // references it. move() can't physically rename it anyway (above),
      // and its own module-specifier recomputation would otherwise leave
      // stale old-cased specifiers in place (case-insensitively "unchanged").
      referencesUpdated = retargetReferences(project, projectDir, fromAbs, toAbs).filter(
        (f) => f !== rename.from
      );
      casePhysicalRenames.push(rename);
    } else {
      // ponytail: re-snapshotting every source file's full text per rename is
      // O(renames * files) — fine for a one-shot CLI command against typical
      // repo sizes; revisit with an incremental diff if this is ever reused
      // in a watch mode / hot path.
      const before = new Map(
        project.getSourceFiles().map((f) => [f, f.getFullText()])
      );
      sourceFile.move(toAbs);
      referencesUpdated = [];
      for (const [file, prevText] of before) {
        if (file === sourceFile) continue;
        if (file.getFullText() !== prevText) {
          referencesUpdated.push(toRelative(projectDir, file.getFilePath()));
        }
      }
    }

    applied.push({ from: rename.from, to: rename.to, referencesUpdated });
  }

  for (const rename of assetOnly) {
    const fromAbs = path.resolve(projectDir, rename.from);
    const toAbs = path.resolve(projectDir, rename.to);
    const referencesUpdated = retargetReferences(project, projectDir, fromAbs, toAbs);
    applied.push({ from: rename.from, to: rename.to, referencesUpdated });
  }

  // Best-effort check for references none of the above caught (e.g. tsconfig
  // `paths` aliases) — surfaced, not hidden.
  const manualCheckNeeded: string[] = [];
  for (const rename of renames) {
    const oldBase = path.basename(rename.from).replace(/\.[^.]+$/, '');
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
    for (const rename of casePhysicalRenames) {
      const fromAbs = path.resolve(projectDir, rename.from);
      const toAbs = path.resolve(projectDir, rename.to);
      // A direct rename between paths differing only in case is a no-op on
      // case-insensitive filesystems — routing through a differently-named
      // temp file forces the OS to actually apply the case change.
      const tempAbs = path.join(
        path.dirname(toAbs),
        `__volt_fast_tmp_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(toAbs)}`
      );
      await fs.move(fromAbs, tempAbs);
      await fs.move(tempAbs, toAbs);
    }
  }

  return { applied, manualCheckNeeded, usedTsconfig };
}
