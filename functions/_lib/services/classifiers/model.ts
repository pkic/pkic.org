/**
 * Asks the check model once: every question of a check in one request, so a
 * check costs one model call however many questions it has.
 */
import {
  CLASSIFIER_MODELS,
  decideClassifier,
  UNCHECKED_CONTENT_VERDICT,
  type ClassifierAnswer,
  type ClassifierModel,
  type ClassifierVerdict,
  type EffectiveClassifier,
} from "../../../../assets/shared/classifiers";
import { logError } from "../../logging";
import type { Env } from "../../types";

const MODEL_IDS: Record<ClassifierModel, string> = {
  clef: "@cf/cloudflare/clef",
  "clef-flash": "@cf/cloudflare/clef-flash",
};
const DEFAULT_TIMEOUT_MS = 6000;

export interface ClassifierRun {
  verdict: ClassifierVerdict;
  /** Every answer, raised or not: the trial bench shows them for tuning. */
  answers: Record<string, ClassifierAnswer>;
  model: ClassifierModel | null;
  latencyMs: number;
}

/** The model request for a check: each question with the check's context beside it. */
export function classifierModelInput(check: EffectiveClassifier, state: unknown): Record<string, unknown> {
  const instructions = (question: string) => (check.context ? { question, context: check.context } : question);
  return {
    model: check.model,
    state,
    questions: Object.fromEntries(
      check.questions.map((question) => [
        question.id,
        question.kind === "flag"
          ? { type: "noul", instructions: instructions(question.question) }
          : { type: "score", instructions: instructions(question.question), criteria: question.levels },
      ]),
    ),
  };
}

interface RawAnswer {
  type?: unknown;
  noul?: unknown;
  probabilities?: unknown;
}

/** Reads the answers the model gave, keeping only well-formed ones for the questions asked. */
export function readClassifierAnswers(check: EffectiveClassifier, output: unknown): Record<string, ClassifierAnswer> {
  const raw = (output as { answers?: Record<string, RawAnswer> } | null)?.answers;
  const answers: Record<string, ClassifierAnswer> = {};
  if (!raw || typeof raw !== "object") return answers;
  for (const question of check.questions) {
    const answer = raw[question.id];
    if (!answer || typeof answer !== "object") continue;
    if (question.kind === "flag" && typeof answer.noul === "number" && Number.isFinite(answer.noul))
      answers[question.id] = { kind: "flag", probability: answer.noul };
    if (question.kind === "score") {
      const levels = levelProbabilities(answer.probabilities, question.levels.length);
      if (levels) answers[question.id] = { kind: "score", probabilities: levels };
    }
  }
  return answers;
}

/** Level probabilities come as an array or as a map keyed by level index. */
function levelProbabilities(value: unknown, levels: number): number[] | null {
  if (!value || typeof value !== "object") return null;
  const read = (index: number) => {
    const entry = Array.isArray(value) ? value[index] : (value as Record<string, unknown>)[String(index)];
    return typeof entry === "number" && Number.isFinite(entry) ? entry : 0;
  };
  const probabilities = Array.from({ length: levels }, (_, index) => read(index));
  return probabilities.some((probability) => probability > 0) ? probabilities : null;
}

/**
 * Runs a check. A check that is off, has no questions, or that the model cannot answer in time is unchecked:
 * the caller decides what unchecked means for its content.
 */
export async function runClassifier(
  env: Pick<Env, "AI">,
  check: EffectiveClassifier,
  state: unknown,
  options: { timeoutMs?: number } = {},
): Promise<ClassifierRun> {
  const started = Date.now();
  if (!env.AI || !check.enabled || !check.questions.length || !CLASSIFIER_MODELS.includes(check.model))
    return { verdict: UNCHECKED_CONTENT_VERDICT, answers: {}, model: null, latencyMs: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const output = await Promise.race([
      env.AI.run(MODEL_IDS[check.model], classifierModelInput(check, state)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("CLASSIFIER_TIMEOUT")), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      }),
    ]);
    const answers = readClassifierAnswers(check, output);
    const latencyMs = Date.now() - started;
    if (!Object.keys(answers).length)
      return { verdict: UNCHECKED_CONTENT_VERDICT, answers, model: check.model, latencyMs };
    return { verdict: decideClassifier(check.questions, answers), answers, model: check.model, latencyMs };
  } catch (error) {
    // The checked text is the author's; keep it out of logs.
    logError("CLASSIFIER_FAILED", { reason: error instanceof Error ? error.message.slice(0, 120) : "unknown" });
    return { verdict: UNCHECKED_CONTENT_VERDICT, answers: {}, model: check.model, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
