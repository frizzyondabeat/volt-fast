import fs from 'fs-extra';
import ignore from 'ignore';
import path from 'path';

export const DEFAULT_SOURCE_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'css', 'scss'];

const HARD_EXCLUDES = ['node_modules', '.git'];

/** Pure: rewrites gitignore patterns found in a nested `.gitignore` so they
 * only apply within that directory's subtree, for use with a single
 * accumulated `ignore()` instance during a top-down walk. */
export function prefixIgnorePatterns(
  patterns: string[],
  dirRelPath: string
): string[] {
  if (!dirRelPath || dirRelPath === '.') return patterns;
  return patterns.map((pattern) => {
    const negated = pattern.startsWith('!');
    const body = negated ? pattern.slice(1) : pattern;
    const prefixed = `${dirRelPath}/${body}`;
    return negated ? `!${prefixed}` : prefixed;
  });
}

function parseGitignore(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** Recursively enumerates files under `projectDir` matching `extensions`,
 * honoring the target project's (possibly nested) `.gitignore` files.
 * `node_modules` and `.git` are always excluded. Returns POSIX-style paths
 * relative to `projectDir`. */
export async function walkSourceFiles(
  projectDir: string,
  extensions: string[] = DEFAULT_SOURCE_EXTENSIONS
): Promise<string[]> {
  const ig = ignore().add(HARD_EXCLUDES);
  const extSet = new Set(extensions.map((ext) => ext.replace(/^\./, '').toLowerCase()));
  const results: string[] = [];

  async function walk(absDir: string, relDir: string): Promise<void> {
    const entries = await fs.readdir(absDir, { withFileTypes: true });

    const gitignoreEntry = entries.find(
      (entry) => entry.isFile() && entry.name === '.gitignore'
    );
    if (gitignoreEntry) {
      const content = await fs.readFile(path.join(absDir, '.gitignore'), 'utf-8');
      ig.add(prefixIgnorePatterns(parseGitignore(content), relDir));
    }

    for (const entry of entries) {
      const entryRel = relDir === '.' ? entry.name : `${relDir}/${entry.name}`;
      if (ig.ignores(entryRel)) continue;

      const absPath = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath, entryRel);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        if (extSet.has(ext)) results.push(entryRel);
      }
    }
  }

  await walk(path.resolve(projectDir), '.');
  return results;
}
