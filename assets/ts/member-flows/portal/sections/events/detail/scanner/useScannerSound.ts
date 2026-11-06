import { useEffect, useRef } from "preact/hooks";
import type {
  EventScanRequest,
  EventScanResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { scanFeedbackOutcome } from "./scan-stream";

import { useScannerAudio } from "./useScannerAudio";
import type { ScannerSound } from "./scanner-audio-feedback";
/** Web Audio is unlocked by the start/toggle gesture and never awaited by badge capture. */
export function useScannerSound(
  enabled: boolean,
  result: EventScanResponse | null,
  action: EventScanRequest["action"],
  failed: boolean,
  offline = false,
  session = false,
) {
  const success = action === "lead" ? "lead" : session ? "session" : action === "checkout" ? "exit" : "entry";
  const audio = useScannerAudio(enabled, success);
  const presented = useRef<EventScanResponse | null>(null);
  const heard = useRef<{ operation: string; sound: ScannerSound } | null>(null);
  const latestPlay = useRef(audio.play);
  latestPlay.current = audio.play;
  useEffect(() => {
    if (!result || presented.current === result) return;
    presented.current = result;
    const outcome =
      offline && !result.recorded && result.outcome === "eligible" ? "unverified" : scanFeedbackOutcome(result, action);
    const sound =
      outcome === "eligible"
        ? success
        : outcome === "unverified"
          ? "unverified"
          : outcome === "warning"
            ? "warning"
            : "error";
    // A receipt can correct provisional feedback, but cannot beep twice for the same outcome.
    if (heard.current?.operation === result.operationId && heard.current.sound === sound) return;
    heard.current = { operation: result.operationId, sound };
    latestPlay.current(sound);
  }, [result, action, offline, success]);
  useEffect(() => {
    if (failed) latestPlay.current("error");
  }, [failed]);
  return audio;
}
