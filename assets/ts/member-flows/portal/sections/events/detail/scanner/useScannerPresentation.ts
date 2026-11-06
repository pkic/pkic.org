import { ScannerTaskNavigation } from "./ScannerTaskNavigation";
import { useContext, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { enterScannerFullscreen } from "./immersive-scanner";

/** Camera presentation is temporary UI state, independent of the scan role and capture lifetime. */
export function useScannerPresentation(
  shell: RefObject<HTMLDivElement>,
  initial: "fullscreen" | "embedded" = "fullscreen",
) {
  const navigation = useContext(ScannerTaskNavigation);
  const [presentation, setPresentation] = useState(() => (navigation?.launch ? "fullscreen" : initial));
  const enter = () => {
    if (presentation === "fullscreen" && shell.current) enterScannerFullscreen(shell.current);
  };
  const toggle = () => {
    if (presentation === "embedded" && shell.current) enterScannerFullscreen(shell.current);
    setPresentation(presentation === "fullscreen" ? "embedded" : "fullscreen");
  };
  return { presentation, setPresentation, enter, toggle };
}
