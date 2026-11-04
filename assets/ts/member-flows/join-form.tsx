/**
 * Membership application form.
 *
 * Starts from the shared email-first step and mailbox verification, then
 * renders only the server-authorized application path. The browser never decides whether a person may join for
 * an organization or as an individual.
 */
import {
  forgetJoinDraft,
  hasJoinAnswers,
  rememberJoinToken,
  rememberedJoinToken,
  restoreJoinAnswers,
  saveJoinAnswers,
} from "./join-draft";
import { ApiClientError, getJson, postJson } from "../shared/api-client";
import { readCustomFieldValues } from "../shared/widgets/custom-fields";
import { render } from "preact";
import { useState } from "preact/hooks";
import { withLoadingButton, focusSubmitError } from "../shared/form/submit";
import { setStatus, readField, findSubmitButton } from "../shared/form/helpers";
import { SuccessPanel } from "../components/SuccessPanel";
import { replaceFormWithSuccess } from "../shared/form/success-panel";
import { focusFirstInvalidField, normalizeValidation } from "../shared/form/validation-map";
import { membershipApplicationFields } from "../../shared/schemas/membership-application-form";
import {
  applyCategoryUI,
  configureMembershipLegalFields,
  filterCategoriesForApplicantKind,
  renderMembershipCategorySummary,
  renderMembershipCategories,
  renderMembershipApplicationQuestions,
} from "./join-application-fields";
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
import { z } from "zod";
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
import { installJoinApplicationValidation } from "./join-application-validation";

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

/** The form asks for both names; the request carries them as the one applicant name. */
export const applicantNamePartsSchema = z
  .object({ firstName: z.string().trim().min(1, "First name is required"), lastName: z.string().trim() })
  .superRefine((parts, context) => {
    if (!parts.lastName)
      context.addIssue({ code: "custom", path: ["applicantName"], message: "Last name is required" });
  });

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
  const inProgressSection = root.querySelector<HTMLElement>("[data-join-application-in-progress]");
  const organizationInProgressSection = root.querySelector<HTMLElement>(
    "[data-join-organization-application-in-progress]",
  );
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
    !existingMemberSection ||
    !inProgressSection ||
    !organizationInProgressSection
  )
    return;

  let legalValidation: ReturnType<typeof installMembershipLegalValidation> | undefined;
  let applicationContext: JoinApplicationContext | null = null;
  /** The identity a signed-in person applies as; null on the verified-email path. */
  let signedInIdentity: SessionActingIdentity | null = null;
  let signedInName = "";
  let categories: MembershipCategory[] = [];
  let applicationFields: MembershipApplicationField[] = [];
  let applicationFormFields: MembershipApplicationField[] = [];
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
    for (const candidate of [
      startSection,
      accessSection,
      existingMemberSection,
      inProgressSection,
      organizationInProgressSection,
      supportSection,
      applicationForm,
    ]) {
      candidate.hidden = candidate !== section;
    }
    section.focus();
  };

  /** Resolves whether the application form is on screen, ready for its answers. */
  const loadApplication = async (applicantKind: JoinApplicantKind): Promise<boolean> => {
    try {
      const definition = await getApplicationDefinition();
      categories = filterCategoriesForApplicantKind(definition.categories, applicantKind);
      if (!categoryContainer || categories.length === 0) {
        showSection(supportSection);
        setStatus(statusEl, "No eligible membership categories are currently available for this path.", true);
        return false;
      }
      renderMembershipCategories(categoryContainer, categories);
      const fields = definition.form?.fields ?? [];
      applicationFormFields = fields;
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
      return true;
    } catch {
      setStatus(statusEl, "Could not load the membership application. Please refresh and try again.", true);
      return false;
    }
  };

  const renderQuestionsFor = (category: MembershipCategory, answers: Record<string, unknown>) => {
    if (!customFieldsContainer) return;
    const eligibleAnswers = { ...answers };
    const fields = membershipApplicationFields(applicationFields, category, {
      fromIdentity: Boolean(signedInIdentity),
    });
    for (const field of fields) {
      if (field.optionSource !== "active_working_groups") continue;
      const eligible = new Set(field.options?.map((option) => option.value));
      const answer = eligibleAnswers[field.key];
      if (Array.isArray(answer)) eligibleAnswers[field.key] = answer.filter((value) => eligible.has(String(value)));
      else if (typeof answer === "string" && !eligible.has(answer)) delete eligibleAnswers[field.key];
    }
    renderMembershipApplicationQuestions(customFieldsContainer, fields, eligibleAnswers);
  };

  let restoringAnswers = false;
  // Unsent answers are kept for this tab while the path is verified, so a reload does not lose them.
  for (const type of ["input", "change"])
    applicationForm.addEventListener(type, () => {
      if (applicationContext && !restoringAnswers) saveJoinAnswers(applicationForm);
    });
  const applicationValidation = installJoinApplicationValidation(
    applicationForm,
    () => {
      const configuredCategory = categories.find((entry) => entry.code === readSelectedCategory(applicationForm));
      if (!configuredCategory) return null;
      return signedInIdentity
        ? memberApplicationCreateAsIdentitySchemaForCategory(configuredCategory, applicationFormFields)
        : z.intersection(
            memberApplicationCreateSchemaForCategory(configuredCategory, applicationFormFields),
            applicantNamePartsSchema,
          );
    },
    () => {
      const category = readSelectedCategory(applicationForm);
      if (signedInIdentity)
        return {
          identityId: signedInIdentity.id,
          membershipCategory: category,
          answers: readCustomFieldValues(applicationForm),
        };
      return applicationContext
        ? {
            ...buildApplicationPayload(applicationForm, category, applicationContext),
            firstName: readField(applicationForm, "firstName"),
            lastName: readField(applicationForm, "lastName"),
          }
        : {};
    },
  );
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
    if (selected) renderQuestionsFor(selected, readCustomFieldValues(applicationForm));
    applyCategoryUI(
      applicationForm,
      categories.find((category) => category.code === target.value),
    );
  });

  applicationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      const fieldsValid = applicationValidation.validate();
      const agreementsValid = legalValidation?.validate() ?? true;
      if (!fieldsValid || !agreementsValid) {
        // The agreements are checked after the fields, so the first refusal in reading order gets focus again.
        focusFirstInvalidField(applicationForm);
        return;
      }
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
          const formFields = applicationFormFields;
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
          forgetJoinDraft();
          showSuccessPanel(root, applicationForm, result.applicationId, result.manageToken, applicantName);
        } catch (error) {
          applicationValidation.refuse(error);
          legalValidation?.refuse(error);
          setStatus(statusEl, normalizeValidation(error).globalMessage, true);
          focusSubmitError(applicationForm, statusEl);
        }
      });
    })().catch((error: unknown) => {
      applicationValidation.refuse(error);
      legalValidation?.refuse(error);
      setStatus(statusEl, normalizeValidation(error).globalMessage, true);
      focusSubmitError(applicationForm, statusEl);
    });
  });

  const verifyFromLocation = async () => {
    const linked = new URLSearchParams(window.location.hash.slice(1)).get("verify");
    // The link's token leaves the address bar; this tab keeps it so a reload continues the application.
    if (linked) history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
    const token = linked ?? rememberedJoinToken();
    if (!token) return;
    try {
      const result = await postJson(
        `${API_BASE}/members/join/verify`,
        memberJoinVerifySchema.parse({ token }),
        memberJoinVerifyResponseSchema,
      );
      if (result.status === "application_ready") {
        rememberJoinToken(token);
        applicationContext = result;
        // A failed load leaves the kept answers alone for the next reload.
        if (!(await loadApplication(result.applicantKind))) return;
        // The kept draft stands until the next edit: stateful widgets take restored values after this render.
        restoringAnswers = true;
        const restored = restoreJoinAnswers(applicationForm, (answers) => {
          const selected = categories.find((category) => category.code === readSelectedCategory(applicationForm));
          renderQuestionsFor(selected ?? categories[0], answers);
        });
        restoringAnswers = false;
        if (restored) {
          setStatus(statusEl, "We restored the answers you entered earlier. Agreements need accepting again.");
        }
        return;
      }
      forgetJoinDraft();
      if (result.status === "already_member") {
        showSection(existingMemberSection);
      } else if (result.status === "organization_access_ready") {
        showSection(accessSection);
      } else if (result.status === "application_in_progress") {
        const statusLink = inProgressSection.querySelector<HTMLAnchorElement>("[data-join-status-link]");
        if (statusLink) statusLink.href = result.statusPath;
        showSection(inProgressSection);
      } else if (result.status === "organization_application_in_progress") {
        showSection(organizationInProgressSection);
      } else {
        showSection(supportSection);
      }
    } catch (error) {
      if (!(error instanceof ApiClientError) || ![404, 409, 410].includes(error.status)) {
        // Retry the newly opened proof after a reload, never a previous applicant's draft.
        if (linked) rememberJoinToken(linked);
        showSection(startSection);
        setStatus(
          statusEl,
          hasJoinAnswers()
            ? "We could not verify your email right now. Your saved answers are still available in this tab. Refresh to try again."
            : rememberedJoinToken()
              ? "We could not verify your email right now. Refresh to try again."
              : "We could not verify your email right now. Open your email link again to try again.",
          true,
        );
        return;
      }
      forgetJoinDraft();
      setStatus(
        statusEl,
        linked
          ? "This verification link is invalid or has expired. Please start again."
          : "Your email verification has expired, so your answers were not kept. Please start again.",
        true,
      );
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
  // A verified path kept for this tab continues after a reload, like a fresh verification link.
  if (new URLSearchParams(window.location.hash.slice(1)).has("verify") || rememberedJoinToken()) {
    await verifyFromLocation();
    return;
  }
  const applicant = await readSignedInApplicant();
  if (applicant) startSignedIn(applicant);
}

void main();
