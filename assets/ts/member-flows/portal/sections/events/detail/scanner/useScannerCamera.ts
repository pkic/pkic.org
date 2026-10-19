import { useRef, useState } from "preact/hooks";
import { openBadgeCamera } from "./camera-driver";
import { ScanFrameGate } from "./scan-stream";

/**
 * The badge camera's lifecycle: one stream at a time, opened into the scanner's video element,
 * with repeated frames of the same code suppressed before they reach the capture.
 */
export function useScannerCamera(onCode: (raw: string) => void) {
  const video = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const stopStream = useRef<() => void>(() => {});
  const frames = useRef(new ScanFrameGate());
  const capture = useRef(onCode);
  capture.current = onCode;
  const stop = () => stopStream.current();
  async function start() {
    try {
      if (!video.current) return;
      stop();
      setStarting(true);
      setError("");
      frames.current.clear();
      await openBadgeCamera(
        video.current,
        (raw) => capture.current(raw),
        setActive,
        (release) => {
          stopStream.current = release;
        },
      );
    } catch {
      stop();
      setActive(false);
      setError("Camera access is unavailable. Retry the camera, use a connected reader, or paste a badge code.");
    } finally {
      setStarting(false);
    }
  }
  return {
    video,
    active,
    starting,
    error,
    start,
    stop,
    /** Whether a decoded frame is a new read rather than the same badge still in view. */
    acceptsFrame: (badgeId: string) => frames.current.accept(badgeId, Date.now()),
  };
}
