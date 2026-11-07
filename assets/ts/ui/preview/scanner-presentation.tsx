import { ScannerRecentScans } from "../../member-flows/portal/sections/events/detail/scanner/ScannerRecentScans";
import { useScannerAudio } from "../../member-flows/portal/sections/events/detail/scanner/useScannerAudio";
import { eventScanResponseSchema, type EventScanResponse } from "../../../shared/schemas/event-participation-scanning";
import { ScannerDestinationTiles } from "../../member-flows/portal/sections/events/detail/scanner/ScannerDestinationTiles";
import "../../member-flows/portal/sections/events/detail/scanner/EventScanner.css";
import { useEffect, useRef, useState } from "preact/hooks";
import { FastScannerView } from "../../member-flows/portal/sections/events/detail/scanner/FastScannerView";
import { scannerImmersiveLifecycle } from "../../member-flows/portal/sections/events/detail/scanner/immersive-scanner";
import { useHashQueryParam } from "../../hooks/useHashQueryParam";
import type { PreviewSection } from "./PreviewShell";

function ScannerPresentationExample() {
  const [presentation, setPresentation] = useState<"embedded" | "fullscreen">("embedded");
  const [role] = useHashQueryParam("scannerRole", "scan", ["scan", "exit", "session", "print", "lead"]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const audio = useScannerAudio(soundEnabled, role === "scan" ? "entry" : role);
  const [feedback] = useHashQueryParam("scannerFeedback", "ready", [
    "ready",
    "eligible",
    "warning",
    "denied",
    "unverified",
    "unknown",
  ]);
  const messages = {
    ready: "Scan an attendee’s badge.",
    eligible: "Ready for the next attendee.",
    warning: "This attendee is not registered here.",
    denied: "This badge has been revoked.",
    unverified: "Saved for verification when connected.",
    unknown: "This code was not recognized.",
  };
  const result: EventScanResponse | null =
    feedback === "ready" || role === "print"
      ? null
      : eventScanResponseSchema.parse({
          operationId: `11111111-1111-4111-8111-${String(["ready", "eligible", "warning", "denied", "unverified", "unknown"].indexOf(feedback)).padStart(12, "0")}`,
          outcome: feedback,
          reason:
            feedback === "eligible"
              ? "eligible"
              : feedback === "warning"
                ? "missing_registration"
                : feedback === "denied"
                  ? "revoked_badge"
                  : feedback === "unknown"
                    ? "unknown_credential"
                    : "verification_required",
          recorded: feedback === "eligible",
          attendanceRecorded: feedback === "eligible" && (role === "scan" || role === "session"),
          checkoutRecorded: feedback === "eligible" && role === "exit",
        });
  const [preview, setPreview] = useState(false);
  const [recent, setRecent] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (presentation === "fullscreen" && shell.current)
      return scannerImmersiveLifecycle(shell.current, () => setPresentation("embedded"));
  }, [presentation, setPresentation]);
  return (
    <div ref={shell}>
      <FastScannerView
        soundLabel={audio.label}
        onSound={() => audio.toggle(setSoundEnabled)}
        onTourSound={audio.test}
        presentation={presentation}
        purpose={role === "print" ? "print" : "scan"}
        mode={role === "lead" ? "lead" : role === "exit" ? "checkout" : "attendance"}
        preparation={
          role === "session"
            ? { action: "attendance", occurrenceId: "gallery-session", ready: true, preparing: false, error: "" }
            : undefined
        }
        context={
          role === "lead"
            ? "Sponsor leads"
            : role === "print"
              ? "Badge printing"
              : role === "session"
                ? "Session check-in"
                : role === "exit"
                  ? "Venue exit"
                  : "Venue entrance"
        }
        onRecentScans={() => setRecent(true)}
        onReturnToScanning={() => setRecent(false)}
        recentScans={
          recent ? (
            <ScannerRecentScans slug="gallery" operatorUserId="11111111-1111-4111-8111-111111111111" pending={0} />
          ) : undefined
        }
        result={result}
        pending={feedback === "unverified" ? 1 : 0}
        message={messages[feedback]}
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

export const scannerDestinationsSection: PreviewSection = {
  id: "scanner-destinations",
  title: "Scanner tasks",
  render: () => (
    <ScannerDestinationTiles
      allowedActions={["attendance", "checkout"]}
      disabled={false}
      onVenue={() => {}}
      onSessions={() => {}}
      printHref="#/events/example/scanner/print"
    />
  ),
};
