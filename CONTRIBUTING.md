# Contributing to volt-fast

Thanks for your interest in improving volt-fast. This document covers how to set up the project, the conventions the codebase follows, and how to get a change merged.

## Getting started

```bash
git clone https://github.com/<your-fork>/custom-cli-tools.git
cd custom-cli-tools
pnpm install
```

Useful commands (see [CLAUDE.md](CLAUDE.md) for full architecture notes):

```bash
pnpm build           # compile TypeScript to dist/
pnpm test            # run the Vitest suite
pnpm test:watch      # Vitest in watch mode
pnpm test:coverage   # coverage report
pnpm typecheck       # tsc --noEmit
```

Try the CLI locally against a scratch project:

```bash
pnpm build
node dist/cli.js setup /path/to/some/project --dry-run
```

## Before you start

For anything beyond a small fix (new flag, new generator, behavior change), open an issue first describing what you want to do. This avoids duplicate work and lets us agree on the approach before you write code.

## Making a change

1. Fork the repo and create a branch off `main`: `git checkout -b feat/short-description`
2. Keep the change focused — one logical change per PR
3. Follow the existing patterns in `src/generators/` and `src/utils/` (see [CLAUDE.md](CLAUDE.md) for the architecture map and hard constraints, e.g. ESLint flat-config only, commitlint opt-in, husky init ordering)
4. Add or update tests under `tests/` for any behavior change — `calculateDependencies`, `calculateTestDependencies`, and the generators are pure functions and should be unit tested directly
5. Run `pnpm typecheck` and `pnpm test` locally before opening a PR
6. Husky hooks run lint-staged and commitlint on commit — commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, etc.)

## Pull requests

- Fill out the PR template
- Link the issue it resolves, if any
- Make sure CI (`typecheck`, `test`, `build`) passes — it runs automatically on every PR
- A maintainer will review and may ask for changes; once approved, it'll be squash-merged

## Reporting bugs / requesting features

Use the GitHub issue templates (Bug report / Feature request). Include repro steps, expected vs. actual behavior, and your environment (OS, Node version, package manager) for bugs.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Be respectful.
