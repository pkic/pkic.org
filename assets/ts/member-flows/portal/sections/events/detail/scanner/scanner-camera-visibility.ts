/** Pause camera capture in the background and resume after the device wakes. */
export function watchScannerCameraVisibility(resume: () => void, pause: () => void): () => void {
  let backgrounded = document.visibilityState === "hidden";
  const hidden = () => {
    backgrounded = true;
    pause();
  };
  const visible = () => {
    if (document.visibilityState !== "visible" || !backgrounded) return;
    backgrounded = false;
    resume();
  };
  const pageShown = (event: PageTransitionEvent) => {
    if (event.persisted) backgrounded = true;
    visible();
  };
  const visibilityChanged = () => {
    if (document.visibilityState === "hidden") hidden();
    else visible();
  };
  document.addEventListener("visibilitychange", visibilityChanged);
  window.addEventListener("pagehide", hidden);
  window.addEventListener("pageshow", pageShown);
  window.addEventListener("focus", visible);
  return () => {
    document.removeEventListener("visibilitychange", visibilityChanged);
    window.removeEventListener("pagehide", hidden);
    window.removeEventListener("pageshow", pageShown);
    window.removeEventListener("focus", visible);
  };
}
