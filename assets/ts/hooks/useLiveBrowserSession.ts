import { useEffect, useState } from "preact/hooks";
/** Sensitive live views unmount while the browser is offline or hidden and revalidate on return. */
export function useLiveBrowserSession() {
  const [state, setState] = useState(() => ({
    live: navigator.onLine && document.visibilityState !== "hidden",
    epoch: 0,
  }));
  useEffect(() => {
    const changed = () =>
      setState((value) => ({
        live: navigator.onLine && document.visibilityState !== "hidden",
        epoch: value.epoch + 1,
      }));
    window.addEventListener("focus", changed);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    document.addEventListener("visibilitychange", changed);
    return () => {
      window.removeEventListener("focus", changed);
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
      document.removeEventListener("visibilitychange", changed);
    };
  }, []);
  return state;
}
