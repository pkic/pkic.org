import { useRef } from "preact/hooks";

/** Session transitions stop capture and discard any queued launch gesture. */
export function useScannerCapturePause(stopCamera: () => void, cancelStart: () => void) {
  const paused = useRef(false);
  function setPaused(value: boolean) {
    paused.current = value;
  }
  function pauseSession(value: boolean) {
    if (value) {
      stopCamera();
      cancelStart();
    }
    setPaused(value);
  }
  return { paused, setPaused, pauseSession };
}
