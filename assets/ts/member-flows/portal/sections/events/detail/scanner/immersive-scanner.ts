import { screenWakeLock } from "../../../../../../shared/screen-wake-lock";

/** Fullscreen is progressive enhancement; the fixed viewport works on iOS too. */
export function enterScannerFullscreen(element: HTMLElement) {
  void element.requestFullscreen?.().catch(() => {});
}

export function scannerImmersiveLifecycle(
  element: HTMLElement,
  onExit: () => void,
  onAwake: (awake: boolean) => void = () => {},
) {
  const wakeLock = screenWakeLock(onAwake);
  onAwake(false);
  // Native document scrolling remains disabled while the scanner owns the viewport.
  document.body.classList.add("pk-scanner-immersive");
  const visibility = () => {
    if (document.visibilityState !== "visible") {
      wakeLock.release();
      onExit();
    }
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape") onExit();
  };
  // Permission prompts can end native fullscreen. The fixed immersive viewport
  // remains active until an explicit exit or the document becomes hidden.
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("keydown", escape);
  void wakeLock.acquire();
  return () => {
    wakeLock.dispose();
    document.body.classList.remove("pk-scanner-immersive");
    document.removeEventListener("visibilitychange", visibility);
    document.removeEventListener("keydown", escape);
    if (document.fullscreenElement === element) void document.exitFullscreen?.().catch(() => {});
  };
}
