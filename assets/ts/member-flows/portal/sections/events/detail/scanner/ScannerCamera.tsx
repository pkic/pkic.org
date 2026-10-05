import type { RefObject } from "preact";
export function ScannerCamera({
  video,
  cameraActive,
  fastMode,
  preview,
}: {
  video: RefObject<HTMLVideoElement>;
  cameraActive: boolean;
  fastMode: boolean;
  preview: boolean;
}) {
  return (
    <video
      ref={video}
      hidden={!cameraActive || (fastMode && !preview)}
      muted
      playsInline
      className={`pk-event-scanner__camera${fastMode ? " pk-event-scanner__camera--fast" : ""}`}
      aria-label="Badge camera preview"
    />
  );
}
