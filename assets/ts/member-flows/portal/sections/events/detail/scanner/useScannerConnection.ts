import { useEffect, useState } from "preact/hooks";

/** Connectivity is a hint; only a durable upload receipt establishes synchronization. */
export function useScannerConnection() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
