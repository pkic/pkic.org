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
 * Who asked, as one short line: the name and, when known, the capacity they
 * asked in (frozen with the question): their organization, else their title.
 */
export function liveQuestionAsker(question: Pick<LiveStageQuestion, "authorName" | "authorAffiliation">): string {
  if (!question.authorName) return "Audience question";
  const capacity = question.authorAffiliation?.organization?.name ?? question.authorAffiliation?.title;
  return capacity ? `${question.authorName}, ${capacity}` : question.authorName;
}
