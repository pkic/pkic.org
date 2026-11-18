/**
 * Membership application form.
 *
 * Joining starts signed in: a person without a session signs in or starts an
 * account through the shared sign-in card and returns here. Their account's
 * proved address then stands for them, and the page renders only the
 * server-authorized application path. The browser never decides whether a
 * person may join for an organization or as an individual.
 */
import {
  forgetJoinDraft,
  rememberJoinApplicant,
  rememberJoinChoice,
  rememberedJoinChoice,
  restoreJoinAnswers,
  saveJoinAnswers,
  type JoinChoice,
} from "./join-draft";
import { ApiClientError, getJson, postJson } from "../shared/api-client";
import { readCustomFieldValues } from "../shared/widgets/custom-fields";
import { render } from "preact";
import { withLoadingButton, focusSubmitError } from "../shared/form/submit";
import { setStatus, findSubmitButton } from "../shared/form/helpers";
import { SuccessPanel } from "../components/SuccessPanel";
import { replaceFormWithSuccess } from "../shared/form/success-panel";
import { focusFirstInvalidField, normalizeValidation, refusalSentence } from "../shared/form/validation-map";
import { membershipApplicationFields } from "../../shared/schemas/membership-application-form";
import {
  configureMembershipLegalFields,
  filterCategoriesForApplicantKind,
  renderMembershipCategories,
  renderMembershipApplicationQuestions,
} from "./join-application-fields";
import type { SessionActingIdentity } from "../../shared/session-acting-identity";
import { JoinOrganizationChoice } from "./join-organization-choice";
import { JoinOrganizationIdentity } from "./join-organization-identity";
import { JoinSignedInApplicant, joinRefusalFor, readSignedInApplicant } from "./join-signed-in";
import type { JoinPath, JoinRefusal, SignedInApplicant } from "./join-signed-in";
import {
  memberApplicationCreateAsIdentitySchemaForCategory,
  memberApplicationCreateResponseSchema,
  memberApplicationFormResponseSchema,
  type MemberApplicationFormResponse,
} from "../../shared/schemas/member-applications";
import { z } from "zod";
import { memberJoinVerifyResponseSchema, memberJoinVerifySchema } from "../../shared/schemas/member-join";
import { ButtonLink } from "../ui/Button";
import { MEMBERSHIP_JOIN_PATH } from "../../shared/membership-join-path";
// This module writes design-system class names into markup it builds itself,
// so it has to pull in the stylesheets that define them: component CSS ships
// in the chunk of whoever imports it, not in the entry sheet.
import "../ui/Content.css";
import "../ui/Field.css";

import { installMembershipLegalValidation } from "./membership-legal-validation";
import { installJoinApplicationValidation } from "./join-application-validation";

const API_BASE = "/api/v1";

type MemberJoinVerifyResponse = z.infer<typeof memberJoinVerifyResponseSchema>;
type JoinApplicationContext = Extract<MemberJoinVerifyResponse, { status: "application_ready" }>;
type MembershipCategory = MemberApplicationFormResponse["categories"][number];
type JoinApplicantKind = JoinApplicationContext["applicantKind"];
type MembershipApplicationField = NonNullable<MemberApplicationFormResponse["form"]>["fields"][number];

// ── Pure/testable helpers ──────────────────────────────────────────────────

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

async function main(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-member-application]");
  if (!root) return;
  const statusEl = root.querySelector<HTMLElement>("[data-flow-status]");
  const startSection = root.querySelector<HTMLElement>("[data-join-sign-in]");
  const signInCard = root.querySelector<HTMLElement>("[data-join-sign-in-card]");
  const applicationForm = root.querySelector<HTMLFormElement>("[data-join-application-form]");
  const accessSection = root.querySelector<HTMLElement>("[data-join-organization-access]");
  const existingMemberSection = root.querySelector<HTMLElement>("[data-join-already-member]");
  const supportSection = root.querySelector<HTMLElement>("[data-join-support-required]");
  const inProgressSection = root.querySelector<HTMLElement>("[data-join-application-in-progress]");
  const organizationInProgressSection = root.querySelector<HTMLElement>(
    "[data-join-organization-application-in-progress]",
  );
  const representationInProgressSection = root.querySelector<HTMLElement>(
    "[data-join-representation-application-in-progress]",
  );
  const categoryContainer = root.querySelector<HTMLElement>("[data-membership-categories]");
  const customFieldsContainer = root.querySelector<HTMLElement>("[data-custom-fields]");
  const signedInSection = root.querySelector<HTMLElement>("[data-join-signed-in]");
  if (
    !statusEl ||
    !startSection ||
    !signInCard ||
    !signedInSection ||
    !applicationForm ||
    !accessSection ||
    !supportSection ||
    !existingMemberSection ||
    !inProgressSection ||
    !organizationInProgressSection ||
    !representationInProgressSection
  )
    return;

  let legalValidation: ReturnType<typeof installMembershipLegalValidation> | undefined;
  /** The identity the person applies as, once the server has authorized their path. */
  let signedInIdentity: SessionActingIdentity | null = null;
  let applicant: SignedInApplicant | null = null;
  /** The identity whose membership path the server resolves, and the path chosen for it. */
  let pathIdentity: SessionActingIdentity | null = null;
  let pathChoice: JoinChoice = { unaffiliatedAttestation: false };
  /** Counts the choices made, so an answer to an earlier choice never lands on a later one. */
  let chosen = 0;
  let categories: MembershipCategory[] = [];
  let applicationFields: MembershipApplicationField[] = [];
  let applicationFormFields: MembershipApplicationField[] = [];
  let definitionPromise: Promise<MemberApplicationFormResponse> | null = null;
  const organizationChoiceSection = document.createElement("section");
  organizationChoiceSection.hidden = true;
  organizationChoiceSection.tabIndex = -1;
  organizationChoiceSection.dataset.joinOrganizationChoice = "";
  root.append(organizationChoiceSection);

  const getApplicationDefinition = () => {
    definitionPromise ??= getJson(`${API_BASE}/members/applications/form`, memberApplicationFormResponseSchema);
    return definitionPromise;
  };

  const showSection = (section: HTMLElement | null) => {
    for (const candidate of [
      accessSection,
      existingMemberSection,
      inProgressSection,
      organizationInProgressSection,
      representationInProgressSection,
      supportSection,
      organizationChoiceSection,
      applicationForm,
    ]) {
      candidate.hidden = candidate !== section;
    }
    section?.focus();
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
          membershipApplicationFields(applicationFields, categories[0], { fromIdentity: true }),
        );
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
      fromIdentity: true,
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
  // Unsent answers are kept for this tab, so a reload or a change to the representation does not lose them.
  for (const type of ["input", "change"])
    applicationForm.addEventListener(type, () => {
      if (signedInIdentity && !restoringAnswers) saveJoinAnswers(applicationForm, signedInIdentity.id);
    });

  /** Shows the application for `identity` with the answers kept for it, unless a later choice replaced it. */
  const openApplication = async (
    identity: SessionActingIdentity,
    applicantKind: JoinApplicantKind,
    turn: number,
    recoveryMessage?: string,
  ): Promise<void> => {
    // Rendering the form must not overwrite the kept answers before they are put back.
    restoringAnswers = true;
    try {
      if (!(await loadApplication(applicantKind)) || turn !== chosen) return;
      const restored = restoreJoinAnswers(applicationForm, identity.id, (answers) => {
        const selected = categories.find((category) => category.code === readSelectedCategory(applicationForm));
        renderQuestionsFor(selected ?? categories[0], answers);
      });
      if (recoveryMessage) setStatus(statusEl, recoveryMessage, true);
      else if (restored)
        setStatus(statusEl, "We restored the answers you entered earlier. Agreements need accepting again.");
    } finally {
      restoringAnswers = false;
    }
  };

  const applicationValidation = installJoinApplicationValidation(
    applicationForm,
    () => {
      const configuredCategory = categories.find((entry) => entry.code === readSelectedCategory(applicationForm));
      return configuredCategory
        ? memberApplicationCreateAsIdentitySchemaForCategory(configuredCategory, applicationFormFields)
        : null;
    },
    () =>
      signedInIdentity
        ? {
            identityId: signedInIdentity.id,
            membershipCategory: readSelectedCategory(applicationForm),
            answers: readCustomFieldValues(applicationForm),
          }
        : {},
  );
  applicationForm.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.name !== "membershipCategory") return;
    const selected = categories.find((category) => category.code === target.value);
    if (selected) renderQuestionsFor(selected, readCustomFieldValues(applicationForm));
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
      const identity = signedInIdentity;
      if (!category || !identity) {
        setStatus(statusEl, "Your membership path has expired. Refresh the page to continue.", true);
        return;
      }
      await withLoadingButton(findSubmitButton(applicationForm), async () => {
        try {
          const configuredCategory = categories.find((entry) => entry.code === category);
          if (!configuredCategory) throw new Error("Choose an available membership category");
          const payload = memberApplicationCreateAsIdentitySchemaForCategory(
            configuredCategory,
            applicationFormFields,
          ).parse({
            identityId: identity.id,
            membershipCategory: category,
            answers: readCustomFieldValues(applicationForm),
          });
          const result = await postJson(
            `${API_BASE}/members/applications`,
            payload,
            memberApplicationCreateResponseSchema,
          );
          forgetJoinDraft();
          showSuccessPanel(root, applicationForm, result.applicationId, result.manageToken, applicant?.name ?? "");
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

  /** Shows why no application is needed, or who can help, for a path the server has already decided. */
  const showDecidedPath = (result: MemberJoinVerifyResponse, organizationName?: string | null) => {
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
    } else if (result.status === "representation_application_in_progress") {
      const name = representationInProgressSection.querySelector<HTMLElement>("[data-join-organization-name]");
      if (name) name.textContent = organizationName ?? "your organization";
      showSection(representationInProgressSection);
    } else {
      showSection(supportSection);
    }
  };

  /** Offers the form for an organization identity only when its application can be sent. */
  const resolveRepresentationPath = async (identity: SessionActingIdentity, turn: number): Promise<void> => {
    try {
      const result = await postJson(
        `${API_BASE}/members/join/verify`,
        memberJoinVerifySchema.parse({ identityId: identity.id }),
        memberJoinVerifyResponseSchema,
      );
      if (turn !== chosen) return;
      if (result.status !== "representation_application_ready")
        return showDecidedPath(result, identity.organizationName);
      signedInIdentity = identity;
      await openApplication(identity, "organization", turn);
    } catch (error) {
      if (turn !== chosen) return;
      showSection(null);
      setStatus(
        statusEl,
        error instanceof ApiClientError && error.status === 401
          ? "Your session has ended. Refresh the page to sign in again."
          : "We could not load your membership options right now. Refresh to try again.",
        true,
      );
    }
  };

  /**
   * Asks the server which membership path the signed-in person is on. `selection` is what they chose on
   * the way (an organization, a new one, or continuing as an individual); the path itself is `pathChoice`.
   */
  const resolvePath = async (
    selection: Omit<JoinChoice, "unaffiliatedAttestation"> = {},
    recoveryMessage?: string,
  ): Promise<void> => {
    const person = applicant;
    const identity = pathIdentity;
    if (!person || !identity) return;
    const turn = chosen;
    const choice: JoinChoice = { unaffiliatedAttestation: pathChoice.unaffiliatedAttestation, ...selection };
    const again = (next: Omit<JoinChoice, "unaffiliatedAttestation">) => resolvePath(next);
    try {
      const result = await postJson(
        `${API_BASE}/members/join/verify`,
        memberJoinVerifySchema.parse(choice),
        memberJoinVerifyResponseSchema,
      );
      if (turn !== chosen) return;
      if (result.status === "organization_selection_required") {
        rememberJoinChoice({ unaffiliatedAttestation: choice.unaffiliatedAttestation });
        render(
          result.canApplyAsIndividual ? (
            <JoinOrganizationChoice
              domain={result.domain}
              organizations={result.organizations}
              onChoose={(organizationId) => again({ organizationId })}
              onIndividual={() => again({ continueAsIndividual: true })}
            />
          ) : (
            // An organization applies as the identity that represents it; adding one is account management.
            <JoinOrganizationIdentity />
          ),
          organizationChoiceSection,
        );
        showSection(organizationChoiceSection);
        if (recoveryMessage) setStatus(statusEl, recoveryMessage, true);
        return;
      }
      if (result.status === "application_ready") {
        rememberJoinChoice(choice);
        // Only an individual is given a continuation: they apply as the identity they already hold.
        signedInIdentity = identity;
        await openApplication(identity, result.applicantKind, turn, recoveryMessage);
        return;
      }
      showDecidedPath(result);
    } catch (error) {
      if (turn !== chosen) return;
      if (
        error instanceof ApiClientError &&
        ["ORGANIZATION_AFFILIATION_CHANGED", "IDENTITY_DOMAIN_MISMATCH"].includes(error.code ?? "")
      ) {
        // A selection the server no longer accepts returns to the choice it was made from, once.
        if (Object.keys(selection).length > 0 && !recoveryMessage) return resolvePath({}, error.message);
        setStatus(statusEl, error.message, true);
        return;
      }
      showSection(null);
      // The work-address rule and an ended session say what to do next; anything else is ours to retry.
      setStatus(
        statusEl,
        error instanceof ApiClientError && [400, 401].includes(error.status)
          ? error.status === 401
            ? "Your session has ended. Refresh the page to sign in again."
            : refusalSentence(error)
          : "We could not load your membership options right now. Refresh to try again.",
        true,
      );
    }
  };

  /** The signed-in person's identity and, for an individual identity, how they are joining. */
  const applyAs = (identity: SessionActingIdentity, refusal: JoinRefusal | null, path: JoinPath | null) => {
    chosen += 1;
    signedInIdentity = null;
    pathIdentity = null;
    // An earlier notice no longer applies; an empty one must not stay on screen as a bare strip.
    statusEl.textContent = "";
    statusEl.classList.add("pk-sr-only");
    showSection(null);
    if (refusal) return;
    if (identity.organizationId) {
      if (applicant) rememberJoinApplicant(applicant.userId);
      void resolveRepresentationPath(identity, chosen);
      return;
    }
    if (!path || !applicant) return;
    pathIdentity = identity;
    const unaffiliatedAttestation = path === "individual";
    // A reload continues the selection kept for the same path; a new path starts from its own beginning.
    const kept = rememberedJoinChoice(applicant.userId);
    const { unaffiliatedAttestation: keptPath, ...selection } = kept ?? { unaffiliatedAttestation };
    rememberJoinApplicant(applicant.userId);
    pathChoice = { unaffiliatedAttestation };
    void resolvePath(keptPath === unaffiliatedAttestation ? selection : {});
  };

  const startSignedIn = (person: SignedInApplicant) => {
    applicant = person;
    startSection.hidden = true;
    render(null, signInCard);
    const kept = person.preferred.organizationId ? undefined : rememberedJoinChoice(person.userId);
    const path: JoinPath | null = kept ? (kept.unaffiliatedAttestation ? "individual" : "organization") : null;
    signedInSection.hidden = false;
    render(
      <JoinSignedInApplicant
        applicant={person}
        initialPath={path}
        onChange={applyAs}
        onNamesSaved={(named) => {
          applicant = named;
        }}
      />,
      signedInSection,
    );
    applyAs(person.preferred, joinRefusalFor(person.preferred, person.identities), path);
  };

  /** Continues with the session when there is one; otherwise the shared sign-in card is the first step. */
  const start = async (): Promise<void> => {
    const person = await readSignedInApplicant();
    if (person) return startSignedIn(person);
    const { SignInCard } = await import("../components/sign-in/SignInCard");
    render(
      <SignInCard
        // The join page reads nothing from its query, so the emailed link carries none of it.
        embedded={{ returnPath: MEMBERSHIP_JOIN_PATH, emailFlow: "join" }}
        onSignedIn={start}
      />,
      signInCard,
    );
  };
  await start();
}

void main();
