import { useEffect, useState } from "preact/hooks";

/** Follow a media query without assuming a browser during server rendering. */
export function useMediaQuery(query: string): boolean {
  const available = () => typeof window !== "undefined" && typeof window.matchMedia === "function";
  const [matches, setMatches] = useState(() => available() && window.matchMedia(query).matches);
  useEffect(() => {
    if (!available()) return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}
