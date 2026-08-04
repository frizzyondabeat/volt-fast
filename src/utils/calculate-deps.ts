/**
 * Computes the list of packages to install given the user's selected tools
 * and the project's auto-detected toolchain.
 *
 * Pure function — no I/O, fully unit-testable.
 */
export function calculateDependencies(
  selectedTools: string[],
  detectedTools: string[]
): string[] {
  const deps: string[] = [];

  if (selectedTools.includes('tailwind')) {
    deps.push('tailwindcss');
    if (detectedTools.includes('vite')) {
      deps.push('@tailwindcss/vite');
    }
  }

  if (selectedTools.includes('eslint')) {
    deps.push(
      // Pinned below eslint@10: eslint-plugin-react's latest release
      // (7.37.5) declares a peerDependency ceiling of eslint@^9.7 and
      // crashes at lint-time on eslint@10 (removed `context.getFilename()`).
      // Bump this once eslint-plugin-react ships v10 support.
      'eslint@^9',
      '@eslint/js',
      // Pinned to the major version whose flat-config export shape the
      // generated eslint.config.mjs is written against (configs.flat.*
      // being single objects, not arrays; configs.flat['jsx-runtime'] and
      // configs.flat['recommended-latest'] existing at all). An unpinned
      // install would silently pick up a future major release that
      // reshapes these exports again — exactly what eslint-plugin-react-
      // hooks already did once (splitting legacy configs[...] from the
      // newer configs.flat[...]) — and break generated configs with no
      // warning. Bump the floor alongside any generator change that
      // depends on a newer shape.
      'eslint-plugin-react@^7.37',
      'eslint-plugin-react-hooks@^7.1',
      'eslint-plugin-check-file'
    );
    if (detectedTools.includes('typescript')) {
      deps.push('typescript-eslint');
    }
    if (detectedTools.includes('nextjs')) {
      deps.push('@next/eslint-plugin-next');
    }
    if (selectedTools.includes('prettier')) {
      deps.push('eslint-config-prettier');
    }
  }

  if (selectedTools.includes('prettier')) {
    deps.push('prettier', '@trivago/prettier-plugin-sort-imports');
    if (
      selectedTools.includes('tailwind') ||
      detectedTools.includes('tailwind')
    ) {
      deps.push('prettier-plugin-tailwindcss');
    }
  }

  if (selectedTools.includes('husky')) {
    deps.push('husky');
  }

  if (selectedTools.includes('commitlint')) {
    deps.push('@commitlint/cli', '@commitlint/config-conventional');
  }

  return deps;
}
