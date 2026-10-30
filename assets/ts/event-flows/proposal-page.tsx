import { deriveFormSubmissionWindowState } from "../../shared/form-submission-window";
import { mountMarkdownField } from "../components/markdown-editor/mount-markdown-field";
import { render, createRef } from "preact";
import type { z } from "zod";
import { getJson, postJson } from "../shared/api-client";
import { clearReferralSession } from "../shared/query-context";
import { renderConsentInputs, readConsentValues, syncConsentValidation } from "../shared/widgets/consents";
import { renderCustomFields, readCustomFieldValues } from "../shared/widgets/custom-fields";
import { installStepNavigation } from "../shared/form/step-navigation";
import { renderSharePanel } from "../shared/widgets/share-panel";
import { eventFormsResponseSchema } from "../../shared/schemas/forms";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form/validation";
import { applyFieldErrors, normalizeValidation } from "../shared/form/validation-map";
import { withLoadingButton } from "../shared/form/submit";
import { bootstrap, setStatus } from "./boot";
import {
  authenticatedProposalCreateSchema,
  proposalContactSchema,
  proposalCreateSchema,
  proposalCreateResponseSchema,
} from "../../shared/schemas/proposal-management";
import { readField, findSubmitButton } from "../shared/form/helpers";
import { EventProposalIdentityStep } from "../components/EventProposalIdentityStep";
import {
  newAffiliationDetails,
  prepareProposalEntry,
  type ProposalEntrySelection,
} from "../components/useProposalEntryIdentity";
import { ParticipationIdentitySummary } from "../components/ParticipationIdentitySummary";
import { SpeakerFormCard } from "../components/SpeakerFormCard";
import { ConfirmDialogHost } from "../components/ConfirmDialog";
import { SuccessPanel } from "../components/SuccessPanel";
import { ButtonLink } from "../ui/Button";
import { Radio } from "../ui/Checkbox";
import type { ProfileLinksHandle } from "../components/ProfileLinksInput";
import { handleFormInviteSubmitError } from "../shared/widgets/invite-recovery";
import { proposalSessionTypeLabel, type ProposalSessionType } from "../../shared/proposal-session-types";
import { proposalEntryContextSchema } from "../../shared/schemas/proposal-entry";
import type { RequiredTerm } from "../../shared/schemas/forms";
import type { ConsentItem } from "../../shared/schemas/registration";

// ── Session type labels ───────────────────────────────────────────────────────

/**
 * Renders session-type radio buttons into the [data-session-types] container.
 * The first type in the list is pre-selected.
 */
function renderSessionTypes(
  root: HTMLElement,
  types: string[],
  configuredTypes?: readonly ProposalSessionType[],
): void {
  const container = root.querySelector<HTMLElement>("[data-session-types]");
  if (!container) return;
  render(
    <>
      {types.map((type, i) => {
        const id = `type-${type}`;
        const label = proposalSessionTypeLabel(type, configuredTypes);
        return <Radio name="proposalType" id={id} value={type} defaultChecked={i === 0} label={label} />;
      })}
    </>,
    container,
  );
}

// ── Speaker tracking ──────────────────────────────────────────────────────────

interface SpeakerEntry {
  index: number;
  container: HTMLElement;
}

/** All additional speaker cards (not the proposer). */
const additionalSpeakers: SpeakerEntry[] = [];
let speakerCount = 0;

/** Profile links ref for the proposer when they are also presenting. */
let proposerLinksRef: ReturnType<typeof createRef<ProfileLinksHandle>> | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function readRadio(container: HTMLElement, name: string): string {
  const checked = container.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return checked?.value ?? "";
}

// ── Speaker card builder ──────────────────────────────────────────────────────

/**
 * Builds the proposer's speaker card (shown only when "I am also presenting" is checked).
 * Known person details stay in a summary; only session bio, links and role are collected here.
 */
function createProposerCard(
  defaultRole: string,
  entry: ProposalEntrySelection,
  container: HTMLElement = document.createElement("div"),
  linksRef = createRef<ProfileLinksHandle>(),
): {
  el: HTMLElement;
  linksRef: ReturnType<typeof createRef<ProfileLinksHandle>>;
} {
  render(
    <SpeakerFormCard
      key={entry.actingIdentityId ?? "personal"}
      title="You — as a speaker"
      personSummary={<ParticipationIdentitySummary person={entry.person} />}
      idPrefix="pspk"
      fields={{
        firstName: "proposerSpeakerFirstName",
        lastName: "proposerSpeakerLastName",
        email: "proposerSpeakerEmail",
        role: "proposerSpeakerRole",
      }}
      defaultRole={defaultRole}
      profile={{
        bioFieldName: "proposerBio",
        bioHelp:
          "A short professional biography as you would like it to appear on the event website if your proposal is accepted.",
        initialBio: entry.person.bio ?? "",
        linksFieldName: "proposerLink",
        linksRef,
      }}
      emailHelp="Your management link is sent here. You will also receive a personal link to confirm your participation once the proposal is submitted."
      autocomplete
      errorPaths={{ bio: "proposer.bio" }}
    />,
    container,
  );
  return { el: container, linksRef };
}

/**
 * Builds a speaker card for an additional (non-proposer) speaker.
 * Index must be >= 1; index 0 is reserved for the proposer card.
 */
function createSpeakerCard(index: number): HTMLElement {
  const container = document.createElement("div");
  const handleRemove = () => {
    render(null, container);
    container.remove();
    const idx = additionalSpeakers.findIndex((s) => s.index === index);
    if (idx !== -1) additionalSpeakers.splice(idx, 1);
  };
  render(
    <SpeakerFormCard
      title={`Speaker ${index}`}
      idPrefix={`spk-${index}`}
      fields={{
        firstName: `speaker.${index}.firstName`,
        lastName: `speaker.${index}.lastName`,
        email: `speaker.${index}.email`,
        role: `speaker.${index}.role`,
      }}
      emailHelp="We email this person a personal link to confirm their participation and add their own bio and photo."
      errorPaths={{
        firstName: `speakers.${index}.firstName`,
        lastName: `speakers.${index}.lastName`,
        email: `speakers.${index}.email`,
      }}
      onRemove={handleRemove}
      removeLabel={`Remove speaker ${index}`}
    />,
    container,
  );
  return container;
}

// ── Payload builder ───────────────────────────────────────────────────────────

function readAdditionalSpeakers(form: HTMLFormElement) {
  return additionalSpeakers
    .map(({ index }) => {
      const email = readField(form, `speaker.${index}.email`);
      if (!email) return null;

      const role = readRadio(form, `speaker.${index}.role`) || "speaker";

      return {
        role,
        firstName: readField(form, `speaker.${index}.firstName`),
        lastName: readField(form, `speaker.${index}.lastName`),
        email,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
}

// ── Post-submission panel ─────────────────────────────────────────────────────

/**
 * Shows the proposal success state.
 *
 * Psychology:
 * - Zeigarnik Effect: the "check your email" CTA creates productive tension.
 * - Reciprocity + Peak-End: the share nudge at the end frames the submission
 *   as a community contribution, making that the most memorable moment.
 */
function showSuccessPanel(
  root: HTMLElement,
  form: HTMLFormElement,
  result: z.infer<typeof proposalCreateResponseSchema>,
  firstName: string,
  eventName: string,
  eventSlug: string,
): void {
  form.hidden = true;

  const container = document.createElement("div");
  const shareRef = createRef<HTMLDivElement>();
  const title = `Proposal submitted${firstName ? `, ${firstName}` : ""}!`;

  render(
    <SuccessPanel icon="📋" title={title}>
      <p class="event-flow-success-body">
        Your proposal is now under review. The program committee will be in touch by email with a decision.
      </p>
      {result.manageUrl && (
        <p>
          <ButtonLink href={result.manageUrl}>Manage your proposal →</ButtonLink>
        </p>
      )}
      <p class="pk-small">
        Speakers you listed will each receive a personal email with a private link to confirm their participation,
        complete their profile, and upload a headshot once accepted. If there is context about additional potential
        speakers, include that in your proposal notes or follow up with the program team.
      </p>
      <div ref={shareRef} />
    </SuccessPanel>,
    container,
  );

  if (shareRef.current) {
    renderSharePanel(shareRef.current, {
      shareUrl: `https://pkic.org/events/${eventSlug}/`,
      eventName,
      firstName: firstName || null,
    });
  }

  root.appendChild(container);
}

/** The identity step's part of the proposal, as the contract reads it. */
function contactOf(entry: ProposalEntrySelection) {
  return {
    continuationToken: entry.continuationToken,
    unaffiliatedAttestation: entry.unaffiliatedAttestation,
    proposer: { ...newAffiliationDetails(entry), actingIdentityId: entry.actingIdentityId },
  };
}

/** The page was opened from a proposal email confirmation link. */
function hasEmailConfirmation(): boolean {
  return new URLSearchParams(location.hash.slice(1)).has("verify");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const boot = bootstrap("[data-event-proposal]");
  if (!boot) return;

  const { form, statusEl, eventSlug, eventPagePath, apiBase, query } = boot;
  // Removing a filled-in speaker card confirms in the shared dialog, which needs a host on this public page.
  const confirmHost = document.createElement("div");
  boot.root.append(confirmHost);
  render(<ConfirmDialogHost />, confirmHost);
  const eventPathHeaders = eventPagePath ? { "x-event-base-path": eventPagePath } : undefined;
  const originalEntryContext = proposalEntryContextSchema.parse({
    inviteToken: query.inviteToken ?? undefined,
    inviteId: query.inviteId ?? undefined,
    sourceType: query.sourceType ?? "direct",
    sourceRef: query.sourceType ?? undefined,
    referralCode: query.referralCode ?? undefined,
  });

  const abstractEditor = await mountMarkdownField(
    form.querySelector<HTMLTextAreaElement>("#proposal-abstract"),
    "Abstract",
    proposalCreateSchema.shape.proposal.shape.abstract,
  );
  installLiveValidation(form, statusEl);

  const consentsContainer = boot.root.querySelector<HTMLElement>("[data-consents]");
  const customFieldsContainer = boot.root.querySelector<HTMLElement>("[data-custom-fields]");
  const speakersContainer = boot.root.querySelector<HTMLElement>("[data-proposal-speakers]");
  const addSpeakerBtn = boot.root.querySelector<HTMLButtonElement>("[data-add-speaker]");
  const isPresentingCheckbox = form.querySelector<HTMLInputElement>("#proposal-is-presenting");

  let eventName = eventSlug;
  let formsLoaded = false;
  let requiredTerms: RequiredTerm[] = [];
  /** The terms a confirmed email recorded before its link was sent: agreed once, never asked again. */
  let recordedConsents: ConsentItem[] | null = null;

  // ── Proposer speaker card management ─────────────────────────────────────

  let proposerCardEl: HTMLElement | null = null;
  let entry: ProposalEntrySelection | null = null;
  const identityContainer = boot.root.querySelector<HTMLElement>("[data-proposer-identity]");
  // The terms come first: they can stop someone from continuing, so nobody is asked for an address
  // before accepting them. The contact step then continues through its own email action, and the
  // wizard's Continue appears once it has.
  const CONTACT_STEP = 2;
  const nextButton = boot.root.querySelector<HTMLButtonElement>("[data-step-next]");
  let currentStep = 1;
  let identityActivated = false;
  const syncEntryGate = () => {
    if (nextButton && currentStep === CONTACT_STEP) nextButton.hidden = !entry;
  };
  const TERMS_STEP = 1;
  let steps: ReturnType<typeof installStepNavigation> | null = null;
  function applyRecordedTerms(): void {
    if (!formsLoaded || !recordedConsents || !consentsContainer) return;
    renderConsentInputs(consentsContainer, requiredTerms, recordedConsents);
    steps?.continueFrom(TERMS_STEP);
  }
  const recordTerms = (consents: ConsentItem[]): void => {
    recordedConsents = consents;
    applyRecordedTerms();
  };
  const updateEntry = (selection: ProposalEntrySelection | null): void => {
    entry = selection;
    syncEntryGate();
    if (selection && proposerCardEl && proposerLinksRef)
      createProposerCard(defaultProposerRole(), selection, proposerCardEl, proposerLinksRef);
  };
  function activateIdentity(): void {
    if (!identityContainer || identityActivated) return;
    identityActivated = true;
    render(
      <EventProposalIdentityStep
        enabled
        eventSlug={eventSlug}
        consents={() => readConsentValues(form)}
        onChange={updateEntry}
        onTermsRecorded={recordTerms}
        entryContext={originalEntryContext}
      />,
      identityContainer,
    );
  }

  function defaultProposerRole(): string {
    return readField(form, "proposalType") === "panel" ? "moderator" : "speaker";
  }

  function ensureProposerCard(): void {
    if (proposerCardEl || !speakersContainer || !entry) return;
    const { el, linksRef } = createProposerCard(defaultProposerRole(), entry);
    proposerCardEl = el;
    proposerLinksRef = linksRef;
    speakersContainer.prepend(el);
    linksRef.current?.setLinks(entry.person.links);
    syncProposerRoleDefault();
  }

  function removeProposerCard(): void {
    if (!proposerCardEl) return;
    render(null, proposerCardEl);
    proposerCardEl.remove();
    proposerCardEl = null;
    proposerLinksRef = null;
  }

  function syncProposerRoleDefault(): void {
    if (!proposerCardEl) return;
    const role = defaultProposerRole();
    const selected = form.querySelector<HTMLInputElement>('input[name="proposerSpeakerRole"]:checked');
    if (selected && selected.value !== "speaker" && selected.value !== "moderator") return;
    const target = form.querySelector<HTMLInputElement>(`input[name="proposerSpeakerRole"][value="${role}"]`);
    if (target) target.checked = true;
  }

  isPresentingCheckbox?.addEventListener("change", () => {
    if (isPresentingCheckbox.checked) {
      ensureProposerCard();
    } else {
      removeProposerCard();
    }
  });

  // ── Step navigation ───────────────────────────────────────────────────────

  steps = installStepNavigation(
    boot.root,
    form,
    statusEl,
    (step) => {
      if (step === 1 && !formsLoaded) {
        setStatus(statusEl, "Please wait until the proposal terms are available.", true);
        return false;
      }
      if (step === CONTACT_STEP && !entry) {
        setStatus(statusEl, "Confirm your participation details and email before continuing.", true);
        return false;
      }
      if (step === CONTACT_STEP && entry) {
        if (entry.validateAffiliation?.() === false) return false;
        // The contract's own rule for who the contact takes part as, checked where it is asked.
        const contact = proposalContactSchema.safeParse(contactOf(entry));
        if (!contact.success) {
          const refused = normalizeValidation(contact.error);
          applyFieldErrors(form, refused.fields);
          setStatus(statusEl, refused.globalMessage, true);
          return false;
        }
      }
      if (step === 3 && abstractEditor && !abstractEditor.validate()) return false;
    },
    (step) => {
      currentStep = step;
      if (step >= CONTACT_STEP) activateIdentity();
      syncEntryGate();
    },
  );
  syncEntryGate();
  // A returning email confirmation already carries the terms it was sent under, so it is read at once.
  if (hasEmailConfirmation()) activateIdentity();

  // ── Add speaker button ────────────────────────────────────────────────────

  addSpeakerBtn?.addEventListener("click", () => {
    if (!speakersContainer) return;
    speakerCount += 1;
    const el = createSpeakerCard(speakerCount);
    additionalSpeakers.push({ index: speakerCount, container: el });
    speakersContainer.append(el);
  });

  boot.root.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement | null;
    if (target?.name === "proposalType") syncProposerRoleDefault();
  });

  // ── Load form metadata ────────────────────────────────────────────────────

  try {
    const forms = await getJson(
      `${apiBase}/events/${eventSlug}/forms/placements/proposal_submission`,
      eventFormsResponseSchema,
    );
    const windowState = forms.form?.placement
      ? deriveFormSubmissionWindowState(forms.form.placement, new Date().toISOString())
      : "open";
    if (windowState !== "open") {
      form
        .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
          "input, select, textarea, button",
        )
        .forEach((control) => {
          control.disabled = true;
        });
      setStatus(
        statusEl,
        windowState === "scheduled"
          ? "The call for proposals has not opened yet."
          : "The call for proposals is closed.",
        true,
      );
      return;
    }
    eventName = forms.event.name;
    formsLoaded = true;
    requiredTerms = forms.requiredTerms;
    if (consentsContainer) renderConsentInputs(consentsContainer, requiredTerms, recordedConsents ?? undefined);
    applyRecordedTerms();
    // Whatever the event allows, and only that. The fallback that used to
    // stand here named three session types of its own — a second copy of the
    // backend's `DEFAULT_SESSION_TYPES`, which `resolveSessionTypes` already
    // applies before the response is built, so the field is never empty and
    // the copy could only ever have offered a type the event refused.
    renderSessionTypes(boot.root, forms.allowedSessionTypes, forms.sessionTypes);
    if (customFieldsContainer && forms.form) {
      renderCustomFields(customFieldsContainer, forms.form.fields);
    }
  } catch {
    setStatus(statusEl, "Could not load proposal form details.", true);
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    // `validateBeforeSubmit` marks the form as validated itself; adding the
    // class here as well was a second owner for the same state. Consent cards
    // draw their own error from the platform's `invalid` event, which
    // `syncConsentValidation` triggers, so nothing here depended on the class.
    syncConsentValidation(form);
    if (!validateBeforeSubmit(form, statusEl) || (abstractEditor && !abstractEditor.validate())) return;

    if (!entry) {
      setStatus(statusEl, "Confirm your participation details and email before submitting.", true);
      return;
    }
    await withLoadingButton(findSubmitButton(form), async () => {
      try {
        const submittedEntry = await prepareProposalEntry(entry!);
        const isPresenting = isPresentingCheckbox?.checked ?? false;
        const firstName = submittedEntry.person.firstName ?? "";

        const payload = (submittedEntry.authenticated ? authenticatedProposalCreateSchema : proposalCreateSchema).parse(
          {
            continuationToken: submittedEntry.continuationToken,
            unaffiliatedAttestation: submittedEntry.unaffiliatedAttestation,
            independentCapacity: submittedEntry.independentCapacity,
            ...(submittedEntry.entryContext ?? originalEntryContext),

            proposer: {
              ...newAffiliationDetails(submittedEntry),
              actingIdentityId: submittedEntry.actingIdentityId,
              bio: isPresenting ? readField(form, "proposerBio") || undefined : undefined,
              links: isPresenting && proposerLinksRef?.current ? proposerLinksRef.current.getLinks() : [],
              role: isPresenting ? readRadio(form, "proposerSpeakerRole") || defaultProposerRole() : "proposer",
            },

            proposal: {
              type: readField(form, "proposalType") || "talk",
              title: readField(form, "title"),
              abstract: readField(form, "abstract"),
              committeeNotes: readField(form, "committeeNotes") || undefined,
              details: readCustomFieldValues(form),
            },

            speakers: readAdditionalSpeakers(form),
            consents: readConsentValues(form),
          },
        );

        const result = await postJson(
          `${apiBase}/events/${eventSlug}/proposals`,
          payload,
          proposalCreateResponseSchema,
          eventPathHeaders,
        );

        clearReferralSession();
        showSuccessPanel(boot.root, form, result, firstName, eventName, eventSlug);
      } catch (error) {
        await handleFormInviteSubmitError({
          error,
          form,
          apiBase,
          statusEl,
          hasInviteToken: Boolean(query.inviteToken),
        });
      }
    });
  });
}

void main();
