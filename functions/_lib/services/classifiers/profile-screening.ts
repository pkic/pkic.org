/**
 * The screening of what members write about themselves, while they are still
 * on the form: a member page or a bio. Like a proposal, the check refuses what
 * it blocks and advises on the rest, which the author may set aside by saving
 * again; the verdict is kept for staff. A check that is off, or a model that
 * cannot answer, lets the text through unchecked.
 */
import {
  PROFILE_CHECK_ADVICE,
  PROFILE_CHECK_BLOCKED,
  type ProfileClassifierKind,
} from "../../../../assets/shared/classifiers";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { runClassifier, type ClassifierRun } from "./model";
import { readEffectiveClassifier } from "./settings";
import { classifierState, type ClassifierSubject } from "./state";

/** The author waits for the screening, so it is given up sooner than a trial. */
const PROFILE_SCREENING_TIMEOUT_MS = 8000;

const NOUNS: Record<ProfileClassifierKind, string> = {
  organization: "page",
  person: "bio",
};

export interface ProfileScreeningInput {
  kind: ProfileClassifierKind;
  subject: ClassifierSubject;
  /** The author saw the advice and saves as written; only a block still refuses. */
  adviceAcknowledged: boolean;
  /** The field where the reasons are shown. */
  field: string;
}

/** Null when no check runs, so the text is saved unchecked. */
export async function screenProfileContent(
  env: Pick<Env, "AI">,
  db: DatabaseLike,
  input: ProfileScreeningInput,
): Promise<ClassifierRun | null> {
  if (!env.AI) return null;
  const check = await readEffectiveClassifier(db, null, input.kind);
  if (!check.enabled || !check.questions.length) return null;
  const run = await runClassifier(env, check, classifierState(input.kind, input.subject), {
    timeoutMs: PROFILE_SCREENING_TIMEOUT_MS,
  });
  const noun = NOUNS[input.kind];
  const { outcome, flags } = run.verdict;
  if (outcome === "blocked") {
    const reasons = flags.filter((flag) => flag.blocking).map((flag) => flag.message);
    throw new AppError(422, PROFILE_CHECK_BLOCKED, `This ${noun} cannot be saved as written.`, {
      formErrors: [`This ${noun} cannot be saved as written. Revise it and save again.`],
      fieldErrors: { [input.field]: [reasons.join(" ")] },
    });
  }
  if (outcome === "advised" && !input.adviceAcknowledged) {
    throw new AppError(422, PROFILE_CHECK_ADVICE, `Review the feedback on your ${noun}.`, {
      formErrors: [`Review the feedback on your ${noun}. Revise it, or save again to keep it as written.`],
      fieldErrors: { [input.field]: [flags.map((flag) => flag.message).join(" ")] },
    });
  }
  return run;
}
