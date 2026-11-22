/**
 * A trial runs a check on sample text with settings that are not saved yet,
 * so staff can tune questions and thresholds before content meets them.
 */
import type { ContentCheckKind } from "../../../../assets/shared/content-checks";
import type {
  ContentCheckTrialInput,
  ContentCheckTrialResponse,
} from "../../../../assets/shared/schemas/content-checks";
import { enforceRateLimit } from "../../rate-limit";
import type { Env } from "../../types";
import { runContentCheck } from "./model";
import { contentCheckState } from "./state";

/** A trial waits longer than a live check: someone is watching it and may test a long text. */
const TRIAL_TIMEOUT_MS = 20_000;

export async function runContentCheckTrial(
  env: Pick<Env, "AI" | "IP_RATE_LIMITER">,
  userId: string,
  kind: ContentCheckKind,
  input: ContentCheckTrialInput,
): Promise<ContentCheckTrialResponse> {
  // Each trial is a paid model call, so one person cannot run them without limit.
  await enforceRateLimit({ binding: env.IP_RATE_LIMITER, namespace: "content-check-trial:user", key: userId });
  const check = { enabled: true, model: input.model, context: input.context, questions: input.questions };
  const state = contentCheckState(kind, { text: input.text, title: input.title });
  const run = await runContentCheck(env, check, state, { timeoutMs: TRIAL_TIMEOUT_MS });
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
