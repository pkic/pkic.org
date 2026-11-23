/**
 * Automatic checks: a model reads what someone wrote or uploaded and answers
 * the questions configured for that kind of content.
 *
 * A check has two kinds of question. A flag asks whether something is wrong
 * (spam, abuse, a sales pitch); it advises from one certainty and blocks from
 * another, and its message is what the author is told. A score rates the
 * content on an ordered rubric for reviewers; scores never stop anyone.
 *
 * The PKIC-wide settings hold the questions. An event adds its own context
 * (its topics, tracks and terms) and may add, replace or switch off questions.
 * Nothing is configured per session.
 */
import type { z } from "zod";
import type {
  classifierFlagSchema,
  classifierScoreSchema,
  classifierSettingsSchema,
  classifierVerdictSchema,
  EventClassifierResponse,
} from "./schemas/classifiers";

export const CLASSIFIER_KINDS = ["chat_message", "audience_question", "proposal", "presentation"] as const;
export type ClassifierKind = (typeof CLASSIFIER_KINDS)[number];

export const CLASSIFIER_KIND_LABELS: Record<ClassifierKind, string> = {
  chat_message: "Chat messages",
  audience_question: "Questions",
  proposal: "Proposals",
  presentation: "Slides",
};

/** The model behind every check; the faster one suits chat, the larger one long texts. */
export const CLASSIFIER_MODELS = ["clef", "clef-flash"] as const;
export type ClassifierModel = (typeof CLASSIFIER_MODELS)[number];

export const CLASSIFIER_MODEL_LABELS: Record<ClassifierModel, string> = {
  clef: "Thorough (Clef)",
  "clef-flash": "Fast (Clef Flash)",
};

export const CLASSIFIER_OUTCOMES = ["passed", "advised", "blocked", "unchecked"] as const;
export type ClassifierOutcome = (typeof CLASSIFIER_OUTCOMES)[number];

/** How reviewers and organizers read a verdict. */
export const CLASSIFIER_OUTCOME_LABELS: Record<ClassifierOutcome, string> = {
  passed: "No concerns",
  advised: "Concerns raised",
  blocked: "Blocked",
  unchecked: "Not checked",
};

/** Whether a verdict asks a reviewer to look. */
export function classifierRaisesConcerns(outcome: ClassifierOutcome): boolean {
  return outcome === "advised" || outcome === "blocked";
}

/**
 * The most questions one check runs. Clef takes 64 per call and Gemini Decision 1 takes 1,000, so 60 stays within
 * every model we may run, with headroom on the lowest.
 */
export const CLASSIFIER_MAX_QUESTIONS = 60;
/**
 * Each scope has its own share of that limit, so a merged check always fits and no save needs to look beyond its own
 * scope: the PKIC-wide questions, and what one event adds or replaces.
 */
export const CLASSIFIER_MAX_WIDE_QUESTIONS = 45;
export const CLASSIFIER_MAX_EVENT_QUESTIONS = CLASSIFIER_MAX_QUESTIONS - CLASSIFIER_MAX_WIDE_QUESTIONS;

/** Refusal codes of the proposal screening: a block, or advice the author may set aside by submitting again. */
export const PROPOSAL_CHECK_BLOCKED = "PROPOSAL_CHECK_BLOCKED";
export const PROPOSAL_CHECK_ADVICE = "PROPOSAL_CHECK_ADVICE";
export const CLASSIFIER_QUESTION_ID_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

/** A question's id as words, where a short name is enough: `personal_data` reads "Personal data". */
export function classifierQuestionName(id: string): string {
  const words = id.replace(/_/gu, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// The shapes are the shared schemas' own; this module keeps the policy that reads them.
export type ClassifierFlag = z.infer<typeof classifierFlagSchema>;
export type ClassifierScore = z.infer<typeof classifierScoreSchema>;
export type ClassifierQuestion = ClassifierFlag | ClassifierScore;

/** The PKIC-wide settings for one kind of check. */
export type ClassifierSettings = z.infer<typeof classifierSettingsSchema>;

/** What one event adds to the PKIC-wide settings; a question with a PKIC-wide id replaces it for this event. */
export type ClassifierEventAdditions = Pick<
  EventClassifierResponse["additions"],
  "context" | "questions" | "disabledQuestionIds"
>;

/** The check as it runs for one event, or PKIC-wide when there is no event. */
export type EffectiveClassifier = ClassifierSettings;

/** The questions an event asks: PKIC-wide ones less those it turns off, with its replacements and additions. */
export function mergedClassifierQuestions(
  settingsQuestions: readonly ClassifierQuestion[],
  additions: ClassifierEventAdditions | null,
): ClassifierQuestion[] {
  if (!additions) return [...settingsQuestions];
  const disabled = new Set(additions.disabledQuestionIds);
  const replaced = new Map(additions.questions.map((question) => [question.id, question]));
  const questions = settingsQuestions
    .filter((question) => !disabled.has(question.id))
    .map((question) => replaced.get(question.id) ?? question);
  const kept = new Set(questions.map((question) => question.id));
  for (const question of additions.questions)
    if (!kept.has(question.id) && !disabled.has(question.id)) questions.push(question);
  return questions;
}

/** The most of an event's own description a check reads; the rest is cut at a word. */
export const CLASSIFIER_EVENT_DESCRIPTION_MAX_CHARS = 1500;

/** The model every kind starts with; the fast one is a choice per kind once it proves as accurate. */
export const DEFAULT_CLASSIFIER_MODEL: ClassifierModel = "clef";

/** Shortens a long description at a word boundary, so the context stays bounded. */
export function truncateClassifierEventDescription(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= CLASSIFIER_EVENT_DESCRIPTION_MAX_CHARS) return trimmed;
  const cut = trimmed.slice(0, CLASSIFIER_EVENT_DESCRIPTION_MAX_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${(space > CLASSIFIER_EVENT_DESCRIPTION_MAX_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The check as it runs. The model reads the PKIC-wide context, then the
 * event's own description, then what the event adds. Outside an event, or
 * without any of them, the check runs with the PKIC-wide context alone.
 */
export function effectiveClassifier(
  settings: ClassifierSettings,
  additions: ClassifierEventAdditions | null,
  eventDescription = "",
): EffectiveClassifier {
  const context = [
    settings.context.trim(),
    truncateClassifierEventDescription(eventDescription),
    additions?.context.trim() ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    enabled: settings.enabled,
    model: settings.model,
    context,
    // Each scope stays within its share of the limit, so the merged questions always fit.
    questions: mergedClassifierQuestions(settings.questions, additions),
  };
}

/** One model answer: the probability of yes for a flag, the level probabilities for a score. */
export type ClassifierAnswer = { kind: "flag"; probability: number } | { kind: "score"; probabilities: number[] };

export type ClassifierVerdict = z.infer<typeof classifierVerdictSchema>;
export type RaisedClassifierFlag = ClassifierVerdict["flags"][number];
/** One score: `percent` is the probability-weighted level from 0 to 100; `level` the most likely rubric level. */
export type ClassifierScoreResult = ClassifierVerdict["scores"][number];

export const UNCHECKED_CONTENT_VERDICT: ClassifierVerdict = {
  outcome: "unchecked",
  flags: [],
  scores: [],
  scorePercent: null,
};

function percent(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 10;
}

/** Turns the model's answers into the outcome, the raised flags and the scores. */
export function decideClassifier(
  questions: readonly ClassifierQuestion[],
  answers: Readonly<Record<string, ClassifierAnswer>>,
): ClassifierVerdict {
  const flags: RaisedClassifierFlag[] = [];
  const scores: ClassifierScoreResult[] = [];
  let weighted = 0;
  let weights = 0;
  for (const question of questions) {
    const answer = answers[question.id];
    if (!answer || answer.kind !== question.kind) continue;
    if (question.kind === "flag" && answer.kind === "flag") {
      const probabilityPercent = percent(answer.probability);
      if (probabilityPercent < question.adviseAtPercent && !blocks(question, probabilityPercent)) continue;
      flags.push({
        id: question.id,
        probabilityPercent,
        blocking: blocks(question, probabilityPercent),
        message: question.message,
      });
    } else if (question.kind === "score" && answer.kind === "score") {
      const levels = question.levels.length;
      const probabilities = answer.probabilities.slice(0, levels);
      const total = probabilities.reduce((sum, value) => sum + value, 0);
      if (!(total > 0) || levels < 2) continue;
      const expected = probabilities.reduce((sum, value, index) => sum + (value / total) * index, 0);
      const likeliest = probabilities.reduce((best, value, index) => (value > probabilities[best]! ? index : best), 0);
      const scorePercent = percent(expected / (levels - 1));
      scores.push({
        id: question.id,
        label: question.label,
        percent: scorePercent,
        level: question.levels[likeliest]!,
      });
      weighted += scorePercent * question.weight;
      weights += question.weight;
    }
  }
  const outcome: ClassifierOutcome = flags.some((flag) => flag.blocking)
    ? "blocked"
    : flags.length
      ? "advised"
      : "passed";
  flags.sort((a, b) => Number(b.blocking) - Number(a.blocking) || b.probabilityPercent - a.probabilityPercent);
  return { outcome, flags, scores, scorePercent: weights > 0 ? Math.round((weighted / weights) * 10) / 10 : null };
}

function blocks(question: ClassifierFlag, probabilityPercent: number): boolean {
  return question.blockAtPercent !== null && probabilityPercent >= question.blockAtPercent;
}
