import type { GeneratorOptions, HuskySettings } from './types.js';

/** Maps a package manager name to its npx-equivalent binary. */
function execBinFor(pm: string): string {
  if (pm === 'pnpm') return 'pnpx';
  if (pm === 'yarn') return 'yarn';
  if (pm === 'bun') return 'bunx';
  return 'npx';
}

export async function generateHuskyConfig(
  options: GeneratorOptions
): Promise<[string, string][]> {
  const huskySettings: HuskySettings | undefined = options.settings?.husky;
  const { enabledTools, packageManager: pm } = options;
  const files: [string, string][] = [];

  if (huskySettings?.enablePreCommit) {
    const preCommitCommands: string[] = [`${pm} lint`];
    if (huskySettings.runFormatOnCommit) {
      preCommitCommands.push(`${pm} format:fix`);
    }
    if (huskySettings.runTestsOnCommit) {
      preCommitCommands.push(`${pm} test`);
    }
    files.push(['.husky/pre-commit', `${preCommitCommands.join('\n')}\n`]);
  }

  if (huskySettings?.enablePrePush && huskySettings.runBuildOnPush) {
    files.push(['.husky/pre-push', `${pm} build\n`]);
  }

  // Only emit commit-msg hook when user explicitly opted into commitlint
  if (enabledTools.includes('commitlint')) {
    files.push([
      '.husky/commit-msg',
      `${execBinFor(pm)} commitlint --edit $1\n`,
    ]);
  }

  return files;
}
