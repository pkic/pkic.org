/**
 * A trial runs a check on sample text with settings that are not saved yet,
 * so staff can tune questions and thresholds before content meets them.
 */
import type { ClassifierKind } from "../../../../assets/shared/classifiers";
import type { ClassifierTrialInput, ClassifierTrialResponse } from "../../../../assets/shared/schemas/classifiers";
import { enforceRateLimit } from "../../rate-limit";
import type { Env } from "../../types";
import { runClassifier } from "./model";
import { classifierState } from "./state";

/** A trial waits longer than a live check: someone is watching it and may test a long text. */
const TRIAL_TIMEOUT_MS = 20_000;

export async function runClassifierTrial(
  env: Pick<Env, "AI" | "IP_RATE_LIMITER">,
  userId: string,
  kind: ClassifierKind,
  input: ClassifierTrialInput,
): Promise<ClassifierTrialResponse> {
  // Each trial is a paid model call, so one person cannot run them without limit.
  await enforceRateLimit({ binding: env.IP_RATE_LIMITER, namespace: "classifier-trial:user", key: userId });
  const check = { enabled: true, model: input.model, context: input.context, questions: input.questions };
  const state = classifierState(kind, { text: input.text, title: input.title });
  const run = await runClassifier(env, check, state, { timeoutMs: TRIAL_TIMEOUT_MS });
  return {
    verdict: run.verdict,
    model: run.model,
    latencyMs: Math.round(run.latencyMs),
    answers: Object.entries(run.answers).map(([id, answer]) => ({
      id,
      percent:
        answer.kind === "flag"
          ? Math.round(answer.probability * 100)
          : (run.verdict.scores.find((score) => score.id === id)?.percent ?? 0),
    })),
  };
}
