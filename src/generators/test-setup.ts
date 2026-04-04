/**
 * Generates test-runner configuration files following official guides:
 *
 *  Next.js + Vitest  → https://nextjs.org/docs/app/guides/testing/vitest
 *  Next.js + Jest    → https://nextjs.org/docs/app/guides/testing/jest
 *  Vite    + Vitest  → https://vitest.dev/guide/
 *  Vite    + Jest    → ts-jest + jest-environment-jsdom
 */

import consola from 'consola';
import fs from 'fs-extra';
import path from 'path';
import { findExistingConfig } from '../utils/find-config.js';
import type { TestFramework, TestRunner } from '../utils/test-deps.js';

export type TestGeneratorOptions = {
  framework: TestFramework;
  runner: TestRunner;
  hasTs: boolean;
  projectDir: string;
};

// ---------------------------------------------------------------------------
// Guard: abort if a config for this runner already exists
// ---------------------------------------------------------------------------
async function guardExistingConfig(
  projectDir: string,
  runner: TestRunner
): Promise<boolean> {
  const vitestCandidates = [
    'vitest.config.ts',
    'vitest.config.mts',
    'vitest.config.js',
    'vitest.config.mjs',
  ];
  const jestCandidates = [
    'jest.config.ts',
    'jest.config.js',
    'jest.config.mjs',
    'jest.config.cjs',
  ];

  const existing = await findExistingConfig(
    projectDir,
    runner === 'vitest' ? vitestCandidates : jestCandidates
  );

  if (existing) {
    consola.warn(
      `Test config already exists (${existing}). Skipping test setup to avoid overwriting.`
    );
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Next.js + Vitest
// Guide: https://nextjs.org/docs/app/guides/testing/vitest
// ---------------------------------------------------------------------------
async function nextjsVitest(hasTs: boolean): Promise<[string, string][]> {
  const configFilename = hasTs ? 'vitest.config.mts' : 'vitest.config.mjs';

  const configContent = hasTs
    ? `import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
  },
  resolve: {
    tsconfigPaths: true
  }
});
`
    : `import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
  },
});
`;

  const exampleTest = `import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

// Replace with your actual component import
function Page() {
  return <h1>Home</h1>;
}

test('Page', () => {
  render(<Page />);
  expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeDefined();
});
`;

  return [
    [configFilename, configContent],
    [`__tests__/example.test.${hasTs ? 'tsx' : 'jsx'}`, exampleTest],
  ];
}

// ---------------------------------------------------------------------------
// Next.js + Jest
// Guide: https://nextjs.org/docs/app/guides/testing/jest
// ---------------------------------------------------------------------------
async function nextjsJest(hasTs: boolean): Promise<[string, string][]> {
  const isTs = hasTs;

  const jestConfig = isTs
    ? `import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({
  // Point to the Next.js root so it can load next.config.js and .env files
  dir: './',
});

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};

export default createJestConfig(config);
`
    : `const nextJest = require('next/jest');

const createJestConfig = nextJest({
  dir: './',
});

/** @type {import('jest').Config} */
const config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};

module.exports = createJestConfig(config);
`;

  const jestSetup = isTs
    ? `import '@testing-library/jest-dom';\n`
    : `require('@testing-library/jest-dom');\n`;

  const exampleTest = isTs
    ? `import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

// Replace with your actual component import
function Page() {
  return <h1>Home</h1>;
}

describe('Page', () => {
  it('renders a heading', () => {
    render(<Page />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();
  });
});
`
    : `import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

function Page() {
  return <h1>Home</h1>;
}

describe('Page', () => {
  it('renders a heading', () => {
    render(<Page />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();
  });
});
`;

  const configExt = isTs ? 'ts' : 'js';
  const setupExt = isTs ? 'ts' : 'js';
  const testExt = isTs ? 'tsx' : 'jsx';

  return [
    [`jest.config.${configExt}`, jestConfig],
    [`jest.setup.${setupExt}`, jestSetup],
    [`__tests__/example.test.${testExt}`, exampleTest],
  ];
}

// ---------------------------------------------------------------------------
// Vite + Vitest
// Guide: https://vitest.dev/guide/
// ---------------------------------------------------------------------------
async function viteVitest(
  projectDir: string,
  hasTs: boolean
): Promise<[string, string][]> {
  // Detect which vite.config extension is present so we can import it correctly
  const viteConfigExt = await detectViteConfigExt(projectDir);

  // Use mergeConfig to extend the existing Vite config non-destructively
  const configContent = viteConfigExt
    ? `import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config${viteConfigExt === 'ts' ? '' : `.${viteConfigExt}`}';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
}));
`
    : `import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
`;

  const exampleTest = `import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

// Replace with your actual component import
function ExampleComponent() {
  return <h1>Hello World</h1>;
}

describe('ExampleComponent', () => {
  it('renders correctly', () => {
    render(<ExampleComponent />);
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
  });
});
`;

  const configFilename = hasTs ? 'vitest.config.ts' : 'vitest.config.js';
  const testExt = hasTs ? 'tsx' : 'jsx';

  return [
    [configFilename, configContent],
    [`__tests__/example.test.${testExt}`, exampleTest],
  ];
}

// ---------------------------------------------------------------------------
// Vite + Jest
// ---------------------------------------------------------------------------
async function viteJest(hasTs: boolean): Promise<[string, string][]> {
  const jestConfig = hasTs
    ? `import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};

export default config;
`
    : `/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};

module.exports = config;
`;

  const jestSetup = hasTs
    ? `import '@testing-library/jest-dom';\n`
    : `require('@testing-library/jest-dom');\n`;

  const exampleTest = hasTs
    ? `import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

// Replace with your actual component import
function ExampleComponent() {
  return <h1>Hello World</h1>;
}

describe('ExampleComponent', () => {
  it('renders correctly', () => {
    render(<ExampleComponent />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});
`
    : `require('@testing-library/jest-dom');
const { render, screen } = require('@testing-library/react');

function ExampleComponent() {
  return <h1>Hello World</h1>;
}

describe('ExampleComponent', () => {
  it('renders correctly', () => {
    render(<ExampleComponent />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});
`;

  const configExt = hasTs ? 'ts' : 'js';
  const testExt = hasTs ? 'tsx' : 'jsx';

  return [
    [`jest.config.${configExt}`, jestConfig],
    [`jest.setup.${configExt}`, jestSetup],
    [`__tests__/example.test.${testExt}`, exampleTest],
  ];
}

// ---------------------------------------------------------------------------
// Generic (non-Next.js, non-Vite) — bare Vitest or Jest
// ---------------------------------------------------------------------------
async function genericVitest(hasTs: boolean): Promise<[string, string][]> {
  const configContent = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
`;
  const exampleTest = hasTs
    ? `import { describe, expect, it } from 'vitest';

describe('example', () => {
  it('works', () => {
    expect(1 + 1).toBe(2);
  });
});
`
    : `import { describe, expect, it } from 'vitest';

describe('example', () => {
  it('works', () => {
    expect(1 + 1).toBe(2);
  });
});
`;

  const configExt = hasTs ? 'ts' : 'js';
  const testExt = hasTs ? 'ts' : 'js';

  return [
    [`vitest.config.${configExt}`, configContent],
    [`__tests__/example.test.${testExt}`, exampleTest],
  ];
}

async function genericJest(hasTs: boolean): Promise<[string, string][]> {
  const jestConfig = hasTs
    ? `import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
};

export default config;
`
    : `/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
};

module.exports = config;
`;

  const exampleTest = `describe('example', () => {
  it('works', () => {
    expect(1 + 1).toBe(2);
  });
});
`;

  const configExt = hasTs ? 'ts' : 'js';
  const testExt = hasTs ? 'ts' : 'js';

  return [
    [`jest.config.${configExt}`, jestConfig],
    [`__tests__/example.test.${testExt}`, exampleTest],
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function detectViteConfigExt(
  projectDir: string
): Promise<string | null> {
  const candidates = ['ts', 'js', 'mts', 'mjs'];
  for (const ext of candidates) {
    if (await fs.pathExists(path.join(projectDir, `vite.config.${ext}`))) {
      return ext;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point — dispatch to the right generator
// ---------------------------------------------------------------------------
export async function generateTestConfig(
  options: TestGeneratorOptions
): Promise<[string, string][]> {
  const { framework, runner, hasTs, projectDir } = options;

  if (await guardExistingConfig(projectDir, runner)) return [];

  if (framework === 'nextjs') {
    return runner === 'vitest'
      ? nextjsVitest(hasTs)
      : nextjsJest(hasTs);
  }

  if (framework === 'vite') {
    return runner === 'vitest'
      ? viteVitest(projectDir, hasTs)
      : viteJest(hasTs);
  }

  // Generic
  return runner === 'vitest' ? genericVitest(hasTs) : genericJest(hasTs);
}
