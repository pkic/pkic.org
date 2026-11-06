import { useEffect, useRef, useState } from "preact/hooks";
import { SCANNER_AUDIO_FEEDBACK, type ScannerSound } from "./scanner-audio-feedback";

/** Shared optional audio and supported-device haptics, unlocked by the operator's gesture. */
export function useScannerAudio(enabled: boolean, success: ScannerSound) {
  const context = useRef<AudioContext | null>(null);
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
  function play(sound: ScannerSound) {
    if (!enabled) return;
    const feedback = SCANNER_AUDIO_FEEDBACK[sound];
    try {
      if (feedback.vibration.length) navigator.vibrate?.([...feedback.vibration]);
    } catch {
      /* Optional hardware feedback. */
    }
    const audio = context.current;
    if (!audio || audio.state !== "running") return;
    try {
      feedback.notes.forEach((frequency, index) => {
        const oscillator = audio.createOscillator(),
          gain = audio.createGain();
        const start = audio.currentTime + index * feedback.spacing;
        oscillator.type = feedback.wave;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.12, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, start + feedback.duration);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(start);
        oscillator.stop(start + feedback.duration + 0.01);
      });
    } catch {
      setAvailable(false);
    }
  }
  const latestPlay = useRef(play);
  latestPlay.current = play;
  useEffect(
    () => () => {
      void context.current?.close().catch(() => {});
    },
    [],
  );
  return {
    unlock,
    play,
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
        .then(() => latestPlay.current(success))
        .catch(() => setAvailable(false));
    },
  };
}
