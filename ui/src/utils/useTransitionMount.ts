import { useState, useEffect, useRef } from "react";

/**
 * Hook for managing enter and exit transitions for modals, popovers, and menus.
 * Keeps the component mounted while an exit transition completes, preventing abrupt 0ms unmounts.
 *
 * @param isOpen Whether the element should be visible
 * @param exitDurationMs Duration in milliseconds to wait before unmounting (default: 160ms)
 * @returns `{ isRendered, isExiting }`
 */
export function useTransitionMount(isOpen: boolean, exitDurationMs: number = 160): {
  isRendered: boolean;
  isExiting: boolean;
} {
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isExiting, setIsExiting] = useState(false);
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (exitTimeoutRef.current !== null) {
        clearTimeout(exitTimeoutRef.current);
        exitTimeoutRef.current = null;
      }
      setIsRendered(true);
      setIsExiting(false);
    } else if (isRendered) {
      setIsExiting(true);
      exitTimeoutRef.current = setTimeout(() => {
        setIsRendered(false);
        setIsExiting(false);
        exitTimeoutRef.current = null;
      }, exitDurationMs);
    }

    return () => {
      if (exitTimeoutRef.current !== null) {
        clearTimeout(exitTimeoutRef.current);
      }
    };
  }, [isOpen, isRendered, exitDurationMs]);

  return { isRendered, isExiting };
}
