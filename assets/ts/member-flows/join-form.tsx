/**
 * Membership application form.
 *
 * Starts from mailbox verification, then renders only the server-authorized
 * application path. The browser never decides whether a person may join for
 * an organization or as an individual.
 */
import { getJson, postJson } from "../shared/api-client";
import { renderCustomFields, readCustomFieldValues } from "../shared/widgets/custom-fields";
import { clearStatus, installLiveValidation, validateBeforeSubmit } from "../shared/form/validation";
import { withLoadingButton, handleSubmitError } from "../shared/form/submit";
import { setStatus, readField, findSubmitButton } from "../shared/form/helpers";
import { SuccessPanel } from "../components/SuccessPanel";
import { replaceFormWithSuccess } from "../shared/form/success-panel";
import { isPersonalEmailAddress } from "../../shared/constants/email-domains";
import {
  memberApplicationCreateResponseSchema,
  memberApplicationCreateSchema,
  memberApplicationFormResponseSchema,
  type MemberApplicationFormResponse,
} from "../../shared/schemas/member-applications";
import type { z } from "zod";
import {
  memberJoinStartResponseSchema,
  memberJoinStartSchema,
  memberJoinVerifyResponseSchema,
  memberJoinVerifySchema,
} from "../../shared/schemas/member-join";

const API_BASE = "/api/v1";

type JoinApplicationContext = Extract<z.infer<typeof memberJoinVerifyResponseSchema>, { status: "application_ready" }>;
type MembershipCategory = MemberApplicationFormResponse["categories"][number];
type JoinApplicantKind = JoinApplicationContext["applicantKind"];
type MembershipApplicationField = NonNullable<MemberApplicationFormResponse["form"]>["fields"][number];

export const ORGANIZATION_EMAIL_POLICY_MESSAGE =
  "Use your official work or organization email address. Personal or free email addresses such as Gmail are not accepted for organization participation.";

// ── Pure/testable helpers ──────────────────────────────────────────────────

export interface ApplicationPayloadInput {
  applicantEmail: string;
  applicantName: string;
  membershipCategory: string;
  organizationName?: string;
  joinToken: string;
  answers: Record<string, unknown>;
}

/** Assembles the full submission payload from the static form fields + generic custom-field answers. */
export function buildApplicationPayload(
  form: HTMLFormElement,
  categoryCode: string,
  context: JoinApplicationContext,
): ApplicationPayloadInput {
  const firstName = readField(form, "firstName");
  const lastName = readField(form, "lastName");
  const organizationName = readField(form, "organizationName");

  return {
    applicantEmail: context.applicantEmail,
    applicantName: [firstName, lastName].filter(Boolean).join(" "),
    membershipCategory: categoryCode,
    organizationName: context.applicantKind === "individual" ? undefined : organizationName || undefined,
    joinToken: context.joinToken,
    answers: readCustomFieldValues(form),
  };
}

/** The category catalog is server-provided; this only mirrors its selected presentation state. */
export function applyCategoryUI(form: HTMLFormElement, category: MembershipCategory | undefined): void {
  const orgField = form.querySelector<HTMLInputElement>("#organizationName");
  const orgFieldContainer = form.querySelector<HTMLElement>("[data-organization-name-field]");
  if (!orgField || !orgFieldContainer) return;
  const individual = category?.isIndividual ?? false;
  orgField.required = !individual;
  orgField.disabled = individual;
  orgFieldContainer.hidden = individual;
  if (individual) orgField.value = "";
}

export function filterCategoriesForApplicantKind(
  categories: MembershipCategory[],
  applicantKind: JoinApplicationContext["applicantKind"],
): MembershipCategory[] {
  return categories.filter((category) => category.isIndividual === (applicantKind === "individual"));
}

export function renderMembershipCategorySummary(container: HTMLElement, categories: MembershipCategory[]): void {
  if (categories.length === 0) {
    container.textContent = "No eligible individual categories are currently available.";
    return;
  }

  const list = document.createElement("ul");
  list.className = "mb-0 ps-3";
  for (const category of categories) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = `${category.code} — ${category.label}`;
    item.append(title);
    if (category.description) {
      const description = document.createElement("span");
      description.className = "d-block";
      description.textContent = category.description;
      item.append(description);
    }
    list.append(item);
  }
  container.replaceChildren(list);
}

/**
 * Binds D1 form-field policy to the server-rendered canonical legal documents
 * and removes those fields from the generic custom-question renderer.
 */
export function configureMembershipLegalFields(
  form: HTMLFormElement,
  fields: MembershipApplicationField[],
): MembershipApplicationField[] {
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const configuredKeys = new Set<string>();
  const entries = form.querySelectorAll<HTMLElement>("[data-membership-legal-field]");

  for (const entry of Array.from(entries)) {
    const key = entry.dataset.membershipLegalField;
    const field = key ? fieldsByKey.get(key) : undefined;
    const input = entry.querySelector<HTMLInputElement>("[data-membership-legal-input]");
    const label = entry.querySelector<HTMLElement>("[data-membership-legal-label]");
    const configured = Boolean(key && field?.fieldType === "boolean" && input && label);
    entry.hidden = !configured;
    if (input) input.disabled = !configured;
    if (!configured || !key || !field || !input || !label) continue;

    input.required = field.required;
    label.textContent = field.label;
    configuredKeys.add(key);
  }

  const agreements = form.querySelector<HTMLElement>("[data-membership-legal-agreements]");
  if (agreements) agreements.hidden = configuredKeys.size === 0;

  return fields.filter((field) => !configuredKeys.has(field.key));
}

function clearOrganizationEmailPolicyError(form: HTMLFormElement, email: HTMLInputElement): void {
  if (email.dataset.joinEmailPolicyError !== "true") return;
  if (email.validationMessage === ORGANIZATION_EMAIL_POLICY_MESSAGE) email.setCustomValidity("");
  delete email.dataset.joinEmailPolicyError;
  email.classList.remove("is-invalid");
  if (email.checkValidity()) email.removeAttribute("aria-invalid");
  const error = form.querySelector<HTMLElement>('[data-field-error="email"]');
  if (error?.textContent === ORGANIZATION_EMAIL_POLICY_MESSAGE) error.textContent = "";
}

/** Adds immediate field-level guidance while the server remains the policy authority. */
export function applyJoinEmailPolicy(form: HTMLFormElement, applicantKind: JoinApplicantKind | null): boolean {
  const email = form.querySelector<HTMLInputElement>("#joinEmail");
  if (!email) return true;
  clearOrganizationEmailPolicyError(form, email);

  const blocked =
    applicantKind === "organization" &&
    email.value.trim().length > 0 &&
    email.checkValidity() &&
    isPersonalEmailAddress(email.value);
  if (!blocked) return true;

  email.setCustomValidity(ORGANIZATION_EMAIL_POLICY_MESSAGE);
  email.dataset.joinEmailPolicyError = "true";
  email.classList.add("is-invalid");
  email.setAttribute("aria-invalid", "true");
  const error = form.querySelector<HTMLElement>('[data-field-error="email"]');
  if (error) error.textContent = ORGANIZATION_EMAIL_POLICY_MESSAGE;
  return false;
}

/** Keeps the organization and individual join-start states mutually exclusive. */
export function applyJoinApplicantKindUI(form: HTMLFormElement, applicantKind: JoinApplicantKind | null): void {
  const details = form.querySelector<HTMLElement>("[data-join-path-details]");
  const organizationPolicy = form.querySelector<HTMLElement>("[data-join-organization-policy]");
  const individualPolicy = form.querySelector<HTMLElement>("[data-join-individual-policy]");
  const individualCategories = form.querySelector<HTMLElement>("[data-join-individual-categories]");
  const email = form.querySelector<HTMLInputElement>("#joinEmail");
  const emailLabel = form.querySelector<HTMLElement>("[data-join-email-label]");
  const emailHelp = form.querySelector<HTMLElement>("[data-join-email-help]");
  if (!details || !organizationPolicy || !individualPolicy || !email || !emailLabel || !emailHelp) return;

  const selected = applicantKind !== null;
  const individual = applicantKind === "individual";
  details.hidden = !selected;
  organizationPolicy.hidden = applicantKind !== "organization";
  individualPolicy.hidden = !individual;
  if (individualCategories) individualCategories.hidden = !individual;
  email.disabled = !selected;
  emailLabel.textContent = individual
    ? "Your personal or university email address"
    : "Your official work or organization email address";
  email.placeholder = individual ? "you@example.com" : "you@organization.example";
  emailHelp.textContent = individual
    ? "We will verify this address before continuing with an eligible individual application."
    : "We will verify this address before showing the appropriate organization path.";
  clearOrganizationEmailPolicyError(form, email);
}

export function renderMembershipCategories(container: HTMLElement, categories: MembershipCategory[]): void {
  container.replaceChildren(
    ...categories.map((category) => {
      const wrapper = document.createElement("div");
      wrapper.className = "form-check mb-2";
      const id = `membership-category-${category.code.toLowerCase()}`;
      const input = document.createElement("input");
      input.className = "form-check-input";
      input.type = "radio";
      input.id = id;
      input.name = "category";
      input.value = category.code;
      input.required = true;
      input.dataset.individual = String(category.isIndividual);
      const label = document.createElement("label");
      label.className = "form-check-label";
      label.htmlFor = id;
      const title = document.createElement("strong");
      title.textContent = `${category.code} — ${category.label}`;
      label.append(title);
      if (category.description) {
        const description = document.createElement("span");
        description.className = "d-block form-text";
        description.textContent = category.description;
        label.append(description);
      }
      wrapper.append(input, label);
      return wrapper;
    }),
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

function readSelectedCategory(form: HTMLFormElement): string {
  return form.querySelector<HTMLInputElement>('input[name="category"]:checked')?.value ?? "";
}

function readJoinApplicantKind(form: HTMLFormElement): JoinApplicantKind | null {
  const value = form.querySelector<HTMLInputElement>('input[name="applicantKind"]:checked')?.value;
  if (value === "organization" || value === "individual") return value;
  return null;
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
  const statusEl = root.querySelector<HTMLElement>("[data-flow-status]");
  const startSection = root.querySelector<HTMLElement>("[data-join-start]");
  const startForm = root.querySelector<HTMLFormElement>("[data-join-start-form]");
  const applicationForm = root.querySelector<HTMLFormElement>("[data-join-application-form]");
  const pendingSection = root.querySelector<HTMLElement>("[data-join-verification-pending]");
  const accessSection = root.querySelector<HTMLElement>("[data-join-organization-access]");
  const supportSection = root.querySelector<HTMLElement>("[data-join-support-required]");
  const pendingEmail = root.querySelector<HTMLElement>("[data-join-pending-email]");
  const verifiedEmail = root.querySelector<HTMLElement>("[data-verified-application-email]");
  const verifiedKind = root.querySelector<HTMLElement>("[data-verified-application-kind]");
  const categoryContainer = root.querySelector<HTMLElement>("[data-membership-categories]");
  const customFieldsContainer = root.querySelector<HTMLElement>("[data-custom-fields]");
  const individualCategoryList = root.querySelector<HTMLElement>("[data-join-individual-category-list]");
  if (
    !statusEl ||
    !startSection ||
    !startForm ||
    !applicationForm ||
    !pendingSection ||
    !accessSection ||
    !supportSection
  )
    return;

  let applicationContext: JoinApplicationContext | null = null;
  let categories: MembershipCategory[] = [];
  let definitionPromise: Promise<MemberApplicationFormResponse> | null = null;

  const getApplicationDefinition = () => {
    definitionPromise ??= getJson(`${API_BASE}/members/applications/form`, memberApplicationFormResponseSchema);
    return definitionPromise;
  };

  const loadIndividualCategorySummary = async () => {
    if (!individualCategoryList) return;
    individualCategoryList.textContent = "Loading eligible categories…";
    try {
      const definition = await getApplicationDefinition();
      renderMembershipCategorySummary(
        individualCategoryList,
        filterCategoriesForApplicantKind(definition.categories, "individual"),
      );
    } catch {
      individualCategoryList.textContent = "Could not load the eligible individual categories. Please try again.";
    }
  };

  const showSection = (section: HTMLElement) => {
    for (const candidate of [startSection, pendingSection, accessSection, supportSection, applicationForm]) {
      candidate.hidden = candidate !== section;
    }
    section.focus();
  };

  const loadApplication = async (context: JoinApplicationContext) => {
    try {
      const definition = await getApplicationDefinition();
      categories = filterCategoriesForApplicantKind(definition.categories, context.applicantKind);
      if (!categoryContainer || categories.length === 0) {
        showSection(supportSection);
        setStatus(statusEl, "No eligible membership categories are currently available for this path.", true);
        return;
      }
      renderMembershipCategories(categoryContainer, categories);
      const fields = definition.form?.fields ?? [];
      const genericFields = configureMembershipLegalFields(applicationForm, fields);
      if (customFieldsContainer) renderCustomFields(customFieldsContainer, genericFields);
      if (verifiedEmail) verifiedEmail.textContent = context.applicantEmail;
      if (verifiedKind) {
        verifiedKind.textContent =
          context.applicantKind === "individual" ? "Individual application" : "Organization application";
      }
      applyCategoryUI(applicationForm, categories[0]);
      showSection(applicationForm);
      const firstControl = applicationForm.querySelector<HTMLElement>('input[name="category"]');
      firstControl?.focus();
    } catch {
      setStatus(statusEl, "Could not load the membership application. Please refresh and try again.", true);
    }
  };

  installLiveValidation(startForm, statusEl);
  installLiveValidation(applicationForm, statusEl);
  // A visitor can answer while the deferred bundle is still loading. Reconcile
  // that already-checked state instead of relying only on a later change event.
  const initialApplicantKind = readJoinApplicantKind(startForm);
  applyJoinApplicantKindUI(startForm, initialApplicantKind);
  if (initialApplicantKind === "individual") void loadIndividualCategorySummary();

  startForm.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.id !== "joinEmail") return;
    if (applyJoinEmailPolicy(startForm, readJoinApplicantKind(startForm))) clearStatus(statusEl);
  });

  startForm.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.name !== "applicantKind") return;
    const applicantKind = target.value === "individual" ? "individual" : "organization";
    const email = startForm.querySelector<HTMLInputElement>("#joinEmail");
    if (email) email.value = "";
    applyJoinApplicantKindUI(startForm, applicantKind);
    clearStatus(statusEl);
    if (applicantKind === "individual") void loadIndividualCategorySummary();
    email?.focus();
  });

  startForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    startForm.classList.add("was-validated");
    const applicantKind = readJoinApplicantKind(startForm);
    if (!applyJoinEmailPolicy(startForm, applicantKind) || !validateBeforeSubmit(startForm, statusEl)) return;
    const email = readField(startForm, "email");
    const unaffiliatedAttestation = applicantKind === "individual";

    await withLoadingButton(findSubmitButton(startForm), async () => {
      try {
        const result = await postJson(
          `${API_BASE}/members/join/start`,
          memberJoinStartSchema.parse({ email, unaffiliatedAttestation }),
          memberJoinStartResponseSchema,
        );
        if (result.status === "unaffiliated_attestation_required") {
          applyJoinEmailPolicy(startForm, "organization");
          clearStatus(statusEl);
          startForm.querySelector<HTMLInputElement>("#joinEmail")?.focus();
          return;
        }
        if (pendingEmail) pendingEmail.textContent = email;
        showSection(pendingSection);
      } catch (error) {
        handleSubmitError(error, startForm, statusEl);
      }
    });
  });

  root.querySelector<HTMLButtonElement>("[data-edit-join-email]")?.addEventListener("click", () => {
    showSection(startSection);
    startForm.querySelector<HTMLInputElement>("#joinEmail")?.focus();
  });

  applicationForm.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.name !== "category") return;
    applyCategoryUI(
      applicationForm,
      categories.find((category) => category.code === target.value),
    );
  });

  applicationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    applicationForm.classList.add("was-validated");
    if (!validateBeforeSubmit(applicationForm, statusEl)) return;
    const category = readSelectedCategory(applicationForm);
    if (!category || !applicationContext) {
      setStatus(statusEl, "Your verified membership path has expired. Please start again.", true);
      return;
    }
    const context = applicationContext;
    await withLoadingButton(findSubmitButton(applicationForm), async () => {
      try {
        const payload = memberApplicationCreateSchema.parse(
          buildApplicationPayload(applicationForm, category, context),
        );
        const result = await postJson(
          `${API_BASE}/members/applications`,
          payload,
          memberApplicationCreateResponseSchema,
        );
        showSuccessPanel(root, applicationForm, result.applicationId, result.manageToken, payload.applicantName);
      } catch (error) {
        handleSubmitError(error, applicationForm, statusEl);
      }
    });
  });

  const token = new URLSearchParams(window.location.hash.slice(1)).get("verify");
  if (!token) return;
  history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
  try {
    const result = await postJson(
      `${API_BASE}/members/join/verify`,
      memberJoinVerifySchema.parse({ token }),
      memberJoinVerifyResponseSchema,
    );
    if (result.status === "application_ready") {
      applicationContext = result;
      await loadApplication(result);
    } else if (result.status === "organization_access_ready") {
      showSection(accessSection);
    } else {
      showSection(supportSection);
    }
  } catch (_error) {
    setStatus(statusEl, "This verification link is invalid or has expired. Please start again.", true);
    showSection(startSection);
  }
}

void main();
