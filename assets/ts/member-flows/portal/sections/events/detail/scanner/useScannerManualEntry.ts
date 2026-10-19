import { useRef, useState } from "preact/hooks";
/** Manual capture owns focus and reader pause without leaving the immersive scanner. */
export function useScannerManualEntry(immersive: boolean, pause: () => void, resume: () => void) {
  const [open, setOpen] = useState(false),
    [focusRequested, setFocusRequested] = useState(false);
  const paused = useRef(false);
  function reset() {
    paused.current = false;
    setOpen(false);
    setFocusRequested(false);
  }
  function show() {
    pause();
    paused.current = immersive;
    setOpen(true);
    setFocusRequested(true);
  }
  function hide() {
    reset();
    if (immersive) resume();
  }
  return { open, setOpen, focusRequested, setFocusRequested, paused, reset, show, hide };
}
