<p align="center">
  <img src="https://res.cloudinary.com/dhu3lcuny/image/upload/v1774426075/voltfast-logo-big_v9e8ir.png" alt="Volt Fast logo" width="420" />
</p>

<!-- <h1 align="center">@frizzyondabeat/volt-fast</h1> -->

<h3 align="center">
  A fast interactive CLI to scaffold frontend tooling and starter config files into an existing project.
</h3>

<p align="center">
  <a href="https://voltfast.vercel.app">Website</a>
  •
   <a href="https://voltfast.vercel.app/docs">Documentation</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@frizzyondabeat/volt-fast">
    <img src="https://img.shields.io/npm/v/@frizzyondabeat/volt-fast?style=flat-square" alt="npm version" />
  </a>
  <a href="https://www.npmjs.com/package/@frizzyondabeat/volt-fast">
    <img src="https://img.shields.io/npm/dm/@frizzyondabeat/volt-fast?style=flat-square" alt="npm downloads" />
  </a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" alt="node >=18" />
  <img src="https://img.shields.io/badge/license-ISC-blue?style=flat-square" alt="license ISC" />
</p>

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Commands](#commands)
  - [setup](#volt-fast-setup-projectdir)
  - [test](#volt-fast-test-projectdir)
- [What It Generates](#what-it-generates)
- [Flags](#flags)
- [License](#license)

## Features

- Detects project context (Next.js, Vite, TypeScript)
- Installs selected tooling dependencies using your detected package manager
- Generates ready-to-use config files for:
  - Tailwind CSS
  - Prettier
  - ESLint (v9 flat config)
  - Husky git hooks (pre-commit, pre-push, commit-msg)
  - Commitlint
- Optionally initializes Shadcn UI with alias configuration
- Scaffolds a test runner (Vitest or Jest) following the official framework guides
- Non-interactive `--yes` mode for CI pipelines
- `--dry-run` mode to preview all changes before writing

## Requirements

- Node.js 18+ (Node.js 22 recommended)
- npm, pnpm, yarn, or bun

## Quick Start

Run without global install:

```bash
pnpx @frizzyondabeat/volt-fast setup
```

You can also use:

```bash
npx @frizzyondabeat/volt-fast setup
```

Or install globally:

```bash
npm i -g @frizzyondabeat/volt-fast
volt-fast setup
```

## Commands

### `volt-fast setup [projectdir]`

Installs and configures frontend tooling into an existing project.

- `projectdir` is optional — if omitted, the CLI prompts for the target directory
- Prompts you to select from: Tailwind CSS, ESLint, Prettier, Husky, Commitlint, Shadcn UI
- Detects your package manager and installs all required dependencies
- Writes config files based on your selections and detected project type

**Flow:**

1. Choose target project directory
2. Select tools to configure
3. For Husky: choose which hooks to enable (pre-commit lint, pre-push typecheck, commitlint)
4. For Tailwind: optionally specify the CSS entry file path
5. Choose a filename convention (kebab-case, camelCase, PascalCase)
6. CLI installs packages and writes all config files
7. For Shadcn: patches `tsconfig.json` paths + `vite.config`, then runs `shadcn@latest init`

---

### `volt-fast test [projectdir]`

Scaffolds a test runner into an existing project, following the official framework guides.

- `projectdir` is optional — if omitted, the CLI prompts for the target directory
- Auto-detects your framework (Next.js → Vite → generic Node)
- Prompts you to choose Vitest or Jest
- Aborts without overwriting if a runner config already exists

**What it sets up by framework and runner:**

| Framework | Runner  | Config written              |
|-----------|---------|-----------------------------|
| Next.js   | Vitest  | `vitest.config.ts`          |
| Next.js   | Jest    | `jest.config.ts` + `jest.setup.ts` |
| Vite      | Vitest  | `vitest.config.ts`          |
| Vite      | Jest    | `jest.config.ts` + `jest.setup.ts` |
| Generic   | Vitest  | `vitest.config.ts`          |
| Generic   | Jest    | `jest.config.ts` + `jest.setup.ts` |

In all cases it also writes `__tests__/example.test.tsx` and adds `test` / `test:watch` / `test:coverage` scripts to `package.json`.

**Flow:**

1. Choose target project directory
2. CLI detects framework automatically
3. Choose Vitest or Jest
4. CLI installs all required dependencies
5. Config file, optional setup file, and example test are written
6. `package.json` scripts are updated

## What It Generates

### `setup`

| File | Tool |
|------|------|
| `eslint.config.mjs` | ESLint (v9 flat config) |
| `prettier.config.mjs` | Prettier |
| `tailwind.css` (or custom path) | Tailwind CSS |
| `.husky/pre-commit` | Husky |
| `.husky/pre-push` | Husky |
| `.husky/commit-msg` | Husky + Commitlint (when both selected) |
| `commitlint.config.mjs` | Commitlint |
| `tsconfig.json` path aliases | Shadcn UI |
| `vite.config.ts` / `vite.config.js` patched | Shadcn UI (Vite projects) |

### `test`

| File | Notes |
|------|-------|
| `vitest.config.ts` or `jest.config.ts` | Runner config |
| `jest.setup.ts` | Jest only |
| `__tests__/example.test.tsx` | Starter test file |
| `package.json` scripts | `test`, `test:watch`, `test:coverage` added |

## Flags

Both `setup` and `test` support the following flags:

| Flag | Description |
|------|-------------|
| `--yes` | Non-interactive mode; skips all prompts and uses defaults (all tools, Vitest, kebab-case) |
| `--tools <csv>` | Comma-separated list of tools to configure, used with `--yes` (e.g. `--tools eslint,prettier,husky`) |
| `--dry-run` | Runs the full pipeline but writes no files and executes no commands |

## License

ISC
