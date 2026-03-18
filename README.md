# @frizzyondabeat/volt-fast

<p align="center">
  <img src="./assets/voltfast.png" alt="Volt Fast logo" width="420" />
</p>

A fast interactive CLI to scaffold frontend tooling and starter config files into an existing project.

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
