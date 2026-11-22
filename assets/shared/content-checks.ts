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

/** Kinds an event may add to: its own content. The profile kinds below belong to PKIC alone. */
export const EVENT_CONTENT_CHECK_KINDS = ["chat_message", "audience_question", "proposal", "presentation"] as const;
export type EventContentCheckKind = (typeof EVENT_CONTENT_CHECK_KINDS)[number];

/** Kinds that read what members write about themselves; PKIC-wide, never per event. */
export const PROFILE_CONTENT_CHECK_KINDS = ["organization_profile", "person_profile"] as const;
export type ProfileContentCheckKind = (typeof PROFILE_CONTENT_CHECK_KINDS)[number];

export const CONTENT_CHECK_KINDS = [...EVENT_CONTENT_CHECK_KINDS, ...PROFILE_CONTENT_CHECK_KINDS] as const;
export type ContentCheckKind = (typeof CONTENT_CHECK_KINDS)[number];

export const CONTENT_CHECK_KIND_LABELS: Record<ContentCheckKind, string> = {
  chat_message: "Chat messages",
  audience_question: "Questions",
  proposal: "Proposals",
  presentation: "Slides",
  organization_profile: "Member pages",
  person_profile: "Bios",
};

/** The model behind every check; the faster one suits chat, the larger one long texts. */
export const CONTENT_CHECK_MODELS = ["clef", "clef-flash"] as const;
export type ContentCheckModel = (typeof CONTENT_CHECK_MODELS)[number];

export const CONTENT_CHECK_MODEL_LABELS: Record<ContentCheckModel, string> = {
  clef: "Thorough (Clef)",
  "clef-flash": "Fast (Clef Flash)",
};

export const CONTENT_CHECK_OUTCOMES = ["passed", "advised", "blocked", "unchecked"] as const;
export type ContentCheckOutcome = (typeof CONTENT_CHECK_OUTCOMES)[number];

/** How reviewers and organizers read a verdict. */
export const CONTENT_CHECK_OUTCOME_LABELS: Record<ContentCheckOutcome, string> = {
  passed: "No concerns",
  advised: "Concerns raised",
  blocked: "Blocked",
  unchecked: "Not checked",
};

/** Whether a verdict asks a reviewer to look. */
export function contentCheckRaisesConcerns(outcome: ContentCheckOutcome): boolean {
  return outcome === "advised" || outcome === "blocked";
}

export const CONTENT_CHECK_MAX_QUESTIONS = 32;

/** Refusal codes of the proposal screening: a block, or advice the author may set aside by submitting again. */
export const PROPOSAL_CHECK_BLOCKED = "PROPOSAL_CHECK_BLOCKED";
export const PROPOSAL_CHECK_ADVICE = "PROPOSAL_CHECK_ADVICE";
/** Refusal codes of the member page and bio checks, with the same advise-first meaning as the proposal's. */
export const PROFILE_CHECK_BLOCKED = "PROFILE_CHECK_BLOCKED";
export const PROFILE_CHECK_ADVICE = "PROFILE_CHECK_ADVICE";
export const CONTENT_CHECK_QUESTION_ID_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

export interface ContentCheckFlag {
  id: string;
  kind: "flag";
  /** A yes/no question; yes means something is wrong. */
  question: string;
  adviseAtPercent: number;
  /** Null never blocks: the flag only advises. */
  blockAtPercent: number | null;
  /** What the author is told when the flag is raised. */
  message: string;
}

export interface ContentCheckScore {
  id: string;
  kind: "score";
  /** What to rate, shown to reviewers as the score's name. */
  label: string;
  question: string;
  /** Ordered level descriptions, lowest first. */
  levels: string[];
  weight: number;
}

export type ContentCheckQuestion = ContentCheckFlag | ContentCheckScore;

/** The PKIC-wide settings for one kind of check. */
export interface ContentCheckSettings {
  enabled: boolean;
  model: ContentCheckModel;
  context: string;
  questions: ContentCheckQuestion[];
}

/** What one event adds to the PKIC-wide settings. */
export interface ContentCheckEventAdditions {
  context: string;
  /** Added questions; one with the id of a PKIC-wide question replaces it for this event. */
  questions: ContentCheckQuestion[];
  /** PKIC-wide questions this event does not ask. */
  disabledQuestionIds: string[];
}

/** The check as it runs for one event, or PKIC-wide when there is no event. */
export interface EffectiveContentCheck {
  enabled: boolean;
  model: ContentCheckModel;
  context: string;
  questions: ContentCheckQuestion[];
}

export function effectiveContentCheck(
  settings: ContentCheckSettings,
  additions: ContentCheckEventAdditions | null,
): EffectiveContentCheck {
  if (!additions) return { ...settings, questions: [...settings.questions] };
  const disabled = new Set(additions.disabledQuestionIds);
  const replaced = new Map(additions.questions.map((question) => [question.id, question]));
  const questions = settings.questions
    .filter((question) => !disabled.has(question.id))
    .map((question) => replaced.get(question.id) ?? question);
  const kept = new Set(questions.map((question) => question.id));
  for (const question of additions.questions)
    if (!kept.has(question.id) && !disabled.has(question.id)) questions.push(question);
  const context = [settings.context.trim(), additions.context.trim()].filter(Boolean).join("\n\n");
  return {
    enabled: settings.enabled,
    model: settings.model,
    context,
    questions: questions.slice(0, CONTENT_CHECK_MAX_QUESTIONS),
  };
}

/** One model answer: the probability of yes for a flag, the level probabilities for a score. */
export type ContentCheckAnswer = { kind: "flag"; probability: number } | { kind: "score"; probabilities: number[] };

export interface RaisedContentCheckFlag {
  id: string;
  probabilityPercent: number;
  blocking: boolean;
  message: string;
}

export interface ContentCheckScoreResult {
  id: string;
  label: string;
  /** The probability-weighted level, from 0 (lowest) to 100 (highest). */
  percent: number;
  /** The most likely level, as described in the rubric. */
  level: string;
}

export interface ContentCheckVerdict {
  outcome: ContentCheckOutcome;
  flags: RaisedContentCheckFlag[];
  scores: ContentCheckScoreResult[];
  /** The weighted score from 0 to 100, or null when no score was answered. */
  scorePercent: number | null;
}

export const UNCHECKED_CONTENT_VERDICT: ContentCheckVerdict = {
  outcome: "unchecked",
  flags: [],
  scores: [],
  scorePercent: null,
};

function percent(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 10;
}

/** Turns the model's answers into the outcome, the raised flags and the scores. */
export function decideContentCheck(
  questions: readonly ContentCheckQuestion[],
  answers: Readonly<Record<string, ContentCheckAnswer>>,
): ContentCheckVerdict {
  const flags: RaisedContentCheckFlag[] = [];
  const scores: ContentCheckScoreResult[] = [];
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
  const outcome: ContentCheckOutcome = flags.some((flag) => flag.blocking)
    ? "blocked"
    : flags.length
      ? "advised"
      : "passed";
  flags.sort((a, b) => Number(b.blocking) - Number(a.blocking) || b.probabilityPercent - a.probabilityPercent);
  return { outcome, flags, scores, scorePercent: weights > 0 ? Math.round((weighted / weights) * 10) / 10 : null };
}

function blocks(question: ContentCheckFlag, probabilityPercent: number): boolean {
  return question.blockAtPercent !== null && probabilityPercent >= question.blockAtPercent;
}
