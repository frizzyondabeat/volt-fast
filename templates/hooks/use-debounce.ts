import { useEffect, useState } from 'react';

/**
 * @description
 * This hook is used to debounce the value passed to it.
 * @example
 * const [searchValue, setSearchValue] = useState<string>('');
 *
 * const debouncedSearchValue = useDebounce(searchValue, 300);
 * 
 * // debouncedSearchValue will only update after 300ms of no input
 *
 * @returns {any} debouncedValue:T
 * @param value - The value to debounce, can be of any type.
 * @param delay - The delay in milliseconds for the debounce effect, default is 500ms.
 */
export const useDebounce = <T>(value: T, delay: number = 500): T => {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
};
