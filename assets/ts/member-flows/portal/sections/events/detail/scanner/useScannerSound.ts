import { useEffect, useRef, useState } from "preact/hooks";
import type {
  EventScanRequest,
  EventScanResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { scanFeedbackOutcome } from "./scan-stream";

type Sound = "success" | "attention" | "unverified";
/** Web Audio is unlocked by the start/toggle gesture and never awaited by badge capture. */
export function useScannerSound(
  enabled: boolean,
  result: EventScanResponse | null,
  action: EventScanRequest["action"],
  failed: boolean,
  offline = false,
) {
  const context = useRef<AudioContext | null>(null);
  const presented = useRef<EventScanResponse | null>(null);
  const heard = useRef<{ operation: string; sound: Sound } | null>(null);
  const [available, setAvailable] = useState(false);
  function unlock() {
    try {
      context.current ??= new AudioContext();
      const audio = context.current;
      audio.onstatechange = () => setAvailable(audio.state === "running");
      if (audio.state === "running") setAvailable(true);
      else
        void audio
          .resume()
          .then(() => setAvailable(audio.state === "running"))
          .catch(() => setAvailable(false));
    } catch {
      setAvailable(false);
    }
  }
  function play(sound: Sound) {
    const audio = context.current;
    if (!enabled || !audio || audio.state !== "running") return;
    const notes = sound === "success" ? [880, 1174] : sound === "attention" ? [330, 220, 220] : [550, 550];
    try {
      notes.forEach((frequency, index) => {
        const oscillator = audio.createOscillator(),
          gain = audio.createGain();
        const start = audio.currentTime + index * 0.11;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.16, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.09);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(start);
        oscillator.stop(start + 0.1);
      });
    } catch {
      setAvailable(false);
    }
  }
  const latestPlay = useRef(play);
  latestPlay.current = play;
  useEffect(() => {
    if (!result || presented.current === result) return;
    presented.current = result;
    const outcome =
      offline && !result.recorded && result.outcome === "eligible" ? "unverified" : scanFeedbackOutcome(result, action);
    const sound = outcome === "eligible" ? "success" : outcome === "unverified" ? "unverified" : "attention";
    // A receipt can correct provisional feedback, but cannot beep twice for the same outcome.
    if (heard.current?.operation === result.operationId && heard.current.sound === sound) return;
    heard.current = { operation: result.operationId, sound };
    latestPlay.current(sound);
  }, [result, action, offline]);
  useEffect(() => {
    if (failed) latestPlay.current("attention");
  }, [failed]);
  useEffect(
    () => () => {
      void context.current?.close().catch(() => {});
    },
    [],
  );
  return {
    unlock,
    available,
    label: !enabled ? "Sound off" : available ? "Sound on" : "Enable sound",
    toggle: (onChange: (enabled: boolean) => void) => {
      if (!enabled || available) onChange(!enabled);
      unlock();
    },
    test: () => {
      unlock();
      void context.current
        ?.resume()
        .then(() => latestPlay.current("success"))
        .catch(() => setAvailable(false));
    },
  };
}
