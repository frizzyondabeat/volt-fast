import type { FilenameConvention } from '../generators/types.js';

/** Split a filename into the convertible basename and the untouched rest
 * (everything from the first dot onward — mirrors eslint-plugin-check-file's
 * `ignoreMiddleExtensions`, so `foo.test.tsx` keeps `.test.tsx` untouched). */
function splitFirstExtension(filename: string): { base: string; rest: string } {
  const dotIndex = filename.indexOf('.');
  if (dotIndex <= 0) return { base: filename, rest: '' };
  return { base: filename.slice(0, dotIndex), rest: filename.slice(dotIndex) };
}

function tokenize(base: string): string[] {
  const withBoundaries = base
    // acronym followed by a new capitalized word: XMLParser -> XML|Parser
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    // lower/digit followed by uppercase: myComponent -> my-Component
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2');

  return withBoundaries
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

export function toKebabCase(name: string): string {
  return tokenize(name).join('-');
}

export function toSnakeCase(name: string): string {
  return tokenize(name).join('_');
}

export function toCamelCase(name: string): string {
  const [first, ...rest] = tokenize(name);
  if (!first) return '';
  return (
    first +
    rest.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join('')
  );
}

export function toPascalCase(name: string): string {
  return tokenize(name)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join('');
}

const CONVERTERS: Record<FilenameConvention, (name: string) => string> = {
  KEBAB_CASE: toKebabCase,
  SNAKE_CASE: toSnakeCase,
  CAMEL_CASE: toCamelCase,
  PASCAL_CASE: toPascalCase,
};

/** Converts a filename's basename to the given convention, leaving any
 * middle/final extension (everything from the first dot on) untouched. */
export function convertBasename(
  filename: string,
  convention: FilenameConvention
): string {
  const { base, rest } = splitFirstExtension(filename);
  return CONVERTERS[convention](base) + rest;
}
