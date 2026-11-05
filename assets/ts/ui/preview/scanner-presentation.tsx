import { useEffect, useRef, useState } from "preact/hooks";
import { FastScannerView } from "../../member-flows/portal/sections/events/detail/scanner/FastScannerView";
import { scannerImmersiveLifecycle } from "../../member-flows/portal/sections/events/detail/scanner/immersive-scanner";
import { useHashQueryParam } from "../../hooks/useHashQueryParam";
import type { PreviewSection } from "./PreviewShell";

function ScannerPresentationExample() {
  const [presentation, setPresentation] = useHashQueryParam("scannerView", "embedded", ["embedded", "fullscreen"]);
  const [role] = useHashQueryParam("scannerRole", "scan", ["scan", "print", "lead"]);
  const [preview, setPreview] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (presentation === "fullscreen" && shell.current)
      return scannerImmersiveLifecycle(shell.current, () => setPresentation("embedded"));
  }, [presentation, setPresentation]);
  return (
    <div ref={shell}>
      <FastScannerView
        presentation={presentation}
        purpose={role === "print" ? "print" : "scan"}
        mode={role === "lead" ? "lead" : "attendance"}
        context={role === "lead" ? "Sponsor leads" : role === "print" ? "Badge printing" : "Venue entrance"}
        result={null}
        pending={0}
        message="Ready to scan"
        cameraActive
        preview={preview}
        onPreview={() => setPreview((value) => !value)}
        onExit={() => setPresentation("embedded")}
        onPresentation={() => setPresentation(presentation === "fullscreen" ? "embedded" : "fullscreen")}
        canRecordAttendance={role === "scan"}
      />
    </div>
  );
}
export const scannerPresentationSection: PreviewSection = {
  id: "scanner-presentation",
  title: "Shared scanner views",
  render: () => <ScannerPresentationExample />,
};
