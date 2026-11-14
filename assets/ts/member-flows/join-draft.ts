/**
 * The membership path a signed-in applicant chose and their unsent answers,
 * kept for this tab so a reload or a step away and back continues where they
 * were. The session stays the proof: a reload asks the server for the path
 * again. A draft belongs to the account it was started under and is never
 * shown to another. Agreements are never restored; each is accepted again
 * after reading.
 */
import { z } from "zod";
import { readCustomFieldValues } from "../shared/widgets/custom-fields";
import { memberJoinVerifySchema } from "../../shared/schemas/member-join";

const STORAGE_KEY = "pkic.join.verifiedApplication";

const joinChoiceSchema = memberJoinVerifySchema.pick({
  unaffiliatedAttestation: true,
  organizationId: true,
  organizationName: true,
  domain: true,
  continueAsIndividual: true,
});
/** How the applicant is joining, and the organization they chose on the way. */
export type JoinChoice = z.infer<typeof joinChoiceSchema>;

const joinDraftSchema = z.object({
  applicantUserId: z.string(),
  values: z.record(z.string(), z.string()),
  checked: z.array(z.string()),
  // Unsent answers may be incomplete or exceed the submission contract.
  answers: z.record(z.string(), z.unknown()),
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

function hasAnswers(draft: JoinDraft): boolean {
  return draft.checked.length > 0 || Object.keys(draft.values).length > 0 || Object.keys(draft.answers).length > 0;
}

/** Keeps the draft of the account that is applying; another account starts a fresh one. */
export function rememberJoinApplicant(applicantUserId: string): void {
  const current = read();
  write(
    current?.applicantUserId === applicantUserId ? current : { applicantUserId, values: {}, checked: [], answers: {} },
  );
}

/** Forgets the path and its answers: after submitting, or when the path ends without an application. */
export function forgetJoinDraft(): void {
  write(null);
}

function restorable(element: Element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (
    !(
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    )
  )
    return false;
  if (!element.name || element.name.startsWith("custom.") || element.matches("[data-membership-legal-input]"))
    return false;
  return !(element instanceof HTMLInputElement) || !["file", "submit", "button", "hidden"].includes(element.type);
}

/** Records what the applicant has entered so far. */
export function saveJoinAnswers(form: HTMLFormElement): void {
  const current = read();
  if (!current) return;
  const values: Record<string, string> = {};
  const checked: string[] = [];
  for (const element of Array.from(form.elements)) {
    if (!restorable(element)) continue;
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
      if (element.checked) checked.push(`${element.name}=${element.value}`);
    } else values[element.name] = element.value;
  }
  const answers = readCustomFieldValues(form);
  for (const agreement of form.querySelectorAll<HTMLInputElement>("[data-membership-legal-input]")) {
    delete answers[agreement.name.replace(/^custom\./, "")];
  }
  write({ ...current, values, checked, answers });
}

/**
 * Puts kept answers back into the form. The category goes first and is
 * announced as a change, because it decides which questions the form asks;
 * `renderQuestions` then answers those questions through their own widgets.
 * Returns whether anything was restored.
 */
export function restoreJoinAnswers(
  form: HTMLFormElement,
  renderQuestions: (answers: Record<string, unknown>) => void,
): boolean {
  const draft = read();
  if (!draft || !hasAnswers(draft)) return false;
  const checked = new Set(draft.checked);
  const category = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="membershipCategory"]')).find(
    (input) => checked.has(`membershipCategory=${input.value}`),
  );
  if (category && !category.checked) {
    category.checked = true;
    category.dispatchEvent(new Event("change", { bubbles: true }));
  }
  renderQuestions(draft.answers);
  for (const element of Array.from(form.elements)) {
    if (!restorable(element) || element.name === "membershipCategory") continue;
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio"))
      element.checked = checked.has(`${element.name}=${element.value}`);
    else if (element.name in draft.values) element.value = draft.values[element.name];
  }
  return true;
}
