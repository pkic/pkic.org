/** Fullscreen is progressive enhancement; the fixed viewport works on iOS too. */
export function enterScannerFullscreen(element: HTMLElement) {
  void element.requestFullscreen?.().catch(() => {});
}

export function scannerImmersiveLifecycle(element: HTMLElement, onExit: () => void) {
  let disposed = false;
  let wakeLock: WakeLockSentinel | undefined;
  // Native document scrolling remains disabled while the scanner owns the viewport.
  document.body.classList.add("pk-scanner-immersive");
  const acquire = async () => {
    try {
      const lock = await navigator.wakeLock?.request("screen");
      if (disposed) await lock?.release();
      else wakeLock = lock;
    } catch {
      /* Screen wake lock is optional. */
    }
  };
  const visibility = () => {
    if (document.visibilityState !== "visible") onExit();
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape") onExit();
  };
  let enteredNativeFullscreen = document.fullscreenElement === element;
  const fullscreen = () => {
    if (document.fullscreenElement === element) enteredNativeFullscreen = true;
    else if (enteredNativeFullscreen) onExit();
  };
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("keydown", escape);
  document.addEventListener("fullscreenchange", fullscreen);
  void acquire();
  return () => {
    disposed = true;
    document.body.classList.remove("pk-scanner-immersive");
    document.removeEventListener("visibilitychange", visibility);
    document.removeEventListener("keydown", escape);
    document.removeEventListener("fullscreenchange", fullscreen);
    void wakeLock?.release().catch(() => {});
    if (document.fullscreenElement === element) void document.exitFullscreen?.().catch(() => {});
  };
}
