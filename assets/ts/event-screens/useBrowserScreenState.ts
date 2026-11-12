import { useEffect, useState } from "preact/hooks";
import type { BrowserScreen } from "./browser-screen";

type BrowserScreenSource = Pick<BrowserScreen, "get" | "problems" | "subscribe">;

const read = (browser: BrowserScreenSource | null) =>
  browser ? { state: browser.get(), problems: browser.problems() } : { state: null, problems: [] };

/** A browser screen's grants and the last click's refusals, as they change; nothing on a device. */
export function useBrowserScreenState(browser: BrowserScreenSource | null) {
  const [current, setCurrent] = useState(() => read(browser));
  useEffect(() => {
    setCurrent(read(browser));
    return browser?.subscribe(() => setCurrent(read(browser)));
  }, [browser]);
  return current;
}
