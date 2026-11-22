/**
 * What the check model reads for each kind of content. Real checks and trials
 * build it the same way, so a trial shows what a real check would decide.
 */
import type { ContentCheckKind } from "../../../../assets/shared/content-checks";

export interface ContentCheckSubject {
  text: string;
  title?: string;
  /** The proposal's format, such as a talk or a panel. */
  format?: string;
  /** Answers to an event's own proposal questions, by question key. */
  answers?: Record<string, string>;
}

/** Long answers are cut so a check stays one quick model call. */
const MAX_ANSWER_LENGTH = 1000;
const MAX_ANSWERS = 12;

function boundedAnswers(answers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!answers) return undefined;
  const entries = Object.entries(answers)
    .filter(([, value]) => value.trim().length > 0)
    .slice(0, MAX_ANSWERS)
    .map(([key, value]) => [key, value.slice(0, MAX_ANSWER_LENGTH)] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function contentCheckState(kind: ContentCheckKind, subject: ContentCheckSubject): Record<string, unknown> {
  switch (kind) {
    case "chat_message":
      return { chat_message: subject.text };
    case "audience_question":
      return { question_for_the_speakers: subject.text };
    case "proposal":
      return {
        title: subject.title ?? "",
        ...(subject.format ? { format: subject.format } : {}),
        abstract: subject.text,
        ...(boundedAnswers(subject.answers) ? { answers: boundedAnswers(subject.answers) } : {}),
      };
    case "presentation":
      return { title: subject.title ?? "", slides: subject.text };
  }
}

/** Custom proposal answers that are text, which the check can read. */
export function textAnswers(details: Record<string, unknown> | undefined): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (typeof value === "string") answers[key] = value;
    else if (Array.isArray(value) && value.every((item) => typeof item === "string")) answers[key] = value.join(", ");
  }
  return answers;
}
