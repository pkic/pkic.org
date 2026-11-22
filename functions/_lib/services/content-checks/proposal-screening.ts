/**
 * The first screening of a proposal, while its author is still on the form:
 * the check refuses what it blocks and returns its advice, which the author
 * may follow or set aside. The verdict and its scores are kept for reviewers.
 */
import { PROPOSAL_CHECK_ADVICE, PROPOSAL_CHECK_BLOCKED } from "../../../../assets/shared/content-checks";
import type { Env } from "../../types";
import { AppError } from "../../errors";
import { runContentCheck, type ContentCheckRun } from "./model";
import { readEffectiveContentCheck } from "./settings";
import { contentCheckState, textAnswers } from "./state";

/** The author waits for the screening, so it is given up sooner than a trial. */
const PROPOSAL_SCREENING_TIMEOUT_MS = 8000;

export interface ProposalScreeningInput {
  eventId: string;
  type: string;
  title: string;
  abstract: string;
  details?: Record<string, unknown> | null;
  /** The author saw the advice and submits as written; only a block still refuses. */
  adviceAcknowledged: boolean;
}

/** Null when no check runs for the event, so the proposal goes on unchecked. */
export async function screenProposal(
  env: Pick<Env, "AI" | "DB">,
  input: ProposalScreeningInput,
): Promise<ContentCheckRun | null> {
  if (!env.AI) return null;
  const check = await readEffectiveContentCheck(env.DB, input.eventId, "proposal");
  if (!check.enabled || !check.questions.length) return null;
  const run = await runContentCheck(
    env,
    check,
    contentCheckState("proposal", {
      title: input.title,
      format: input.type,
      text: input.abstract,
      answers: textAnswers(input.details ?? undefined),
    }),
    { timeoutMs: PROPOSAL_SCREENING_TIMEOUT_MS },
  );
  const { outcome, flags } = run.verdict;
  if (outcome === "blocked") {
    const reasons = flags.filter((flag) => flag.blocking).map((flag) => flag.message);
    throw new AppError(422, PROPOSAL_CHECK_BLOCKED, "This proposal cannot be submitted as written.", {
      formErrors: ["This proposal cannot be submitted as written. Revise it and submit again."],
      fieldErrors: { "proposal.abstract": [reasons.join(" ")] },
    });
  }
  if (outcome === "advised" && !input.adviceAcknowledged) {
    throw new AppError(422, PROPOSAL_CHECK_ADVICE, "Review the feedback on your proposal.", {
      formErrors: ["Review the feedback on your proposal. Revise it, or submit again to send it as written."],
      fieldErrors: { "proposal.abstract": [flags.map((flag) => flag.message).join(" ")] },
    });
  }
  return run;
}
