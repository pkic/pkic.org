import { useScannerDecoderPreparation } from "./useScannerDecoderPreparation";
import { Button } from "../../../../../../ui/Button";
import { useState } from "preact/hooks";
import { startNextScannerEpoch, freezeScannerEpoch, closeScannerEpoch } from "./scanner-device-ledger";
import type { useScannerDevice } from "./useScannerDevice";
import { ScannerRecovery } from "./ScannerRecovery";
export function ScannerSessionControls({
  scanner,
  slug,
  operatorUserId,
  sponsorId,
  sessionId,
  capturePause,
  sync,
  message,
}: {
  scanner: ReturnType<typeof useScannerDevice>;
  slug: string;
  operatorUserId: string;
  sponsorId?: string;
  sessionId?: string;
  capturePause: (paused: boolean) => void;
  sync: () => Promise<void>;
  message: (value: string) => void;
}) {
  const decoderStatus = useScannerDecoderPreparation(`${slug}:${operatorUserId}`);
  const [preparing, setPreparing] = useState(false);
  async function close() {
    capturePause(true);
    try {
      const frozen = await freezeScannerEpoch(slug, operatorUserId, scanner.deviceId);
      scanner.setEpoch(frozen);
      if (frozen.state === "closed") return;
      await sync();
      scanner.setEpoch(await closeScannerEpoch(frozen, sponsorId));
      message("Scanner session closed. All captured operations are accounted for.");
    } catch (error) {
      message(error instanceof Error ? error.message : "Scanner session remains frozen. Retry closing when connected.");
    }
  }
  async function nextSession() {
    capturePause(true);
    setPreparing(true);
    try {
      scanner.setEpoch(await startNextScannerEpoch(slug, operatorUserId, scanner.deviceId, sponsorId));
      capturePause(false);
      message("New scanner session prepared. Ready to scan.");
    } catch (error) {
      message(
        error instanceof Error
          ? error.message
          : "New scanner session could not be prepared. Retained evidence has been kept.",
      );
    } finally {
      setPreparing(false);
    }
  }
  return (
    <>
      <p role="status">{decoderStatus}</p>
      {scanner.error && <p role="status">{scanner.error}</p>}
      {!scanner.epoch && !scanner.error && <p role="status">Preparing scanner session…</p>}
      {scanner.epoch && (
        <p role="status">
          Scanner session: {scanner.epoch.state}. Offline preparation uses the last saved authorization.
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        disabled={!scanner.epoch || scanner.epoch.state === "closed"}
        onClick={() => void close()}
      >
        {scanner.epoch?.state === "closing" ? "Retry closing scanner session" : "Close scanner session"}
      </Button>
      {scanner.epoch?.state === "closed" && (
        <Button
          type="button"
          variant="secondary"
          loading={preparing}
          disabled={preparing}
          onClick={() => void nextSession()}
        >
          Start next scanner session
        </Button>
      )}
      <ScannerRecovery slug={slug} operatorUserId={operatorUserId} sessionId={sessionId} sponsorId={sponsorId} />
    </>
  );
}
