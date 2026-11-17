/**
 * The membership path a signed-in applicant chose, kept for this tab so a
 * reload or a step away and back continues where they were. The session stays
 * the proof: a reload asks the server for the path again. A draft belongs to
 * the account it was started under and is never shown to another.
 */
import { z } from "zod";
import { memberJoinVerifySchema } from "../../shared/schemas/member-join";

const STORAGE_KEY = "pkic.join.verifiedApplication";

const joinChoiceSchema = memberJoinVerifySchema.pick({
  unaffiliatedAttestation: true,
  organizationId: true,
  continueAsIndividual: true,
});
/** How the applicant is joining, and the organization they chose on the way. */
export type JoinChoice = z.infer<typeof joinChoiceSchema>;

const joinDraftSchema = z.object({
  applicantUserId: z.string(),
  choice: joinChoiceSchema.optional(),
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

/** Forgets the path: after submitting, or when the path ends without an application. */
export function forgetJoinDraft(): void {
  write(null);
}
