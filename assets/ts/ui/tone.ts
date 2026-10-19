/**
 * The one color family for states and workflow stages, drawn from the brand
 * rainbow the site runs along its mega menu and above its footer: grey not
 * started, blue in flight, yellow waiting on someone, orange at risk, green
 * done well, red rejected. A badge and a table row take the same tone, so a
 * stage reads the same in a pill, at a row's edge, or as a row's tint.
 *
 * Tone means the state, never the position: two review steps are both "in
 * flight". Where order matters, `progress` places an in-flight step along its
 * flow — fading the blue in, or traveling it toward teal as it nears the
 * finish. The label always names the real stage; color only repeats it.
 */

import "./tone.css";
import "./tone-progress.css";

export type Tone = "ok" | "warn" | "risk" | "danger" | "info" | "neutral" | "accent";

export interface ToneProps {
  tone?: Tone;
  /** How far an in-flight step has come through its flow, 0 to 1, in four steps. */
  progress?: number;
  /** "fade" strengthens the blue; "travel" moves it toward teal at full strength. */
  progressStyle?: "fade" | "travel";
}

/** The strength step (1–4) a progress value falls in. */
export function progressStep(progress: number): number {
  return Math.min(4, Math.max(1, Math.ceil(Math.min(1, Math.max(0, progress)) * 4)));
}

/** The class that places an in-flight step, or null without progress. */
export function progressClass({ progress, progressStyle = "fade" }: ToneProps): string | null {
  return progress === undefined ? null : `pk-tone--${progressStyle}-${String(progressStep(progress))}`;
}

/** The classes that set `--tone` for one element. */
export function toneClasses(props: ToneProps): string {
  return [`pk-tone--${props.tone ?? "neutral"}`, progressClass(props)].filter(Boolean).join(" ");
}
