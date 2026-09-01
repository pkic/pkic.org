import { render } from "preact";
import { Alert } from "../ui/Alert";
import { getJson, patchJson } from "../shared/api-client";
import { normalizeValidation } from "../shared/form/validation-map";
import { renderProfileLinks, normalizeProfileLinks, type ProfileLinksWidget } from "../shared/widgets/profile-links";
import { renderConsentInputs, readConsentValues, syncConsentValidation } from "../shared/widgets/consents";
import { withLoadingButton } from "../shared/form/submit";
import { setStatus } from "./boot";
import { wireTokenHeadshotSection } from "./registration-manage-headshot";
import { eventTermsResponseSchema, type RequiredTerm } from "../../shared/schemas/forms";
import { formatStatusLabel, statusBadgeToneClass, findSubmitButton } from "../shared/form/helpers";
import { loadSpeakerPageData } from "./speaker-link-recovery";
import {
  speakerSelfServiceReadResponseSchema,
  speakerParticipationResponseSchema,
  type SpeakerSelfServiceReadResponse,
} from "../../shared/schemas/speaker-self-service";
import { successResponseSchema } from "../../shared/schemas/api-common";
import { speakerProfilePatchSchema, speakerParticipationPatchSchema } from "../../shared/schemas/proposal-management";
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
      deadlineRow.textContent = `Presentation deadline: ${new Date(data.proposal.presentationDeadline).toLocaleString()}`;
    } else {
      deadlineRow.textContent = "Presentation upload opens after acceptance.";
    }
  }

  // Participation section
  const speakerStatusBadge = boot.root.querySelector<HTMLElement>("[data-speaker-status-badge]");
  const confirmPanel = boot.root.querySelector<HTMLElement>("[data-confirm-panel]");
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

  if (confirmForm && consentContainer && data.speaker.status === "invited") {
    try {
      const termsResponse = await getJson(
        `${boot.apiBase}/events/${encodeURIComponent(boot.eventSlug)}/terms?audience=speaker`,
        eventTermsResponseSchema,
      );
      speakerTerms = termsResponse.terms ?? [];
      renderConsentInputs(consentContainer, speakerTerms);
    } catch (error) {
      console.error("Failed to load speaker terms", error);
      render(<Alert tone="danger">Could not load required terms right now.</Alert>, consentContainer);
    }
  }

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

    await withLoadingButton(findSubmitButton(confirmForm), async () => {
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
  const firstNameField = profileForm?.querySelector<HTMLInputElement>("#speaker-first-name");
  const lastNameField = profileForm?.querySelector<HTMLInputElement>("#speaker-last-name");
  const organizationField = profileForm?.querySelector<HTMLInputElement>("#speaker-organization");
  const jobTitleField = profileForm?.querySelector<HTMLInputElement>("#speaker-job-title");
  const bioField = profileForm?.querySelector<HTMLTextAreaElement>("#speaker-bio");
  const linksContainer = boot.root.querySelector<HTMLElement>("[data-profile-links-container]");
  let linksWidget: ProfileLinksWidget | null = null;

  function showProfileEditForm(): void {
    if (profileSavedState) profileSavedState.hidden = true;
    if (profileFormWrap) profileFormWrap.hidden = false;
    firstNameField?.focus();
  }

  function showProfileSavedState(): void {
    if (profileFormWrap) profileFormWrap.hidden = true;
    if (profileSavedState) profileSavedState.hidden = false;
  }

  profileEditButton?.addEventListener("click", showProfileEditForm);

  if (firstNameField) firstNameField.value = data.profile.firstName ?? "";
  if (lastNameField) lastNameField.value = data.profile.lastName ?? "";
  if (organizationField) organizationField.value = data.profile.organizationName ?? "";
  if (jobTitleField) jobTitleField.value = data.profile.jobTitle ?? "";
  if (bioField) bioField.value = data.profile.biography ?? "";
  if (linksContainer) {
    linksWidget = renderProfileLinks(linksContainer, "links", { max: 10 });
    linksWidget.setLinks(normalizeProfileLinks(data.profile.links));
  }

  profileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await withLoadingButton(findSubmitButton(profileForm), async () => {
      try {
        await patchJson(
          proposalSpeakerAccessPath(boot.apiBase, token, "profile"),
          speakerProfilePatchSchema.parse({
            firstName: firstNameField?.value.trim() || null,
            lastName: lastNameField?.value.trim() || null,
            organizationName: organizationField?.value.trim() || null,
            jobTitle: jobTitleField?.value.trim() || null,
            biography: bioField?.value.trim() || "",
            links: linksWidget?.getLinks() ?? [],
          }),
          successResponseSchema,
        );
        setStatus(boot.statusEl, "Profile updated.");
        showProfileSavedState();
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
