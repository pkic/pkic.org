import { useMediaQuery } from "../../../../../../hooks/useMediaQuery";
import { ScannerTaskNavigation } from "./ScannerTaskNavigation";
import { useContext, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { enterScannerFullscreen } from "./immersive-scanner";

/** Camera presentation is temporary UI state, independent of the scan role and capture lifetime. */
export function useScannerPresentation(
  shell: RefObject<HTMLDivElement>,
  initial: "fullscreen" | "embedded" | "responsive" = "fullscreen",
) {
  const navigation = useContext(ScannerTaskNavigation);
  const mobile = useMediaQuery("(max-width: 48rem), (pointer: coarse)");
  const [presentation, setPresentation] = useState<"fullscreen" | "embedded">(() =>
    navigation?.launch ? "fullscreen" : initial === "responsive" ? (mobile ? "fullscreen" : "embedded") : initial,
  );
  const enter = () => {
    if (presentation === "fullscreen" && shell.current) enterScannerFullscreen(shell.current);
  };
  const toggle = () => {
    if (presentation === "embedded" && shell.current) enterScannerFullscreen(shell.current);
    setPresentation(presentation === "fullscreen" ? "embedded" : "fullscreen");
  };
  return { presentation, setPresentation, enter, toggle };
}
