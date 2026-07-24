"use client";

import { useCallback, useMemo } from "react";
import type { RefObject } from "react";

/**
 * Abstraction over "the global custom cursor element". Prefers an explicit
 * `cursorRef` (owned by whatever component actually renders the cursor) and
 * only falls back to `document.getElementById(fallbackId)` when no ref is
 * supplied, so callers can opt out of the hard DOM-id dependency entirely.
 *
 * Exposes granular add/removeClass (not a single exclusive state setter) on
 * purpose: the call sites toggle "drag" and "hover" independently, and a
 * mouseleave firing mid-drag should not be able to clear the "drag" class —
 * collapsing this into a tri-state setter would change that edge case.
 */
export function useCursorState(
  cursorRef?: RefObject<HTMLElement | null>,
  fallbackId: string = "cursor",
) {
  const resolve = useCallback((): HTMLElement | null => {
    return cursorRef?.current ?? document.getElementById(fallbackId);
  }, [cursorRef, fallbackId]);

  const addClass = useCallback(
    (className: string) => {
      resolve()?.classList.add(className);
    },
    [resolve],
  );

  const removeClass = useCallback(
    (className: string) => {
      resolve()?.classList.remove(className);
    },
    [resolve],
  );

  // Memoized so callers can safely put `cursor` itself in a dependency
  // array without causing effects to re-subscribe on every render.
  return useMemo(() => ({ addClass, removeClass }), [addClass, removeClass]);
}
