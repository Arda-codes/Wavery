import { useEffect, useState } from "react";

/**
 * Tailwind's `sm` breakpoint is 640px, so "mobile" is everything below it.
 * Mirrors the CSS-only `sm:hidden` gating used across the app, but for
 * component-level mounting decisions where two alternative surfaces
 * (desktop FullscreenPlayer vs mobile Now Playing sheet) must never
 * coexist.
 */
const MOBILE_QUERY = "(max-width: 639px)";

/**
 * Subscribes to the mobile breakpoint via matchMedia.
 * Returns true while the viewport is narrower than the `sm` breakpoint.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia &&
      window.matchMedia(MOBILE_QUERY).matches
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    // Re-sync in case the initial state was computed before hydration.
    setIsMobile(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
