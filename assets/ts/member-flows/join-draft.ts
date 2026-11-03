/**
 * The verified path and unsent answers of a membership application, kept for
 * this tab so a reload or a step away and back continues where the applicant
 * was. The emailed link stays the proof: a reload verifies the kept token again
 * and starts over when it has expired. Agreements are never restored; each is
 * accepted again after reading.
 */
import { z } from "zod";
import { readCustomFieldValues } from "../shared/widgets/custom-fields";

const STORAGE_KEY = "pkic.join.verifiedApplication";

const joinDraftSchema = z.object({
  token: z.string(),
  values: z.record(z.string(), z.string()),
  checked: z.array(z.string()),
  // Unsent answers may be incomplete or exceed the submission contract.
  answers: z.record(z.string(), z.unknown()),
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
    // Without storage a reload starts from the email step again; nothing else depends on it.
  }
}

/** The verification token kept from an earlier visit in this tab, if any. */
export function rememberedJoinToken(): string | null {
  return read()?.token ?? null;
}

/** Keeps a token that verified; a different token starts a fresh draft. */
export function rememberJoinToken(token: string): void {
  const current = read();
  write(current?.token === token ? current : { token, values: {}, checked: [], answers: {} });
}

/** Forgets the path and its answers: after submitting, or when the kept link no longer verifies. */
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
  if (
    !draft ||
    (draft.checked.length === 0 && Object.keys(draft.values).length === 0 && Object.keys(draft.answers).length === 0)
  )
    return false;
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
