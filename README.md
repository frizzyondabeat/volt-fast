# @frizzyondabeat/volt-fast

A fast interactive CLI to scaffold frontend tooling and starter config files into an existing project.

## Features

- Detects project context (Next.js and TypeScript)
- Installs selected tooling dependencies for your package manager
- Generates ready-to-use config files for:
  - Tailwind CSS
  - Prettier
  - ESLint
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
- `tailwind.config.cjs`
- `postcss.config.cjs`
- Tailwind CSS entry file (default: `./src/styles.css`)
- `./hooks/*` custom hooks (when enabled)

It also installs relevant dev dependencies in the target project.

## Typical Flow

1. Choose target project directory
2. Confirm file overwrite warning
3. Select tools (Tailwind, ESLint, Prettier)
4. Optionally choose Tailwind CSS output path
5. Optionally include custom hooks
6. Confirm dependency install command
7. CLI installs packages and writes files

## Development

Install dependencies:

```bash
pnpm install
```

Build:

```bash
pnpm build
```

Run local build:

```bash
node dist/cli.js --help
node dist/cli.js setup
```

## Publish

Dry-run package contents:

```bash
npm pack --dry-run
```

Publish manually:

```bash
npm publish --access public --provenance
```

This repo also includes GitHub Actions workflows for CI and publish automation.

## Notes

- Publishing requires a valid npm token with publish permission
- CI publish is guarded to avoid republishing an existing version
- Bump `package.json` version before expecting a new release

## License

ISC
