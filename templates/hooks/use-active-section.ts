import { useEffect, useState } from 'react';

type Item = { href: string };

/**
 * @description
 * This hook is useful for tracking the active section of a page.
 * It can be used to highlight the current section or update the URL when the user scrolls to a new section.
 * @param items An array of items with href properties, each pointing to a section of the page.
 * @returns An object containing the active section ID and a function to set it.
 */
export function useActiveSection(items: Item[]) {
  const [activeId, setActiveId] = useState('introduction');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: '0px 0px -70% 0px',
        threshold: [0.1, 0.5, 1],
      }
    );

    const elements = items
      .map((item) => {
        const id = item.href.split('#')[1];
        return document.getElementById(id);
      })
      .filter(Boolean) as HTMLElement[];

    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [items]);

  return { activeId, setActiveId };
}
