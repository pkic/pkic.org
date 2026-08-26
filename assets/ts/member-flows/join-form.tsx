/**
 * Membership application form.
 *
 * Starts from mailbox verification, then renders only the server-authorized
 * application path. The browser never decides whether a person may join for
 * an organization or as an individual.
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
  const attestation = root.querySelector<HTMLElement>("[data-unaffiliated-attestation]");
  const pendingEmail = root.querySelector<HTMLElement>("[data-join-pending-email]");
  const verifiedEmail = root.querySelector<HTMLElement>("[data-verified-application-email]");
  const categoryContainer = root.querySelector<HTMLElement>("[data-membership-categories]");
  const customFieldsContainer = root.querySelector<HTMLElement>("[data-custom-fields]");
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

  const showSection = (section: HTMLElement) => {
    for (const candidate of [startSection, pendingSection, accessSection, supportSection, applicationForm]) {
      candidate.hidden = candidate !== section;
    }
    section.focus();
  };

  const loadApplication = async (context: JoinApplicationContext) => {
    try {
      const definition = await getJson(`${API_BASE}/members/applications/form`, memberApplicationFormResponseSchema);
      categories = filterCategoriesForApplicantKind(definition.categories, context.applicantKind);
      if (!categoryContainer || categories.length === 0) {
        showSection(supportSection);
        setStatus(statusEl, "No eligible membership categories are currently available for this path.", true);
        return;
      }
      renderMembershipCategories(categoryContainer, categories);
      if (customFieldsContainer) renderCustomFields(customFieldsContainer, definition.form?.fields ?? []);
      if (verifiedEmail) verifiedEmail.textContent = context.applicantEmail;
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

  startForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    startForm.classList.add("was-validated");
    if (!validateBeforeSubmit(startForm, statusEl)) return;
    const email = readField(startForm, "email");
    const unaffiliatedAttestation =
      startForm.querySelector<HTMLInputElement>("#unaffiliatedAttestation")?.checked ?? false;

    await withLoadingButton(findSubmitButton(startForm), async () => {
      try {
        const result = await postJson(
          `${API_BASE}/members/join/start`,
          memberJoinStartSchema.parse({ email, unaffiliatedAttestation }),
          memberJoinStartResponseSchema,
        );
        if (result.status === "unaffiliated_attestation_required") {
          if (attestation) attestation.hidden = false;
          setStatus(
            statusEl,
            "Confirm that you are unaffiliated before continuing with a personal email address.",
            true,
          );
          startForm.querySelector<HTMLInputElement>("#unaffiliatedAttestation")?.focus();
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

  root.querySelector<HTMLButtonElement>("[data-show-unaffiliated]")?.addEventListener("click", (event) => {
    if (attestation) attestation.hidden = false;
    (event.currentTarget as HTMLButtonElement).hidden = true;
    startForm.querySelector<HTMLInputElement>("#unaffiliatedAttestation")?.focus();
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
