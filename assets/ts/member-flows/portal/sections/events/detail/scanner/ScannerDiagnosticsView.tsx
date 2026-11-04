import { ScannerModeSelect } from "./ScannerModeSelect";
import { ScannerSoundPreferences } from "./ScannerSoundPreferences";
import { ScannerSyncStatus } from "./ScannerPreparationStatus";
import { Button } from "../../../../../../ui/Button";
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
  mode,
  onStart,
  preferences,
  status,
  preparation,
  unverifiedStart,
  sound,
}: {
  context: Pick<Session, "sessionId" | "slug" | "operatorUserId" | "sponsorId">;
  scanner: Session["scanner"];
  sync: Session["sync"];
  onMessage: Session["message"];
  onCapturePause: Session["capturePause"];
  mode: ComponentProps<typeof ScannerModeSelect>;
  onStart: () => void;
  preferences: ComponentProps<typeof ScannerSoundPreferences>["preferences"];
  sound: ComponentProps<typeof ScannerSoundPreferences>["sound"];
  status: Omit<ComponentProps<typeof ScannerSyncStatus>, "sync">;
  preparation: Diagnostics["preparation"];
  unverifiedStart?: Diagnostics["unverifiedStart"];
}) {
  return (
    <>
      <ScannerModeSelect {...mode} />
      <Button type="button" variant="secondary" disabled={!scanner.ready} onClick={onStart}>
        Start scanning
      </Button>
      <ScannerDiagnostics
        session={{ ...context, scanner, sync, message: onMessage, capturePause: onCapturePause }}
        sound={<ScannerSoundPreferences preferences={preferences} sound={sound} />}
        syncStatus={<ScannerSyncStatus {...status} sync={() => void sync()} />}
        pacing={{
          value: preferences.feedbackPause,
          onChange: (value) => preferences.update({ feedbackPause: value }),
          field: preferences.form.of("feedbackPause"),
        }}
        preparation={preparation}
        unverifiedStart={unverifiedStart}
      />
    </>
  );
}
