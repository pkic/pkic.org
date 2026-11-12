import type { LiveStage, LiveStageQuestion } from "./schemas/live-session-room";

/**
 * The stage display: the speaker-facing screen on the stage monitor. It shows
 * the question being answered now (on Program) and the one the operators have
 * lined up next (in Preview), so the speaker can see what is coming. Preview
 * is for the operators and this one screen only: an audience output never
 * receives it. The room, its sources and the control room read the rules here.
 */

/** Who may receive the question lined up in Preview: operators, and a source that draws the stage display. */
export function seesStageDisplayNext(viewer: { role: string; overlayOutput?: string | null }): boolean {
  return viewer.role === "operator" || (viewer.role === "overlay" && viewer.overlayOutput === "stage-display");
}

/**
 * The two questions the stage display shows: the current one, its own when
 * an operator put one on it, else Program's; and the next one, Preview's,
 * unless it is the question already being answered (after a Take, Preview
 * keeps what it sent to Program).
 */
export function liveStageDisplayQuestions(
  own: Pick<LiveStage, "question">,
  program: Pick<LiveStage, "question">,
  next: LiveStageQuestion | null,
): { current: LiveStageQuestion | null; next: LiveStageQuestion | null } {
  const current = own.question ?? program.question;
  return { current, next: next && next.id !== current?.id ? next : null };
}

/**
 * How large the stage display and the question overlay set a question, read
 * from a few metres away: full size while short, a step smaller for each longer band, and never below
 * the smallest readable size, where it is clamped to a fixed number of lines.
 * Character counts stand in for measuring, so every screen agrees.
 */
export type LiveQuestionFit = "regular" | "long" | "longer" | "longest";
export function liveQuestionFit(text: string): LiveQuestionFit {
  const length = [...text.trim()].length;
  return length <= 70 ? "regular" : length <= 130 ? "long" : length <= 200 ? "longer" : "longest";
}

/**
 * How many characters of the stage display's smallest type (64 px on its
 * 1792 px line) fit on one line. Like the question's fit, a character count
 * stands in for measuring, so every screen cuts a line in the same place.
 */
export const LIVE_STAGE_LINE_CHARS = 56;
/** The footer's title: two lines, less the room its Live or Next marker takes. */
const TITLE_CHARS = LIVE_STAGE_LINE_CHARS * 2 - 10;

/** Cuts text to a budget at the last whole word, with an ellipsis; text that fits is returned as it is. */
export function cutAtWord(text: string, budget: number): string {
  const trimmed = text.trim().replace(/\s+/gu, " ");
  if ([...trimmed].length <= budget) return trimmed;
  const head = [...trimmed].slice(0, budget).join("");
  const space = head.lastIndexOf(" ");
  return `${(space > budget / 2 ? head.slice(0, space) : head).replace(/[\s,;:·–-]+$/u, "")}…`;
}

/** The session title as the footer shows it: at most two lines, cut at a word. */
export function liveStageTitle(title: string): string {
  return cutAtWord(title, TITLE_CHARS);
}

/** Lowercase name particles that belong to a surname: "van Brouwershaven", "de Blaauw". */
const SURNAME_PARTICLES = new Set([
  "da",
  "de",
  "del",
  "den",
  "der",
  "di",
  "du",
  "la",
  "le",
  "ten",
  "ter",
  "van",
  "von",
]);

/** A person's surname with its particles, from the name as shown: "Art de Blaauw" reads "de Blaauw". */
export function liveSurname(name: string): string {
  const words = name.trim().split(/\s+/u);
  let start = words.length - 1;
  while (start > 1 && SURNAME_PARTICLES.has(words[start - 1]!.toLowerCase())) start -= 1;
  return words.slice(start).join(" ");
}

export interface LiveStageSpeaker {
  name: string;
  /** The organization they speak for; null when unknown. */
  affiliation: string | null;
}

/**
 * The speakers in one line, as much as fits: names and affiliations, then
 * names, then surnames, then only how many there are. Never scrolls.
 */
export function liveStageSpeakers(speakers: readonly LiveStageSpeaker[], budget = LIVE_STAGE_LINE_CHARS): string {
  if (!speakers.length) return "";
  const fits = (line: string) => [...line].length <= budget;
  const join = (parts: string[]) => parts.join(" · ");
  const attempts = [
    join(speakers.map((speaker) => (speaker.affiliation ? `${speaker.name}, ${speaker.affiliation}` : speaker.name))),
    join(speakers.map((speaker) => speaker.name)),
    join(speakers.map((speaker) => liveSurname(speaker.name))),
  ];
  return (
    attempts.find(fits) ??
    (speakers.length > 1 ? `Panel · ${speakers.length} speakers` : cutAtWord(attempts[2]!, budget))
  );
}
