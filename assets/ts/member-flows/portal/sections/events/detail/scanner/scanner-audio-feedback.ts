export type ScannerSound = "entry" | "exit" | "session" | "print" | "lead" | "warning" | "error" | "unverified";

/** Distinct rhythms and pitches identify the task; longer alerts take priority over success. */
export const SCANNER_AUDIO_FEEDBACK: Record<
  ScannerSound,
  {
    notes: readonly number[];
    duration: number;
    spacing: number;
    wave: OscillatorType;
    vibration: readonly number[];
  }
> = {
  entry: { notes: [880, 1174], duration: 0.09, spacing: 0.11, wave: "sine", vibration: [] },
  exit: { notes: [1174, 880], duration: 0.12, spacing: 0.16, wave: "triangle", vibration: [] },
  session: { notes: [659, 880, 1318], duration: 0.1, spacing: 0.12, wave: "sine", vibration: [] },
  print: { notes: [523, 659, 784], duration: 0.07, spacing: 0.1, wave: "triangle", vibration: [] },
  lead: { notes: [784, 1047], duration: 0.15, spacing: 0.19, wave: "sine", vibration: [] },
  warning: { notes: [440, 440], duration: 0.22, spacing: 0.3, wave: "triangle", vibration: [120, 80, 120] },
  error: { notes: [220, 165, 110], duration: 0.24, spacing: 0.3, wave: "sawtooth", vibration: [250, 100, 250] },
  unverified: { notes: [550, 550], duration: 0.18, spacing: 0.25, wave: "triangle", vibration: [100, 100, 100] },
};
