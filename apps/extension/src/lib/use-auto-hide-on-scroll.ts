import { useEffect, useRef, useState } from "react";

/** Ignore sub-pixel/momentum jitter so a stationary trackpad-scroll
 *  doesn't flicker the bar. */
const SCROLL_DELTA_THRESHOLD_PX = 6;
/** Always show the bar within this many px of the top — nothing to
 *  hide from yet, and it avoids a flash-hide on initial mount. */
const TOP_GUARD_PX = 8;
/** Reappear this long after the user stops scrolling, regardless of
 *  direction — matches the "natural" show-on-idle behavior of
 *  mobile Safari / most native app bars. */
const IDLE_REVEAL_DELAY_MS = 500;

/**
 * Hides a sticky bar while the user scrolls down through content and
 * reveals it again on scroll-up or once scrolling goes idle.
 *
 * Pass the ref of the SCROLLING element (the one with overflow-y-auto).
 * The bar itself should be a `position: sticky; top: 0` child of that
 * element, translated by this hook's return value — that way hiding
 * it never reflows layout or causes content to jump.
 */
export function useAutoHideOnScroll<T extends HTMLElement>(
  scrollRef: React.RefObject<T | null>
): boolean {
  const [visible, setVisible] = useState(true);
  const lastScrollTop = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    lastScrollTop.current = el.scrollTop;

    const clearIdleTimer = () => {
      if (idleTimer.current !== null) {
        clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
    };

    const handleScroll = () => {
      if (frame.current !== null) return;

      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const current = el.scrollTop;
        const delta = current - lastScrollTop.current;

        if (current <= TOP_GUARD_PX) {
          setVisible(true);
        } else if (delta > SCROLL_DELTA_THRESHOLD_PX) {
          setVisible(false);
        } else if (delta < -SCROLL_DELTA_THRESHOLD_PX) {
          setVisible(true);
        }

        lastScrollTop.current = current;

        clearIdleTimer();
        idleTimer.current = setTimeout(() => setVisible(true), IDLE_REVEAL_DELAY_MS);
      });
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
      clearIdleTimer();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
    // Re-attach only if the element identity changes (e.g. section swap
    // unmounts/remounts the scroll container).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef.current]);

  return visible;
}
