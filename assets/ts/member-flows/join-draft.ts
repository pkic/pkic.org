/**
 * The membership path a signed-in applicant chose and their unsent answers,
 * kept for this tab so a reload, a step away and back, or a change to their
 * representation continues where they were. The session stays the proof: a
 * reload asks the server for the path again. A draft belongs to the account
 * it was started under and its answers to the identity they were given for;
 * neither is shown to another. Agreements are never restored; each is accepted
 * again after reading.
 */
import { z } from "zod";
import { readCustomFieldValues } from "../shared/widgets/custom-fields";
import { memberJoinVerifySchema } from "../../shared/schemas/member-join";

const STORAGE_KEY = "pkic.join.verifiedApplication";

const joinChoiceSchema = memberJoinVerifySchema.pick({
  unaffiliatedAttestation: true,
  organizationId: true,
  continueAsIndividual: true,
});
/** How the applicant is joining, and the organization they chose on the way. */
export type JoinChoice = z.infer<typeof joinChoiceSchema>;

const joinAnswersSchema = z.object({
  identityId: z.string(),
  checked: z.array(z.string()),
  // Unsent answers may be incomplete or exceed the submission contract.
  answers: z.record(z.string(), z.unknown()),
});

const joinDraftSchema = z.object({
  applicantUserId: z.string(),
  choice: joinChoiceSchema.optional(),
  application: joinAnswersSchema.optional(),
});
type JoinDraft = z.infer<typeof joinDraftSchema>;

function read(): JoinDraft | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = joinDraftSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function write(draft: JoinDraft | null): void {
  try {
    if (draft) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Without storage a reload asks how the applicant is joining again; nothing else depends on it.
  }
}

/** The path this account chose earlier in this tab, if any. */
export function rememberedJoinChoice(applicantUserId: string): JoinChoice | undefined {
  const draft = read();
  return draft?.applicantUserId === applicantUserId ? draft.choice : undefined;
}

export function rememberJoinChoice(choice?: JoinChoice): void {
  const current = read();
  if (current) write({ ...current, choice });
}

/** Keeps the draft of the account that is applying; another account starts a fresh one. */
export function rememberJoinApplicant(applicantUserId: string): void {
  const current = read();
  write(current?.applicantUserId === applicantUserId ? current : { applicantUserId });
}

/** Forgets the path and its answers: after submitting, or when the path ends without an application. */
export function forgetJoinDraft(): void {
  write(null);
}

/** The category and question answers; agreements stay out. */
function categoryInputs(form: HTMLFormElement): HTMLInputElement[] {
  return Array.from(form.querySelectorAll<HTMLInputElement>('input[name="membershipCategory"]'));
}

/** Records what the applicant has entered so far for the identity they apply as. */
export function saveJoinAnswers(form: HTMLFormElement, identityId: string): void {
  const current = read();
  if (!current) return;
  const checked = categoryInputs(form)
    .filter((input) => input.checked)
    .map((input) => input.value);
  const answers = readCustomFieldValues(form);
  for (const agreement of form.querySelectorAll<HTMLInputElement>("[data-membership-legal-input]")) {
    delete answers[agreement.name.replace(/^custom\./, "")];
  }
  write({ ...current, application: { identityId, checked, answers } });
}

/**
 * Puts the answers kept for `identityId` back into the form. The category goes
 * first and is announced as a change, because it decides which questions the
 * form asks; `renderQuestions` then answers those questions through their own
 * widgets. Returns whether anything was restored.
 */
export function restoreJoinAnswers(
  form: HTMLFormElement,
  identityId: string,
  renderQuestions: (answers: Record<string, unknown>) => void,
): boolean {
  const kept = read()?.application;
  if (!kept || kept.identityId !== identityId) return false;
  if (kept.checked.length === 0 && Object.keys(kept.answers).length === 0) return false;
  const category = categoryInputs(form).find((input) => kept.checked.includes(input.value));
  if (category && !category.checked) {
    category.checked = true;
    category.dispatchEvent(new Event("change", { bubbles: true }));
  }
  renderQuestions(kept.answers);
  return true;
}
