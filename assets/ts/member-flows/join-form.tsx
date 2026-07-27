/**
 * Membership application form (PRD §1.2/§1.4).
 *
 * Replaces the legacy native-POST-to-/api/v1/forms shortcode with a fetch-based
 * shell: category/name/email/organization/legal-agreement fields stay static
 * Hugo markup (they aren't in form_fields and don't need staff editing), while
 * job title, LinkedIn, website, bios, reason, and working-group interest are
 * rendered generically from GET /api/v1/members/applications/form so staff can
 * edit them from the admin portal without a redeploy.
 */
import { render } from "preact";
import { getJson, postJson } from "../shared/api-client";
import { renderCustomFields, readCustomFieldValues } from "../shared/widgets/custom-fields";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form/validation";
import { withLoadingButton, handleSubmitError } from "../shared/form/submit";
import { setStatus, readField, findSubmitButton } from "../shared/form/helpers";
import { SuccessPanel } from "../components/SuccessPanel";
import { memberApplicationCreateSchema } from "../../shared/schemas/member-applications";
import type { FormDefinition } from "../shared/types";

const API_BASE = "/api/v1";
const MEMBERS_DATA_URL = "/members/members-data.json";

const INDIVIDUAL_CATEGORIES = new Set(["H5", "H6", "H7"]);
const UNIVERSITY_EMAIL_CATEGORIES = new Set(["H5"]);

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "proton.me",
  "protonmail.com",
  "protonmail.ch",
  "pm.me",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.it",
  "hotmail.de",
  "outlook.com",
  "live.com",
  "msn.com",
  "live.co.uk",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.fr",
  "yahoo.de",
  "yahoo.it",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "aim.com",
  "mail.com",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "yandex.com",
  "yandex.ru",
  "zoho.com",
  "tutanota.com",
  "tuta.io",
  "fastmail.com",
  "fastmail.fm",
]);

// ── Pure/testable helpers ──────────────────────────────────────────────────

export function isIndividualCategory(categoryCode: string): boolean {
  return INDIVIDUAL_CATEGORIES.has(categoryCode);
}

export function requiresUniversityEmail(categoryCode: string): boolean {
  return UNIVERSITY_EMAIL_CATEGORIES.has(categoryCode);
}

/** Mirrors the historic organization-domain guard from assets/js/form.js. */
export function isPublicEmailDomain(email: string): boolean {
  const value = email.trim().toLowerCase();
  const domain = value.includes("@") ? value.slice(value.lastIndexOf("@") + 1) : "";
  return domain.length > 0 && PUBLIC_EMAIL_DOMAINS.has(domain);
}

/** Mirrors the historic fuzzy duplicate-organization check from assets/js/form.js. */
export function isDuplicateOrganization(orgName: string, existingNames: string[]): boolean {
  const name = orgName.toLowerCase().trim();
  if (!name || existingNames.length === 0) return false;
  if (name.length < 3) return existingNames.some((existing) => existing === name);
  return existingNames.some((existing) => existing === name || existing.includes(name) || name.includes(existing));
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

async function loadExistingOrganizationNames(): Promise<string[]> {
  try {
    const res = await fetch(MEMBERS_DATA_URL);
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (entry): entry is { title: string } =>
          Boolean(entry) && typeof (entry as { title?: unknown }).title === "string",
      )
      .map((entry) => entry.title.toLowerCase().trim());
  } catch {
    return [];
  }
}

function wireDuplicateOrganizationWarning(form: HTMLFormElement, existingNames: string[]): void {
  const orgField = form.querySelector<HTMLInputElement>("#organizationName");
  const warning = form.querySelector<HTMLElement>("[data-organization-warning]");
  if (!orgField || !warning) return;

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    const isDuplicate = isDuplicateOrganization(orgField.value, existingNames);
    warning.classList.toggle("d-none", !isDuplicate);
    orgField.classList.toggle("border-warning", isDuplicate);
  };
  orgField.addEventListener("blur", check);
  orgField.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(check, 500);
  });
}

function wireEmailValidation(form: HTMLFormElement): (categoryCode: string) => void {
  const emailField = form.querySelector<HTMLInputElement>("#email");
  let requireUniversity = false;

  const validate = () => {
    if (!emailField) return;
    if (requireUniversity && isPublicEmailDomain(emailField.value)) {
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
  form.classList.add("d-none");

  const container = document.createElement("div");
  const statusUrl = `/application-status/?id=${encodeURIComponent(applicationId)}&token=${encodeURIComponent(manageToken)}`;

  render(
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
    container,
  );

  root.appendChild(container);
  requestAnimationFrame(() => container.scrollIntoView({ behavior: "smooth", block: "start" }));
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

  void loadExistingOrganizationNames().then((names) => wireDuplicateOrganizationWarning(form, names));

  try {
    const { form: definition } = await getJson<{ form: FormDefinition | null }>(
      `${API_BASE}/members/applications/form`,
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
        const result = await postJson<{ applicationId: string; manageToken: string }>(
          `${API_BASE}/members/applications`,
          payload,
        );
        showSuccessPanel(root, form, result.applicationId, result.manageToken, payload.applicantName);
      } catch (error) {
        handleSubmitError(error, form, statusEl);
      }
    });
  });
}

void main();
