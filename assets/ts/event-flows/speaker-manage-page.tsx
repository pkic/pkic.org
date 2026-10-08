import { mountMarkdownField } from "../components/markdown-editor/mount-markdown-field";
import { render } from "preact";
import { Alert } from "../ui/Alert";
import { getJson, patchJson } from "../shared/api-client";
import { formatDateTime } from "../shared/ui";
import { normalizeValidation } from "../shared/form/validation-map";
import { renderProfileLinks, normalizeProfileLinks, type ProfileLinksWidget } from "../shared/widgets/profile-links";
import { renderConsentInputs, readConsentValues, syncConsentValidation } from "../shared/widgets/consents";
import { withLoadingButton } from "../shared/form/submit";
import { setStatus } from "./boot";
import { wireTokenHeadshotSection } from "./registration-manage-headshot";
import { eventTermsResponseSchema, type RequiredTerm } from "../../shared/schemas/forms";
import { readField, formatStatusLabel, statusBadgeToneClass, findSubmitButton } from "../shared/form/helpers";
import { loadSpeakerPageData } from "./speaker-link-recovery";
import {
  speakerSelfServiceReadResponseSchema,
  speakerParticipationResponseSchema,
  speakerProfileUpdateResponseSchema,
  type SpeakerSelfServiceReadResponse,
} from "../../shared/schemas/speaker-self-service";
import { SpeakerParticipationIdentity } from "../components/SpeakerParticipationIdentity";
import {
  eventProposalProofIdentityPatchSchema,
  eventProposalProofIdentityPatchResponseSchema,
} from "../../shared/schemas/event-proposal-proof";
import type { RepresentationRolePatch } from "../components/ParticipationRepresentation";
import type { PersonalNamePatch } from "../components/ParticipationPersonalDetails";
import type { ParticipationPerson, ProposalEntrySelection } from "../components/useProposalEntryIdentity";
import {
  speakerSelfProfilePatchSchema,
  speakerParticipationPatchSchema,
} from "../../shared/schemas/proposal-management";
import { proposalSpeakerAccessPath } from "../../shared/proposal-access-paths";

async function main(): Promise<void> {
  const loaded = await loadSpeakerPageData<SpeakerSelfServiceReadResponse>({
    selector: "[data-event-speaker-manage]",
    request: async (token, boot) =>
      getJson(proposalSpeakerAccessPath(boot.apiBase, token), speakerSelfServiceReadResponseSchema),
  });
  if (!loaded) return;
  const { boot, token, data, loadingEl, contentEl } = loaded;

  // Summary
  const proposalTitle = boot.root.querySelector<HTMLElement>("[data-proposal-title]");
  const proposalType = boot.root.querySelector<HTMLElement>("[data-proposal-type]");
  const proposalStatus = boot.root.querySelector<HTMLElement>("[data-proposal-status-badge]");
  const deadlineRow = boot.root.querySelector<HTMLElement>("[data-presentation-deadline-row]");

  if (proposalTitle) proposalTitle.textContent = data.proposal.title;
  if (proposalType) proposalType.textContent = data.proposal.proposalType.replace(/_/g, " ");
  if (proposalStatus) {
    proposalStatus.textContent = formatStatusLabel(data.proposal.status);
    proposalStatus.className = statusBadgeToneClass(data.proposal.status);
  }
  if (deadlineRow) {
    if (data.proposal.presentationDeadline) {
      deadlineRow.textContent = `Presentation deadline: ${formatDateTime(data.proposal.presentationDeadline)}`;
    } else {
      deadlineRow.textContent = "Presentation upload opens after acceptance.";
    }
  }

  // Participation section
  const speakerStatusBadge = boot.root.querySelector<HTMLElement>("[data-speaker-status-badge]");
  const confirmPanel = boot.root.querySelector<HTMLElement>("[data-confirm-panel]");
  const participationActions = boot.root.querySelector<HTMLElement>("[data-participation-actions]");
  const declinePanel = boot.root.querySelector<HTMLElement>("[data-decline-panel]");
  const confirmedMsg = boot.root.querySelector<HTMLElement>("[data-confirmed-msg]");
  const declinedMsg = boot.root.querySelector<HTMLElement>("[data-declined-msg]");
  const headshotSection = boot.root.querySelector<HTMLElement>("[data-headshot-section]");
  const profileSection = boot.root.querySelector<HTMLElement>("[data-profile-section]");
  const presentationLink = boot.root.querySelector<HTMLElement>("[data-presentation-link]");

  /*
   * Visibility is the `hidden` attribute, which is what the template now
   * carries on every panel this module reveals. The class it replaces was
   * Bootstrap's `d-none`, and a `display: none !important` utility cannot be
   * out-ranked by the attribute — so the two had to move together or the
   * panels would have become unhideable.
   */
  function toggleEditableSections(isEnabled: boolean): void {
    if (headshotSection) headshotSection.hidden = !isEnabled;
    if (profileSection) profileSection.hidden = !isEnabled;
  }

  if (speakerStatusBadge) {
    speakerStatusBadge.textContent = formatStatusLabel(data.speaker.status);
    speakerStatusBadge.className = statusBadgeToneClass(data.speaker.status);
  }

  if (data.speaker.status === "invited") {
    if (confirmPanel) confirmPanel.hidden = false;
    if (participationActions) participationActions.hidden = false;
    toggleEditableSections(false);
  } else if (data.speaker.status === "confirmed") {
    if (confirmedMsg) confirmedMsg.hidden = false;
    toggleEditableSections(true);
    if (data.proposal.status === "accepted") {
      const anchor = presentationLink?.querySelector<HTMLAnchorElement>("a");
      if (anchor && data.proposal.presentationUrl) anchor.href = data.proposal.presentationUrl;
      if (presentationLink) presentationLink.hidden = false;
    }
  } else if (data.speaker.status === "declined") {
    if (declinedMsg) declinedMsg.hidden = false;
    toggleEditableSections(false);
  }

  // Confirm
  const confirmForm = boot.root.querySelector<HTMLFormElement>("[data-confirm-form]");
  const consentContainer = boot.root.querySelector<HTMLElement>("[data-speaker-consents]");
  let speakerTerms: RequiredTerm[] = [];
  let speakerTermsLoaded = false;
  let representationSaved = data.profile.actingIdentitySelection !== "unrecorded";
  const confirmationButton = boot.root.querySelector<HTMLButtonElement>("[data-confirm-participation]");
  const representationNotice = document.createElement("div");
  confirmForm?.before(representationNotice);
  function syncRepresentationConfirmation(): void {
    if (confirmationButton) confirmationButton.disabled = !speakerTermsLoaded || !representationSaved;
    render(
      representationSaved ? null : (
        <Alert tone="warn">Confirm and save your speaker identity before confirming participation.</Alert>
      ),
      representationNotice,
    );
  }
  syncRepresentationConfirmation();

  if (confirmForm && consentContainer) {
    try {
      const termsResponse = await getJson(
        `${boot.apiBase}/events/${encodeURIComponent(boot.eventSlug)}/terms?audience=speaker`,
        eventTermsResponseSchema,
      );
      speakerTerms = termsResponse.terms ?? [];
      speakerTermsLoaded = true;
      if (data.speaker.status === "invited") renderConsentInputs(consentContainer, speakerTerms);
    } catch (error) {
      console.error("Failed to load speaker terms", error);
      render(<Alert tone="danger">Could not load required terms right now.</Alert>, consentContainer);
    }
  }
  syncRepresentationConfirmation();

  confirmForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    // `syncConsentValidation` is what shows an unaccepted term: it calls
    // `checkValidity()`, and each consent card listens for the platform's own
    // `invalid` event. Nothing on this form was ever drawn by Bootstrap's
    // `was-validated`, so the class went rather than being translated.
    syncConsentValidation(confirmForm);

    const consents = readConsentValues(confirmForm);
    const requiredCount = speakerTerms.filter((term) => term.required).length;
    if (requiredCount > 0 && consents.length < requiredCount) {
      setStatus(boot.statusEl, "Please accept all required speaker terms to continue.", true);
      return;
    }
    if (!representationSaved) {
      setStatus(boot.statusEl, "Confirm and save your speaker identity before confirming participation.", true);
      return;
    }

    await withLoadingButton(confirmationButton, async () => {
      try {
        await patchJson(
          proposalSpeakerAccessPath(boot.apiBase, token, "participation"),
          speakerParticipationPatchSchema.parse({ status: "confirmed", consents }),
          speakerParticipationResponseSchema,
        );
        window.location.reload();
      } catch (error) {
        const normalized = normalizeValidation(error);
        setStatus(boot.statusEl, normalized.globalMessage, true);
      }
    });
  });

  const declineOpen = boot.root.querySelector<HTMLButtonElement>("[data-decline-open]");
  const declineCancel = boot.root.querySelector<HTMLButtonElement>("[data-decline-cancel]");
  const declineConfirm = boot.root.querySelector<HTMLButtonElement>("[data-decline-confirm]");
  const declineReason = boot.root.querySelector<HTMLTextAreaElement>("#decline-reason");

  declineOpen?.addEventListener("click", () => {
    if (declinePanel) declinePanel.hidden = false;
  });
  declineCancel?.addEventListener("click", () => {
    if (declinePanel) declinePanel.hidden = true;
  });
  declineConfirm?.addEventListener("click", async () => {
    await withLoadingButton(declineConfirm, async () => {
      try {
        await patchJson(
          proposalSpeakerAccessPath(boot.apiBase, token, "participation"),
          speakerParticipationPatchSchema.parse({
            status: "declined",
            reason: declineReason?.value.trim() || undefined,
          }),
          speakerParticipationResponseSchema,
        );
        window.location.reload();
      } catch (error) {
        const normalized = normalizeValidation(error);
        setStatus(boot.statusEl, normalized.globalMessage, true);
      }
    });
  });

  // Bio + links
  const profileForm = boot.root.querySelector<HTMLFormElement>("[data-profile-form]");
  const profileFormWrap = boot.root.querySelector<HTMLElement>("[data-profile-form-wrap]");
  const profileSavedState = boot.root.querySelector<HTMLElement>("[data-profile-saved-state]");
  const profileEditButton = boot.root.querySelector<HTMLButtonElement>("[data-profile-edit]");
  const bioField = profileForm?.querySelector<HTMLTextAreaElement>("#speaker-bio");
  const linksContainer = boot.root.querySelector<HTMLElement>("[data-profile-links-container]");
  let linksWidget: ProfileLinksWidget | null = null;

  function showProfileEditForm(): void {
    if (profileSavedState) profileSavedState.hidden = true;
    if (profileFormWrap) profileFormWrap.hidden = false;
    bioField?.focus();
  }

  function showProfileSavedState(): void {
    if (profileFormWrap) profileFormWrap.hidden = true;
    if (profileSavedState) profileSavedState.hidden = false;
  }

  profileEditButton?.addEventListener("click", showProfileEditForm);

  if (bioField) bioField.value = data.profile.biography ?? "";
  await mountMarkdownField(bioField ?? null, "Biography", speakerSelfProfilePatchSchema.shape.biography);
  if (linksContainer) {
    linksWidget = renderProfileLinks(linksContainer, "links", { max: 10 });
    linksWidget.setLinks(normalizeProfileLinks(data.profile.links));
  }

  let entry: ProposalEntrySelection | null = null;
  let identityChanged = false;
  let identityRevision = 0;
  let identityViewRevision = 0;
  const identityContainer = profileForm?.querySelector<HTMLElement>("[data-speaker-identity]");
  const invited = data.speaker.status === "invited";
  const acceptedConsents = () => readConsentValues(invited ? confirmForm! : profileForm!);
  const updateEntry = (selection: ProposalEntrySelection | null): void => {
    if (selection !== entry) {
      identityRevision += 1;
      identityChanged = true;
      representationSaved = false;
      syncRepresentationConfirmation();
    }
    entry = selection;
  };
  const editIdentity = (): void => {
    identityChanged = true;
    identityRevision += 1;
    representationSaved = false;
    syncRepresentationConfirmation();
  };
  async function savePersonalDetails(names: PersonalNamePatch): Promise<ParticipationPerson> {
    await patchJson(
      proposalSpeakerAccessPath(boot.apiBase, token, "profile"),
      speakerSelfProfilePatchSchema.parse(names),
      speakerProfileUpdateResponseSchema,
    );
    const saved = await getJson(proposalSpeakerAccessPath(boot.apiBase, token), speakerSelfServiceReadResponseSchema);
    data.profile.firstName = saved.profile.firstName;
    data.profile.lastName = saved.profile.lastName;
    return { ...saved.profile, bio: saved.profile.biography };
  }
  async function saveRepresentation(identityId: string, role: RepresentationRolePatch) {
    const saved = await patchJson(
      `${boot.apiBase}/events/${encodeURIComponent(boot.eventSlug)}/proposals/proof/identities/${encodeURIComponent(identityId)}`,
      eventProposalProofIdentityPatchSchema.parse({ ...role, speakerManagementToken: token }),
      eventProposalProofIdentityPatchResponseSchema,
    );
    if (saved.identityId !== identityId) throw new Error("The representation response did not match your selection.");
    if (data.currentRepresentation?.actingIdentityId === saved.identityId) {
      data.currentRepresentation = { ...data.currentRepresentation, jobTitle: saved.jobTitle };
    }
    return saved;
  }
  function renderIdentity(): void {
    if (!identityContainer) return;
    const selected = acceptedConsents();
    const accepted = speakerTerms.every(
      (term) =>
        !term.required ||
        selected.some((consent) => consent.termKey === term.termKey && consent.version === term.version),
    );
    render(
      <SpeakerParticipationIdentity
        key={identityViewRevision}
        data={data}
        eventSlug={boot.eventSlug}
        token={token}
        terms={speakerTerms}
        termsAccepted={accepted}
        termsReady={speakerTermsLoaded}
        consents={acceptedConsents}
        onChange={updateEntry}
        onEditing={editIdentity}
        savePersonalDetails={savePersonalDetails}
        saveRepresentation={saveRepresentation}
      />,
      identityContainer,
    );
  }
  renderIdentity();
  confirmForm?.addEventListener("change", renderIdentity);

  profileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (identityChanged && !entry) {
      setStatus(boot.statusEl, "Confirm your identity and email before saving your profile.", true);
      return;
    }
    const submittedEntry = identityChanged ? entry : null;
    await withLoadingButton(findSubmitButton(profileForm), async () => {
      const submittedIdentityRevision = identityRevision;
      try {
        const saved = await patchJson(
          proposalSpeakerAccessPath(boot.apiBase, token, "profile"),
          speakerSelfProfilePatchSchema.parse({
            ...(submittedEntry
              ? {
                  actingIdentityId: submittedEntry.actingIdentityId,
                  continuationToken: submittedEntry.continuationToken,
                  unaffiliatedAttestation: submittedEntry.unaffiliatedAttestation,
                  consents: acceptedConsents(),
                  ...submittedEntry.missingDetails,
                }
              : {}),
            biography: readField(profileForm!, "biography"),
            links: linksWidget?.getLinks() ?? [],
          }),
          speakerProfileUpdateResponseSchema,
        );
        data.profile = saved.profile;
        data.currentRepresentation = saved.currentRepresentation;
        if (identityRevision === submittedIdentityRevision) identityChanged = false;
        if (submittedEntry && !identityChanged) {
          representationSaved = true;
          history.replaceState({}, "", `${location.pathname}${location.search}`);
        }
        if (!identityChanged) {
          identityViewRevision += 1;
          renderIdentity();
        }
        syncRepresentationConfirmation();
        setStatus(boot.statusEl, "Profile updated.");
        if (identityChanged) showProfileEditForm();
        else showProfileSavedState();
      } catch (error) {
        const normalized = normalizeValidation(error);
        setStatus(boot.statusEl, normalized.globalMessage, true);
        showProfileEditForm();
      }
    });
  });

  if (data.speaker.status === "declined") {
    toggleEditableSections(false);
  } else {
    toggleEditableSections(true);
    wireTokenHeadshotSection({
      root: boot.root,
      initialHeadshotUrl: data.profile.headshotUrl,
      statusEl: boot.statusEl,
      uploadUrl: proposalSpeakerAccessPath(boot.apiBase, token, "headshot"),
      deleteUrl: proposalSpeakerAccessPath(boot.apiBase, token, "headshot"),
      emptyLabel: "No headshot uploaded yet.",
      uploadSuccessStatus: "Headshot uploaded successfully.",
      deleteSuccessStatus: "Headshot removed successfully.",
      confirmDeleteMessage: "Remove your headshot?",
    });
  }

  if (loadingEl) loadingEl.hidden = true;
  if (contentEl) contentEl.hidden = false;
}

void main();
