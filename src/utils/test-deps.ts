/**
 * Calculates the dev-dependency list to install for a test runner setup.
 *
 * Follows the official guides:
 *  - Next.js + Vitest: https://nextjs.org/docs/app/guides/testing/vitest
 *  - Next.js + Jest:   https://nextjs.org/docs/app/guides/testing/jest
 *  - Vite + Vitest:    https://vitest.dev/guide/
 *
 * Pure function — no I/O, fully unit-testable.
 */

export type TestFramework = 'nextjs' | 'vite' | 'generic';
export type TestRunner = 'vitest' | 'jest';

export function calculateTestDependencies(
  framework: TestFramework,
  runner: TestRunner,
  hasTs: boolean
): string[] {
  if (framework === 'nextjs') {
    if (runner === 'vitest') {
      // https://nextjs.org/docs/app/guides/testing/vitest
      const deps = [
        'vitest',
        '@vitejs/plugin-react',
        'jsdom',
        '@testing-library/react',
        '@testing-library/dom',
      ];
      if (hasTs) deps.push('vite-tsconfig-paths');
      return deps;
    }

    // Next.js + Jest
    // https://nextjs.org/docs/app/guides/testing/jest
    // Note: `next/jest` comes from the `next` package — no extra install needed.
    const deps = [
      'jest',
      'jest-environment-jsdom',
      '@testing-library/react',
      '@testing-library/dom',
      '@testing-library/jest-dom',
    ];
    if (hasTs) deps.push('ts-node', '@types/jest');
    return deps;
  }

  if (framework === 'vite') {
    if (runner === 'vitest') {
      // https://vitest.dev/guide/
      // @vitejs/plugin-react is usually already a dep in Vite React projects;
      // include it anyway so the install is idempotent.
      return [
        'vitest',
        '@vitejs/plugin-react',
        'jsdom',
        '@testing-library/react',
        '@testing-library/dom',
      ];
    }

    // Vite + Jest — ts-jest for TypeScript support
    const deps = [
      'jest',
      'jest-environment-jsdom',
      '@testing-library/react',
      '@testing-library/dom',
      '@testing-library/jest-dom',
    ];
    if (hasTs) deps.push('ts-jest', '@types/jest');
    else deps.push('babel-jest', '@babel/core', '@babel/preset-env', '@babel/preset-react');
    return deps;
  }

  // Generic (non-Next.js, non-Vite) project
  if (runner === 'vitest') {
    return ['vitest'];
  }
  const deps = ['jest'];
  if (hasTs) deps.push('ts-jest', '@types/jest');
  return deps;
}

/** Package.json scripts to add for each runner. */
export function testScripts(runner: TestRunner): Record<string, string> {
  if (runner === 'vitest') {
    return {
      test: 'vitest',
      'test:run': 'vitest run',
      'test:coverage': 'vitest run --coverage',
    };
  }
  // Jest
  return {
    test: 'jest',
    'test:watch': 'jest --watch',
    'test:coverage': 'jest --coverage',
  };
}
