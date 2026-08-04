import { describe, expect, it } from 'vitest';
import { calculateDependencies } from '../../src/utils/calculate-deps.js';

describe('calculateDependencies', () => {
  // ── Tailwind ──────────────────────────────────────────────────────────────
  describe('tailwind', () => {
    it('adds tailwindcss for any project', () => {
      const deps = calculateDependencies(['tailwind'], []);
      expect(deps).toContain('tailwindcss');
    });

    it('adds @tailwindcss/vite when vite is detected', () => {
      const deps = calculateDependencies(['tailwind'], ['vite']);
      expect(deps).toContain('@tailwindcss/vite');
    });

    it('does NOT add @tailwindcss/vite for non-vite projects', () => {
      const deps = calculateDependencies(['tailwind'], ['nextjs']);
      expect(deps).not.toContain('@tailwindcss/vite');
    });
  });

  // ── ESLint ────────────────────────────────────────────────────────────────
  describe('eslint', () => {
    it('adds core eslint packages', () => {
      const deps = calculateDependencies(['eslint'], []);
      expect(deps).toContain('eslint@^9');
      expect(deps).toContain('@eslint/js');
      expect(deps).toContain('eslint-plugin-react@^7.37');
      expect(deps).toContain('eslint-plugin-react-hooks@^7.1');
      expect(deps).toContain('eslint-plugin-check-file');
    });

    it('adds typescript-eslint when typescript is detected', () => {
      const deps = calculateDependencies(['eslint'], ['typescript']);
      expect(deps).toContain('typescript-eslint');
    });

    it('does NOT add typescript-eslint without typescript detection', () => {
      const deps = calculateDependencies(['eslint'], []);
      expect(deps).not.toContain('typescript-eslint');
    });

    it('adds @next/eslint-plugin-next when nextjs is detected', () => {
      const deps = calculateDependencies(['eslint'], ['nextjs']);
      expect(deps).toContain('@next/eslint-plugin-next');
    });

    it('adds eslint-config-prettier when both eslint and prettier are selected', () => {
      const deps = calculateDependencies(['eslint', 'prettier'], []);
      expect(deps).toContain('eslint-config-prettier');
    });

    it('does NOT add eslint-config-prettier when prettier is not selected', () => {
      const deps = calculateDependencies(['eslint'], []);
      expect(deps).not.toContain('eslint-config-prettier');
    });
  });

  // ── Prettier ──────────────────────────────────────────────────────────────
  describe('prettier', () => {
    it('adds core prettier packages', () => {
      const deps = calculateDependencies(['prettier'], []);
      expect(deps).toContain('prettier');
      expect(deps).toContain('@trivago/prettier-plugin-sort-imports');
    });

    it('adds prettier-plugin-tailwindcss when tailwind is selected', () => {
      const deps = calculateDependencies(['prettier', 'tailwind'], []);
      expect(deps).toContain('prettier-plugin-tailwindcss');
    });

    it('adds prettier-plugin-tailwindcss when tailwind is detected (not selected)', () => {
      const deps = calculateDependencies(['prettier'], ['tailwind']);
      expect(deps).toContain('prettier-plugin-tailwindcss');
    });

    it('does NOT add prettier-plugin-tailwindcss without tailwind', () => {
      const deps = calculateDependencies(['prettier'], []);
      expect(deps).not.toContain('prettier-plugin-tailwindcss');
    });
  });

  // ── Husky ─────────────────────────────────────────────────────────────────
  describe('husky', () => {
    it('adds husky', () => {
      const deps = calculateDependencies(['husky'], []);
      expect(deps).toContain('husky');
    });
  });

  // ── Commitlint ────────────────────────────────────────────────────────────
  describe('commitlint', () => {
    it('adds commitlint packages when selected', () => {
      const deps = calculateDependencies(['commitlint'], []);
      expect(deps).toContain('@commitlint/cli');
      expect(deps).toContain('@commitlint/config-conventional');
    });

    it('does NOT add commitlint packages when not selected', () => {
      const deps = calculateDependencies(['eslint', 'prettier'], []);
      expect(deps).not.toContain('@commitlint/cli');
    });
  });

  // ── Combinations ─────────────────────────────────────────────────────────
  describe('combinations', () => {
    it('returns empty array when no tools selected', () => {
      const deps = calculateDependencies([], []);
      expect(deps).toEqual([]);
    });

    it('full stack: tailwind+eslint+prettier+husky+commitlint on vite+typescript', () => {
      const deps = calculateDependencies(
        ['tailwind', 'eslint', 'prettier', 'husky', 'commitlint'],
        ['vite', 'typescript']
      );
      expect(deps).toContain('tailwindcss');
      expect(deps).toContain('@tailwindcss/vite');
      expect(deps).toContain('typescript-eslint');
      expect(deps).toContain('eslint-config-prettier');
      expect(deps).toContain('prettier-plugin-tailwindcss');
      expect(deps).toContain('husky');
      expect(deps).toContain('@commitlint/cli');
    });
  });
});
