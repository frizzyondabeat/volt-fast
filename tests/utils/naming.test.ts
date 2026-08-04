import { describe, expect, it } from 'vitest';
import {
  convertBasename,
  toCamelCase,
  toKebabCase,
  toPascalCase,
  toSnakeCase,
} from '../../src/utils/naming.js';

describe('case converters', () => {
  it('converts to kebab-case', () => {
    expect(toKebabCase('MyComponent')).toBe('my-component');
    expect(toKebabCase('myComponent')).toBe('my-component');
    expect(toKebabCase('my_component')).toBe('my-component');
    expect(toKebabCase('my-component')).toBe('my-component');
    expect(toKebabCase('XMLParser')).toBe('xml-parser');
  });

  it('converts to PascalCase', () => {
    expect(toPascalCase('my-component')).toBe('MyComponent');
    expect(toPascalCase('myComponent')).toBe('MyComponent');
    expect(toPascalCase('my_component')).toBe('MyComponent');
  });

  it('converts to camelCase', () => {
    expect(toCamelCase('my-component')).toBe('myComponent');
    expect(toCamelCase('MyComponent')).toBe('myComponent');
    expect(toCamelCase('my_component')).toBe('myComponent');
  });

  it('converts to snake_case', () => {
    expect(toSnakeCase('MyComponent')).toBe('my_component');
    expect(toSnakeCase('my-component')).toBe('my_component');
  });

  it('is idempotent for every convention', () => {
    const input = 'MyComponent_test-Thing';
    for (const fn of [toKebabCase, toPascalCase, toCamelCase, toSnakeCase]) {
      const once = fn(input);
      expect(fn(once)).toBe(once);
    }
  });
});

describe('convertBasename', () => {
  it('preserves everything from the first dot onward (middle extensions)', () => {
    expect(convertBasename('MyComponent.test.tsx', 'KEBAB_CASE')).toBe(
      'my-component.test.tsx'
    );
    expect(convertBasename('MyStyle.module.css', 'KEBAB_CASE')).toBe(
      'my-style.module.css'
    );
  });

  it('handles a plain single extension', () => {
    expect(convertBasename('MyComponent.tsx', 'KEBAB_CASE')).toBe('my-component.tsx');
    expect(convertBasename('my-component.tsx', 'PASCAL_CASE')).toBe('MyComponent.tsx');
  });

  it('leaves already-conformant names unchanged', () => {
    expect(convertBasename('my-component.tsx', 'KEBAB_CASE')).toBe('my-component.tsx');
    expect(convertBasename('MyComponent.tsx', 'PASCAL_CASE')).toBe('MyComponent.tsx');
  });

  it('handles dotfiles without throwing', () => {
    expect(convertBasename('.env', 'KEBAB_CASE')).toBe('.env');
  });
});
