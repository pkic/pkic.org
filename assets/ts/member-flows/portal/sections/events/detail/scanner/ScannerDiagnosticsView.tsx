import type { ComponentProps } from "preact";
import { ScannerDiagnostics } from "./ScannerCaptureControls";
type Diagnostics = ComponentProps<typeof ScannerDiagnostics>;
type Session = Diagnostics["session"];
/** Assembles the current scanner's diagnostics from its canonical session and preparation controls. */
export function ScannerDiagnosticsView({
  context,
  scanner,
  sync,
  onMessage,
  onCapturePause,
  pacing,
  preparation,
  unverifiedStart,
}: {
  context: Pick<Session, "sessionId" | "slug" | "operatorUserId" | "sponsorId">;
  scanner: Session["scanner"];
  sync: Session["sync"];
  onMessage: Session["message"];
  onCapturePause: Session["capturePause"];
  pacing: Diagnostics["pacing"];
  preparation: Diagnostics["preparation"];
  unverifiedStart?: Diagnostics["unverifiedStart"];
}) {
  return (
    <ScannerDiagnostics
      session={{ ...context, scanner, sync, message: onMessage, capturePause: onCapturePause }}
      pacing={pacing}
      preparation={preparation}
      unverifiedStart={unverifiedStart}
    />
  );
}
