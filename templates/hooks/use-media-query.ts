import { useState, useEffect } from 'react';

/**
 * @description
 * This hook is useful for tracking the media query matches.
 * @param query The media query string to track.
 * @returns A boolean value indicating whether the media query matches.
 * @example
 * const matches = useMediaQuery('(min-width: 768px)');
 * console.log(matches);
 // true
 */
const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);

    const handleMediaQueryChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };
    mediaQuery.addEventListener('change', handleMediaQueryChange);
    setMatches(mediaQuery.matches);

    return () => {
      mediaQuery.removeEventListener('change', handleMediaQueryChange);
    };
  }, [query]);

  return matches;
};

export { useMediaQuery };
