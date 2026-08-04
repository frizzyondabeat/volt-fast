import { describe, expect, it } from 'vitest';
import { prefixIgnorePatterns } from '../../src/utils/walk-source-files.js';

describe('prefixIgnorePatterns', () => {
  it('returns patterns unchanged at the project root', () => {
    expect(prefixIgnorePatterns(['dist', '*.log'], '.')).toEqual(['dist', '*.log']);
    expect(prefixIgnorePatterns(['dist'], '')).toEqual(['dist']);
  });

  it('prefixes patterns with the nested directory', () => {
    expect(prefixIgnorePatterns(['dist', 'build'], 'packages/foo')).toEqual([
      'packages/foo/dist',
      'packages/foo/build',
    ]);
  });

  it('preserves negation when prefixing', () => {
    expect(prefixIgnorePatterns(['!keep-me'], 'packages/foo')).toEqual([
      '!packages/foo/keep-me',
    ]);
  });
});
