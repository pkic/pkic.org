/**
 * Membership application form.
 *
 * Starts from the shared email-first step and mailbox verification, then
 * renders only the server-authorized application path. The browser never decides whether a person may join for
 * an organization or as an individual.
 */
import { getJson, postJson } from "../shared/api-client";
import { renderCustomFields, readCustomFieldValues } from "../shared/widgets/custom-fields";
import { render } from "preact";
import { useState } from "preact/hooks";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form/validation";
import { withLoadingButton, handleSubmitError } from "../shared/form/submit";
import { setStatus, readField, findSubmitButton } from "../shared/form/helpers";
import { SuccessPanel } from "../components/SuccessPanel";
import { replaceFormWithSuccess } from "../shared/form/success-panel";
import { formatCurrencyAmount } from "../../shared/format-currency";
import {
  filterApplicationFieldsForApplicantKind,
  membershipApplicationFields,
} from "../../shared/schemas/membership-application-form";
export { filterApplicationFieldsForApplicantKind } from "../../shared/schemas/membership-application-form";
import type { SessionActingIdentity } from "../../shared/session-acting-identity";
import { JoinSignedInApplicant, joinRefusalFor, readSignedInApplicant } from "./join-signed-in";
import type { JoinRefusal, SignedInApplicant } from "./join-signed-in";
import {
  memberApplicationCreateAsIdentitySchemaForCategory,
  memberApplicationCreateResponseSchema,
  memberApplicationCreateSchemaForCategory,
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
import { ButtonLink } from "../ui/Button";
import { EmailFirstStep } from "../components/EmailFirstStep";
// This module writes design-system class names into markup it builds itself,
// so it has to pull in the stylesheets that define them: component CSS ships
// in the chunk of whoever imports it, not in the entry sheet.
import "../ui/Content.css";
import "../ui/Field.css";

import { installMembershipLegalValidation } from "./membership-legal-validation";

const API_BASE = "/api/v1";

type JoinApplicationContext = Extract<z.infer<typeof memberJoinVerifyResponseSchema>, { status: "application_ready" }>;
type MembershipCategory = MemberApplicationFormResponse["categories"][number];
type JoinApplicantKind = JoinApplicationContext["applicantKind"];
type MembershipApplicationField = NonNullable<MemberApplicationFormResponse["form"]>["fields"][number];

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

export function membershipCategoryFeeText(category: MembershipCategory): string | null {
  if (!category.fee) return null;
  return `Required fee: ${formatCurrencyAmount(category.fee.amount, category.fee.currency)}. Payment is due within ${category.fee.deadlineDays} days after the payment step opens.`;
}

function membershipLegalLabel(key: string, configuredLabel: string, applicantKind: JoinApplicantKind): string {
  if (applicantKind !== "individual") return configuredLabel;
  if (key === "warranted_authority") {
    return "I confirm that I am submitting this application for myself and agree to be bound by these terms";
  }
  return configuredLabel.replace(/^I and my organization \(if applicable\)/, "I");
}
export function renderMembershipCategorySummary(container: HTMLElement, categories: MembershipCategory[]): void {
  if (categories.length === 0) {
    container.textContent = "No eligible individual categories are currently available.";
    return;
  }

  const list = document.createElement("ul");
  // The bullet without the browser's 40px indent, so the summary lines up
  // with the label above it instead of hanging off to the right.
  list.className = "pk-answer-list";
  for (const category of categories) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = `${category.code} — ${category.label}`;
    item.append(title);
    if (category.description) {
      // A block element rather than a span carrying a display utility: the
      // description is its own line, which is what a div already means.
      const description = document.createElement("div");
      description.className = "pk-small";
      description.textContent = category.description;
      item.append(description);
    }
    const fee = membershipCategoryFeeText(category);
    if (fee) {
      const feeSummary = document.createElement("div");
      feeSummary.className = "pk-small pk-strong";
      feeSummary.textContent = fee;
      item.append(feeSummary);
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
  applicantKind: JoinApplicantKind = "organization",
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
    label.textContent = membershipLegalLabel(key, field.label, applicantKind);
    configuredKeys.add(key);
  }

  const agreements = form.querySelector<HTMLElement>("[data-membership-legal-agreements]");
  if (agreements) agreements.hidden = configuredKeys.size === 0;

  return filterApplicationFieldsForApplicantKind(
    fields.filter((field) => !configuredKeys.has(field.key)),
    applicantKind,
  );
}

/** Start with active participation without replacing an applicant's saved choice. */
export function renderMembershipApplicationQuestions(
  container: HTMLElement,
  fields: MembershipApplicationField[],
  answers: Record<string, unknown> = {},
): void {
  const contribution = fields.find((field) => field.key === "contribution_type");
  const defaults =
    contribution?.fieldType === "select" &&
    contribution.options?.some((option) => option.value === "active" && option.active)
      ? { contribution_type: "active" }
      : {};
  renderCustomFields(container, fields).setValues({ ...defaults, ...answers });
}

export function renderMembershipCategories(container: HTMLElement, categories: MembershipCategory[]): void {
  // The gap between the options belongs to the list, not to each option: one
  // decision here instead of one `mb-2` per radio that can disagree.
  container.className = "pk-stack pk-stack--snug";
  container.replaceChildren(
    ...categories.map((category) => {
      // All three parts of the check, or the browser draws its own control:
      // the block on the label, the input class, and the label class.
      const wrapper = document.createElement("label");
      wrapper.className = "pk-check";
      const id = `membership-category-${category.code.toLowerCase()}`;
      const input = document.createElement("input");
      input.className = "pk-check__input";
      input.type = "radio";
      input.id = id;
      input.name = "membershipCategory";
      input.value = category.code;
      input.required = true;
      input.dataset.individual = String(category.isIndividual);
      const label = document.createElement("span");
      label.className = "pk-check__label";
      const title = document.createElement("strong");
      title.textContent = `${category.code} — ${category.label}`;
      label.append(title);
      if (category.description) {
        const description = document.createElement("span");
        description.className = "pk-check__hint";
        description.textContent = category.description;
        label.append(description);
      }
      const fee = membershipCategoryFeeText(category);
      if (fee) {
        const feeSummary = document.createElement("span");
        feeSummary.className = "pk-check__hint pk-strong";
        feeSummary.textContent = fee;
        label.append(feeSummary);
      }
      wrapper.htmlFor = id;
      wrapper.append(input, label);
      return wrapper;
    }),
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

function readSelectedCategory(form: HTMLFormElement): string {
  return form.querySelector<HTMLInputElement>('input[name="membershipCategory"]:checked')?.value ?? "";
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
      {/* `event-flow-success-body` took its color from a Bootstrap custom
          property and set its own bottom margin. Inside `SuccessPanel`'s
          stack the gap comes from the parent and the tone from a token. */}
      <p class="pk-muted">
        Your membership application has been received. We&rsquo;ve emailed you a confirmation with a link to check its
        status at any time. You can also sign in to the member portal with this email address to follow it.
      </p>
      <p>
        <ButtonLink href={statusUrl}>Check application status →</ButtonLink>
      </p>
    </SuccessPanel>,
  );
}

/** Joining starts from the shared email-first step; the individual path is the explicit attestation. */
function JoinEmailStep({ onIndividualChange }: { onIndividualChange: (individual: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [individual, setIndividual] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  return (
    <EmailFirstStep
      flow="join"
      schema={memberJoinStartSchema}
      email={email}
      onEmailChange={setEmail}
      individual={individual}
      onIndividualChange={(value) => {
        setIndividual(value);
        onIndividualChange(value);
      }}
      onContinue={async (step) => {
        await postJson(`${API_BASE}/members/join/start`, step, memberJoinStartResponseSchema);
        setSentTo(step.email);
      }}
      sentTo={sentTo}
      onChangeEmail={() => setSentTo(null)}
    />
  );
}

async function main(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-member-application]");
  if (!root) return;
  const statusEl = root.querySelector<HTMLElement>("[data-flow-status]");
  const startSection = root.querySelector<HTMLElement>("[data-join-start]");
  const emailStep = root.querySelector<HTMLElement>("[data-join-email-step]");
  const applicationForm = root.querySelector<HTMLFormElement>("[data-join-application-form]");
  const accessSection = root.querySelector<HTMLElement>("[data-join-organization-access]");
  const existingMemberSection = root.querySelector<HTMLElement>("[data-join-already-member]");
  const supportSection = root.querySelector<HTMLElement>("[data-join-support-required]");
  const individualCategories = root.querySelector<HTMLElement>("[data-join-individual-categories]");
  const verifiedEmail = root.querySelector<HTMLElement>("[data-verified-application-email]");
  const verifiedKind = root.querySelector<HTMLElement>("[data-verified-application-kind]");
  const categoryContainer = root.querySelector<HTMLElement>("[data-membership-categories]");
  const customFieldsContainer = root.querySelector<HTMLElement>("[data-custom-fields]");
  const individualCategoryList = root.querySelector<HTMLElement>("[data-join-individual-category-list]");
  const signedInSection = root.querySelector<HTMLElement>("[data-join-signed-in]");
  if (
    !statusEl ||
    !startSection ||
    !emailStep ||
    !applicationForm ||
    !accessSection ||
    !supportSection ||
    !existingMemberSection
  )
    return;

  let legalValidation: ReturnType<typeof installMembershipLegalValidation> | undefined;
  let applicationContext: JoinApplicationContext | null = null;
  /** The identity a signed-in person applies as; null on the verified-email path. */
  let signedInIdentity: SessionActingIdentity | null = null;
  let signedInName = "";
  let categories: MembershipCategory[] = [];
  let applicationFields: MembershipApplicationField[] = [];
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
    for (const candidate of [startSection, accessSection, existingMemberSection, supportSection, applicationForm]) {
      candidate.hidden = candidate !== section;
    }
    section.focus();
  };

  const loadApplication = async (applicantKind: JoinApplicantKind) => {
    try {
      const definition = await getApplicationDefinition();
      categories = filterCategoriesForApplicantKind(definition.categories, applicantKind);
      if (!categoryContainer || categories.length === 0) {
        showSection(supportSection);
        setStatus(statusEl, "No eligible membership categories are currently available for this path.", true);
        return;
      }
      renderMembershipCategories(categoryContainer, categories);
      const fields = definition.form?.fields ?? [];
      applicationFields = configureMembershipLegalFields(applicationForm, fields, applicantKind);
      legalValidation?.dispose();
      legalValidation = installMembershipLegalValidation(applicationForm, fields);
      if (customFieldsContainer)
        renderMembershipApplicationQuestions(
          customFieldsContainer,
          membershipApplicationFields(applicationFields, categories[0], { fromIdentity: Boolean(signedInIdentity) }),
        );
      if (applicationContext && verifiedEmail) verifiedEmail.textContent = applicationContext.applicantEmail;
      if (verifiedKind) {
        verifiedKind.textContent =
          applicantKind === "individual" ? "Individual application" : "Organization application";
      }
      applyCategoryUI(applicationForm, categories[0]);
      showSection(applicationForm);
      const firstControl = applicationForm.querySelector<HTMLElement>('input[name="membershipCategory"]');
      firstControl?.focus();
    } catch {
      setStatus(statusEl, "Could not load the membership application. Please refresh and try again.", true);
    }
  };

  installLiveValidation(applicationForm, statusEl);
  render(
    <JoinEmailStep
      onIndividualChange={(individual) => {
        if (individualCategories) individualCategories.hidden = !individual;
        if (individual) void loadIndividualCategorySummary();
      }}
    />,
    emailStep,
  );

  applicationForm.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.name !== "membershipCategory") return;
    const selected = categories.find((category) => category.code === target.value);
    if (selected && customFieldsContainer) {
      const answers = readCustomFieldValues(applicationForm);
      const fields = membershipApplicationFields(applicationFields, selected, {
        fromIdentity: Boolean(signedInIdentity),
      });
      for (const field of fields) {
        if (field.optionSource !== "active_working_groups") continue;
        const eligible = new Set(field.options?.map((option) => option.value));
        const answer = answers[field.key];
        if (Array.isArray(answer)) answers[field.key] = answer.filter((value) => eligible.has(value));
        else if (typeof answer === "string" && !eligible.has(answer)) delete answers[field.key];
      }
      renderMembershipApplicationQuestions(customFieldsContainer, fields, answers);
    }
    applyCategoryUI(
      applicationForm,
      categories.find((category) => category.code === target.value),
    );
  });

  applicationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fieldsValid = validateBeforeSubmit(applicationForm, statusEl);
    const agreementsValid = legalValidation?.validate() ?? true;
    if (!fieldsValid || !agreementsValid) return;
    const category = readSelectedCategory(applicationForm);
    const context = applicationContext;
    const identity = signedInIdentity;
    if (!category || (!context && !identity)) {
      setStatus(statusEl, "Your verified membership path has expired. Please start again.", true);
      return;
    }
    await withLoadingButton(findSubmitButton(applicationForm), async () => {
      try {
        const configuredCategory = categories.find((entry) => entry.code === category);
        if (!configuredCategory) throw new Error("Choose an available membership category");
        const formFields = (await getApplicationDefinition()).form?.fields ?? [];
        let payload: object;
        let applicantName = signedInName;
        if (identity) {
          payload = memberApplicationCreateAsIdentitySchemaForCategory(configuredCategory, formFields).parse({
            identityId: identity.id,
            membershipCategory: category,
            answers: readCustomFieldValues(applicationForm),
          });
        } else if (context) {
          const typed = memberApplicationCreateSchemaForCategory(configuredCategory, formFields).parse(
            buildApplicationPayload(applicationForm, category, context),
          );
          payload = typed;
          applicantName = typed.applicantName;
        } else return;
        const result = await postJson(
          `${API_BASE}/members/applications`,
          payload,
          memberApplicationCreateResponseSchema,
        );
        showSuccessPanel(root, applicationForm, result.applicationId, result.manageToken, applicantName);
      } catch (error) {
        handleSubmitError(error, applicationForm, statusEl);
        legalValidation?.refuse(error);
      }
    });
  });

  const verifyFromLocation = async () => {
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
        await loadApplication(result.applicantKind);
      } else if (result.status === "already_member") {
        showSection(existingMemberSection);
      } else if (result.status === "organization_access_ready") {
        showSection(accessSection);
      } else {
        showSection(supportSection);
      }
    } catch (_error) {
      setStatus(statusEl, "This verification link is invalid or has expired. Please start again.", true);
      showSection(startSection);
    }
  };
  const startSignedIn = (applicant: SignedInApplicant) => {
    if (!signedInSection) return;
    signedInName = applicant.name;
    // The identity supplies name, organization and the verified address, so the typed fields leave the form.
    for (const typed of applicationForm.querySelectorAll("[data-join-verified-context], [data-join-typed-identity]"))
      typed.remove();
    const applyAs = (identity: SessionActingIdentity, refusal: JoinRefusal | null) => {
      signedInIdentity = identity;
      if (refusal) {
        startSection.hidden = true;
        applicationForm.hidden = true;
        return;
      }
      void loadApplication(identity.organizationId ? "organization" : "individual");
    };
    signedInSection.hidden = false;
    render(<JoinSignedInApplicant applicant={applicant} onIdentityChange={applyAs} />, signedInSection);
    applyAs(applicant.preferred, joinRefusalFor(applicant.preferred, applicant.identities));
  };

  window.addEventListener("hashchange", () => void verifyFromLocation());
  if (new URLSearchParams(window.location.hash.slice(1)).has("verify")) {
    await verifyFromLocation();
    return;
  }
  const applicant = await readSignedInApplicant();
  if (applicant) startSignedIn(applicant);
}

void main();
