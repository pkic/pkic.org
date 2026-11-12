import type { LiveTimerCue } from "../../shared/live-timer-policy";

/**
 * The timers' two sounds, drawn as short WAV clips in the browser so the
 * site ships no audio files: a soft two-note chime for the warning and a
 * buzzer at zero. They play through a plain audio element. A kiosk screen
 * allows autoplay; a browser that has not been clicked yet refuses, and the
 * cue passes without a sound or an error.
 */

const RATE = 22_050;

/** One clip: its length and its sample at each instant, between -1 and 1. */
const CLIPS: Record<LiveTimerCue, { seconds: number; sample: (time: number) => number }> = {
  warning: {
    seconds: 1.2,
    sample: (time) => {
      const note = (start: number, frequency: number) =>
        time < start ? 0 : Math.sin(2 * Math.PI * frequency * (time - start)) * Math.exp(-4 * (time - start));
      return 0.45 * (note(0, 880) + note(0.28, 1318.5));
    },
  },
  zero: {
    seconds: 0.9,
    sample: (time) => {
      // A square-ish 220 Hz tone with a quick attack and release.
      const wave = Math.sign(Math.sin(2 * Math.PI * 220 * time)) * 0.6 + Math.sin(2 * Math.PI * 440 * time) * 0.25;
      const envelope = Math.min(1, time / 0.02, (0.9 - time) / 0.08);
      return 0.5 * wave * Math.max(0, envelope);
    },
  },
};

/** A 16-bit mono PCM WAV file of one clip. */
export function liveTimerCueWav(cue: LiveTimerCue): ArrayBuffer {
  const { seconds, sample } = CLIPS[cue];
  const samples = Math.round(seconds * RATE);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.max(-1, Math.min(1, sample(index / RATE)));
    view.setInt16(44 + index * 2, Math.round(value * 32_767), true);
  }
  return buffer;
}

const sources = new Map<LiveTimerCue, string>();

/** Plays one cue; a browser that blocks or cannot play it stays silent. */
export function playLiveTimerCue(cue: LiveTimerCue): void {
  if (typeof Audio === "undefined" || typeof URL.createObjectURL !== "function") return;
  let source = sources.get(cue);
  if (!source) {
    source = URL.createObjectURL(new Blob([liveTimerCueWav(cue)], { type: "audio/wav" }));
    sources.set(cue, source);
  }
  try {
    void new Audio(source).play().catch(() => undefined);
  } catch {
    // An audio element that cannot even start is the same as a blocked one.
  }
}
