import { ScannerSoundPreferences } from "./ScannerSoundPreferences";
import { ScannerSyncStatus, ScannerPreparationStatus } from "./ScannerPreparationStatus";
import type { ComponentProps } from "preact";
import { ScannerDiagnostics } from "./ScannerCaptureControls";
import { useScannerDecoderPreparation } from "./useScannerDecoderPreparation";
import { Alert } from "../../../../../../ui/Alert";
type Diagnostics = ComponentProps<typeof ScannerDiagnostics>;
type Session = Diagnostics["session"];
/** Assembles the current scanner's diagnostics from its canonical session and preparation controls. */
export function ScannerDiagnosticsView({
  context,
  scanner,
  sync,
  refreshEligibility,
  onMessage,
  onCapturePause,
  preferences,
  status,
  preparation,
  unverifiedStart,
  sound,
}: {
  context: Pick<Session, "sessionId" | "slug" | "operatorUserId" | "sponsorId">;
  scanner: Session["scanner"];
  sync: Session["sync"];
  refreshEligibility: () => Promise<void>;
  onMessage: Session["message"];
  onCapturePause: Session["capturePause"];
  preferences: ComponentProps<typeof ScannerSoundPreferences>["preferences"];
  sound: ComponentProps<typeof ScannerSoundPreferences>["sound"];
  status: Omit<ComponentProps<typeof ScannerSyncStatus>, "sync" | "refreshEligibility">;
  preparation: ComponentProps<typeof ScannerPreparationStatus>;
  unverifiedStart?: Diagnostics["unverifiedStart"];
}) {
  const decoderStatus = useScannerDecoderPreparation(`${context.slug}:${context.operatorUserId}`);
  return (
    <ScannerDiagnostics
      session={{ ...context, scanner, sync, message: onMessage, capturePause: onCapturePause }}
      sound={<ScannerSoundPreferences preferences={preferences} sound={sound} />}
      syncStatus={
        <ScannerSyncStatus {...status} sync={() => void sync()} refreshEligibility={refreshEligibility}>
          {scanner.error && <Alert tone="danger">{scanner.error}</Alert>}
          <ScannerPreparationStatus {...preparation} />
          <p role="status">{decoderStatus}</p>
        </ScannerSyncStatus>
      }
      pacing={{
        value: preferences.feedbackPause,
        onChange: (value) => preferences.update({ feedbackPause: value }),
        field: preferences.form.of("feedbackPause"),
      }}
      unverifiedStart={unverifiedStart}
    />
  );
}
