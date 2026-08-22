/**
 * Membership application form.
 *
 * Replaces the legacy native-POST-to-/api/v1/forms shortcode with a fetch-based
 * shell: category/name/email/organization/legal-agreement fields stay static
 * Hugo markup (they aren't in form_fields and don't need staff editing), while
 * job title, LinkedIn, website, bios, reason, and working-group interest are
 * rendered generically from GET /api/v1/members/applications/form so staff can
 * edit them from the admin portal without a redeploy.
 */
import { getJson, postJson } from "../shared/api-client";
import { renderCustomFields, readCustomFieldValues } from "../shared/widgets/custom-fields";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form/validation";
import { withLoadingButton, handleSubmitError } from "../shared/form/submit";
import { setStatus, readField, findSubmitButton } from "../shared/form/helpers";
import { SuccessPanel } from "../components/SuccessPanel";
import { replaceFormWithSuccess } from "../shared/form/success-panel";
import {
  memberApplicationCreateResponseSchema,
  memberApplicationCreateSchema,
  memberApplicationFormResponseSchema,
} from "../../shared/schemas/member-applications";
import { INDIVIDUAL_MEMBERSHIP_CATEGORIES, requiresUniversityEmail } from "../../shared/schemas/membership-categories";
import { isPersonalEmailAddress } from "../../shared/constants/email-domains";

const API_BASE = "/api/v1";

// ── Pure/testable helpers ──────────────────────────────────────────────────

export function isIndividualCategory(categoryCode: string): boolean {
  return INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(categoryCode);
}

/** Reads the checked legal/interest checkboxes into the free-form `answers` bucket. */
export function readLegalAndInterestAnswers(form: HTMLFormElement): Record<string, unknown> {
  const legalAgreements = Array.from(form.querySelectorAll<HTMLInputElement>("[data-legal-agreement]:checked")).map(
    (el) => el.dataset.legalAgreement ?? "",
  );

  const contribution = form.querySelector<HTMLInputElement>('input[name="contribution"]:checked')?.value;

  return {
    legalAgreements,
    warrantedAuthority: form.querySelector<HTMLInputElement>("#warrantAuthority")?.checked ?? false,
    contributionType: contribution || undefined,
    wantsToPresent: form.querySelector<HTMLInputElement>("#contribute")?.checked ?? false,
    interestedInSponsoring: form.querySelector<HTMLInputElement>("#sponsoring")?.checked ?? false,
  };
}

export interface ApplicationPayloadInput {
  applicantEmail: string;
  applicantName: string;
  membershipCategory: string;
  organizationName?: string;
  answers: Record<string, unknown>;
}

/** Assembles the full submission payload from the static form fields + generic custom-field answers. */
export function buildApplicationPayload(form: HTMLFormElement, categoryCode: string): ApplicationPayloadInput {
  const firstName = readField(form, "firstName");
  const lastName = readField(form, "lastName");
  const organizationName = readField(form, "organizationName");

  return {
    applicantEmail: readField(form, "email"),
    applicantName: [firstName, lastName].filter(Boolean).join(" "),
    membershipCategory: categoryCode,
    organizationName: isIndividualCategory(categoryCode) ? undefined : organizationName || undefined,
    answers: {
      ...readCustomFieldValues(form),
      ...readLegalAndInterestAnswers(form),
    },
  };
}

/** Toggles the organization-name field's required/disabled state for individual categories. */
export function applyCategoryUI(form: HTMLFormElement, categoryCode: string): void {
  const orgField = form.querySelector<HTMLInputElement>("#organizationName");
  if (!orgField) return;
  const individual = isIndividualCategory(categoryCode);
  orgField.required = !individual;
  orgField.disabled = individual;
  if (individual) orgField.value = "";
}

// ── Main ──────────────────────────────────────────────────────────────────

function readSelectedCategory(form: HTMLFormElement): string {
  return form.querySelector<HTMLInputElement>('input[name="category"]:checked')?.value ?? "";
}

function wireEmailValidation(form: HTMLFormElement): (categoryCode: string) => void {
  const emailField = form.querySelector<HTMLInputElement>("#email");
  let requireUniversity = false;

  const validate = () => {
    if (!emailField) return;
    if (requireUniversity && isPersonalEmailAddress(emailField.value)) {
      emailField.setCustomValidity(
        "Category (h5) requires your university email address; public email providers are not accepted.",
      );
    } else {
      emailField.setCustomValidity("");
    }
  };

  emailField?.addEventListener("input", validate);
  emailField?.addEventListener("blur", validate);

  return (categoryCode: string) => {
    requireUniversity = requiresUniversityEmail(categoryCode);
    validate();
  };
}

function showSuccessPanel(
  root: HTMLElement,
  form: HTMLFormElement,
  applicationId: string,
  manageToken: string,
  applicantName: string,
): void {
  const statusUrl = `/application-status/?id=${encodeURIComponent(applicationId)}&token=${encodeURIComponent(manageToken)}`;

  replaceFormWithSuccess(
    root,
    form,
    <SuccessPanel icon="🎉" title={`Thanks${applicantName ? `, ${applicantName}` : ""}!`}>
      <p class="event-flow-success-body">
        Your membership application has been received. We&rsquo;ve emailed you a confirmation with a link to check its
        status at any time.
      </p>
      <p>
        <a href={statusUrl} class="btn btn-outline-secondary btn-sm">
          Check application status →
        </a>
      </p>
    </SuccessPanel>,
  );
}

async function main(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-member-application]");
  if (!root) return;
  const form = root.querySelector<HTMLFormElement>("#inputForm");
  const statusEl = root.querySelector<HTMLElement>("[data-flow-status]");
  const customFieldsContainer = root.querySelector<HTMLElement>("[data-custom-fields]");
  if (!form || !statusEl) return;

  installLiveValidation(form, statusEl);

  const updateEmailRule = wireEmailValidation(form);

  form.querySelectorAll<HTMLInputElement>('input[name="category"]').forEach((input) => {
    input.addEventListener("change", () => {
      const category = readSelectedCategory(form);
      applyCategoryUI(form, category);
      updateEmailRule(category);
    });
  });

  try {
    const { form: definition } = memberApplicationFormResponseSchema.parse(
      await getJson<unknown>(`${API_BASE}/members/applications/form`),
    );
    if (customFieldsContainer) renderCustomFields(customFieldsContainer, definition?.fields ?? []);
  } catch {
    setStatus(statusEl, "Could not load the application form. Please refresh and try again.", true);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    form.classList.add("was-validated");
    if (!validateBeforeSubmit(form, statusEl)) return;

    const category = readSelectedCategory(form);
    if (!category) {
      setStatus(statusEl, "Please choose an eligibility category.", true);
      return;
    }

    await withLoadingButton(findSubmitButton(form), async () => {
      try {
        const payload = memberApplicationCreateSchema.parse(buildApplicationPayload(form, category));
        const result = memberApplicationCreateResponseSchema.parse(
          await postJson<unknown>(`${API_BASE}/members/applications`, payload),
        );
        showSuccessPanel(root, form, result.applicationId, result.manageToken, payload.applicantName);
      } catch (error) {
        handleSubmitError(error, form, statusEl);
      }
    });
  });
}

void main();
