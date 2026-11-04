import { useEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { scannerImmersiveLifecycle } from "./immersive-scanner";

/** Restore camera, pacing and focus consistently when fullscreen or the immersive view ends. */
export function useScannerImmersiveLifecycle(
  active: boolean,
  shell: RefObject<HTMLDivElement>,
  exit: () => void,
  releaseCapture: () => void,
) {
  const latest = useRef({ exit, releaseCapture });
  latest.current = { exit, releaseCapture };
  const [screenAwake, setScreenAwake] = useState(false);
  useEffect(() => {
    if (!active || !shell.current) return;
    const release = scannerImmersiveLifecycle(shell.current, () => latest.current.exit(), setScreenAwake);
    return () => {
      latest.current.releaseCapture();
      release();
    };
  }, [active, shell]);
  return screenAwake;
}
