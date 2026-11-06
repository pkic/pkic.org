import { useEffect, useRef, useState } from "preact/hooks";
/** Manual capture owns focus and reader pause without leaving the immersive scanner. */
export function useScannerManualEntry(
  immersive: boolean,
  pause: () => void,
  resume: () => void,
  recentVisible = false,
) {
  const [open, setOpen] = useState(false),
    [focusRequested, setFocusRequested] = useState(false);
  const paused = useRef(false);
  const lifecycle = useRef({ pause, resume });
  lifecycle.current = { pause, resume };
  const wasRecent = useRef(false);
  useEffect(() => {
    const returning = wasRecent.current && !recentVisible;
    wasRecent.current = recentVisible;
    if (recentVisible) {
      lifecycle.current.pause();
      paused.current = true;
    } else if (returning && !open) {
      paused.current = false;
      if (immersive) lifecycle.current.resume();
    }
  }, [recentVisible, immersive, open]);
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
