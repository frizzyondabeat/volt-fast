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
- [Command](#command)
- [What It Generates](#what-it-generates)
- [Typical Flow](#typical-flow)
- [License](#license)

## Features

- Detects project context (Next.js, Vite, and TypeScript)
- Installs selected tooling dependencies for your package manager
- Generates ready-to-use config files for:
  - Tailwind CSS
  - Prettier
  - ESLint
- Optionally initializes Shadcn UI with alias configuration
- Optionally copies custom hooks from the built-in templates
- Safe interactive flow with confirmations and cancellation handling

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

## Command

```bash
volt-fast setup [projectdir]
```

- `projectdir` is optional
- If omitted, the CLI prompts for the target directory

## What It Generates

Depending on your selections, the CLI creates or updates:

- `.eslintrc.cjs`
- `prettier.config.cjs`
- `postcss.config.cjs`
- Tailwind CSS entry file (default: `./src/styles.css`)
- `tsconfig.json` alias config for `@/*` (when Shadcn is enabled)
- `tsconfig.app.json` alias config for `@/*` in Vite projects
- `vite.config.ts` or `vite.config.js` with `vite-tsconfig-paths` in Vite projects
- `./hooks/*` custom hooks (when enabled)

It also installs relevant dependencies in the target project and can run `shadcn init`.

## Typical Flow

1. Choose target project directory
2. Confirm file overwrite warning
3. Select tools (Tailwind, ESLint, Prettier, Shadcn UI)
4. Optionally choose Tailwind CSS output path
5. Optionally include custom hooks
6. Confirm dependency install command
7. CLI installs packages and writes files
8. When selected, CLI configures aliases and runs Shadcn UI initialization

## License

ISC
