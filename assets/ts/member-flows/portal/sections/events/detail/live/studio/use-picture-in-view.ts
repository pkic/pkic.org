import type { RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";

/** How far outside the visible area a picture is already drawn, so it is there when it scrolls in. */
const AHEAD = "160px";

/**
 * Whether a picture of an output is in view, or about to be. Each picture
 * draws the whole broadcast frame, so one that is scrolled out of sight, such
 * as a monitor further down a phone's view or a scene at the far end of the
 * strip, is not drawn until it comes near. Without a way to tell, every
 * picture is drawn.
 */
export function usePictureInView(picture: RefObject<HTMLElement>): boolean {
  const [inView, setInView] = useState(() => typeof IntersectionObserver !== "function");
  useEffect(() => {
    const node = picture.current;
    if (!node || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const latest = entries.at(-1);
        if (latest) setInView(latest.isIntersecting);
      },
      { rootMargin: AHEAD },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [picture]);
  return inView;
}
