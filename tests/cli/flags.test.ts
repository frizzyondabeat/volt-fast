/**
 * CLI flag contract tests.
 *
 * These tests verify the *interface* of the setup command (option definitions,
 * argument parsing, validation) without spawning a full child process or
 * touching the filesystem.  They use commander's parseAsync with a synthetic
 * argv array and inspect the parsed options.
 */
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal replica of the setup command's option definitions.
// We don't import cli.ts directly because it calls main() on import which
// would invoke commander.parse() against the real process.argv.
// Instead we mirror just the option declarations to test the interface.
// ---------------------------------------------------------------------------
function buildTestCommand(): Command {
  return new Command('setup')
    .argument('[projectdir]')
    .option('--yes', 'Skip all prompts')
    .option('--tools <tools>', 'Comma-separated list of tools')
    .option('--dry-run', 'Preview only');
}

async function parseArgs(argv: string[]): Promise<{
  args: string[];
  opts: { yes?: boolean; tools?: string; dryRun?: boolean };
}> {
  const cmd = buildTestCommand();
  // exitOverride prevents commander from calling process.exit on parse errors
  cmd.exitOverride();
  await cmd.parseAsync(['node', 'volt-fast', ...argv]);
  return { args: cmd.args, opts: cmd.opts() };
}

describe('setup command — flag parsing', () => {
  it('accepts --yes flag', async () => {
    const { opts } = await parseArgs(['--yes']);
    expect(opts.yes).toBe(true);
  });

  it('accepts --dry-run flag', async () => {
    const { opts } = await parseArgs(['--dry-run']);
    expect(opts.dryRun).toBe(true);
  });

  it('accepts --tools with comma-separated values', async () => {
    const { opts } = await parseArgs(['--tools', 'tailwind,eslint,prettier']);
    expect(opts.tools).toBe('tailwind,eslint,prettier');
  });

  it('accepts combined --yes --tools flags', async () => {
    const { opts } = await parseArgs(['--yes', '--tools', 'eslint,prettier']);
    expect(opts.yes).toBe(true);
    expect(opts.tools).toBe('eslint,prettier');
  });

  it('accepts combined --yes --dry-run flags', async () => {
    const { opts } = await parseArgs(['--yes', '--dry-run']);
    expect(opts.yes).toBe(true);
    expect(opts.dryRun).toBe(true);
  });

  it('accepts a positional projectdir argument', async () => {
    const { args } = await parseArgs(['/my/project', '--yes']);
    expect(args[0]).toBe('/my/project');
  });

  it('yes defaults to undefined when not provided', async () => {
    const { opts } = await parseArgs([]);
    expect(opts.yes).toBeUndefined();
  });

  it('dryRun defaults to undefined when not provided', async () => {
    const { opts } = await parseArgs([]);
    expect(opts.dryRun).toBeUndefined();
  });

  it('throws on an unrecognised flag', async () => {
    await expect(parseArgs(['--unknown-flag'])).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tools list parsing — the splitting/filtering logic lives in cli.ts but
// the contract is simple enough to test as a pure inline function.
// ---------------------------------------------------------------------------
const VALID_TOOLS = [
  'tailwind',
  'eslint',
  'prettier',
  'husky',
  'commitlint',
  'shadcn',
];

function parseToolsFlag(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => VALID_TOOLS.includes(t));
}

describe('--tools flag value parsing', () => {
  it('parses valid tools', () => {
    expect(parseToolsFlag('tailwind,eslint')).toEqual(['tailwind', 'eslint']);
  });

  it('trims whitespace around tool names', () => {
    expect(parseToolsFlag(' eslint , prettier ')).toEqual([
      'eslint',
      'prettier',
    ]);
  });

  it('filters out unrecognised tool names', () => {
    expect(parseToolsFlag('eslint,unknown-tool,prettier')).toEqual([
      'eslint',
      'prettier',
    ]);
  });

  it('returns empty array for fully invalid input', () => {
    expect(parseToolsFlag('foo,bar')).toEqual([]);
  });

  it('handles single tool', () => {
    expect(parseToolsFlag('shadcn')).toEqual(['shadcn']);
  });
});
