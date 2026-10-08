import { useLayoutEffect, useRef } from "preact/hooks";
/** A keyboard scanner follows the current target without restarting its listener. */
export function useScannerHardware(enabled: boolean, onBadge: (credential: string) => void) {
  const handler = useRef(onBadge);
  handler.current = onBadge;
  useLayoutEffect(() => {
    if (!enabled) return;
    let credential = "";
    let previous = 0;
    const hardware = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (Date.now() - previous > 5000) credential = "";
      previous = Date.now();
      if (event.key === "Enter" && credential) {
        event.preventDefault();
        handler.current(credential);
        credential = "";
      } else if (event.key.length === 1 && event.key !== " ") {
        event.preventDefault();
        credential = (credential + event.key).slice(-128);
      }
    };
    document.addEventListener("keydown", hardware);
    return () => document.removeEventListener("keydown", hardware);
  }, [enabled]);
}
