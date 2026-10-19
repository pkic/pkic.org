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
      aria-hidden={!cameraActive || (fastMode && !preview)}
      muted
      playsInline
      className={`pk-event-scanner__camera${fastMode ? " pk-event-scanner__camera--fast" : ""}${!cameraActive || (fastMode && !preview) ? " pk-event-scanner__camera--concealed" : ""}`}
      aria-label="Badge camera preview"
    />
  );
}
