import { useEffect, useRef } from "react";

/**
 * @description
 * This hook is useful for triggering actions when a user clicks outside a specific element.
 * It can be used to close dropdown menus, modals, or other UI components when the user clicks outside of them.
 * @param callback The callback function to be executed when a click is detected outside the element.
 * @returns A React ref object that can be attached to the element to be monitored.
 * @example
 * const ref = useClickOutside(() => {
 *   console.log("Click outside detected");
 * });
 * <div ref={ref}>
 *   <p>Click outside to trigger the callback</p>
 * </div>
 */
const useClickOutside = (callback: () => void) => {
    const ref = useRef<HTMLDivElement>(null);

    const handleClickOutside = (event: MouseEvent) => {
        if (ref.current && !ref.current.contains(event.target as Node)) {
            callback();
        }
    };

    useEffect(() => {
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    return ref;
};

export default useClickOutside;
