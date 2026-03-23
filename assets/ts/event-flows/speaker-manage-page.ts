import { getJson, patchJson, postJson } from "../shared/api-client";
import { setButtonLoading, resetButton } from "../shared/button-loading";
import { normalizeValidation } from "../shared/validation-map";
import { renderProfileLinks, type ProfileLinksWidget } from "../shared/render-profile-links";
import { renderConsentInputs, readConsentValues, syncConsentValidation } from "../shared/render-consents";
import { cropHeadshot } from "../shared/crop-headshot";
import { prepareHeadshotUploadBlob, showHeadshotDisclaimer } from "../shared/headshot-upload";
import { showManageLinkRecoveryForm } from "../shared/manage-link-recovery";
import { renderHeadshotPreview } from "../shared/headshot-preview";
import { bootstrap, setStatus } from "./boot";
import type { RequiredTerm } from "../shared/types";

interface SpeakerManageResponse {
  speaker: {
    role: string;
    status: string;
    confirmedAt: string | null;
    declinedAt: string | null;
    termsAcceptedAt: string | null;
  };
  proposal: {
    id: string;
    title: string;
    proposalType: string;
    status: string;
    presentationDeadline: string | null;
    presentationUploaded: boolean;
  };
  profile: {
    firstName: string | null;
    lastName: string | null;
    email: string;
    organizationName: string | null;
    jobTitle: string | null;
    biography: string | null;
    links: Array<{ label?: string; url?: string } | string>;
    headshotUploaded: boolean;
    headshotUpdatedAt: string | null;
    headshotUrl: string | null;
  };
}

interface TermsApiResponse {
  terms: RequiredTerm[];
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "invited":
      return "bg-warning text-dark";
    case "confirmed":
      return "bg-success";
    case "declined":
      return "bg-danger";
    case "submitted":
      return "bg-info text-dark";
    case "accepted":
      return "bg-success";
    case "rejected":
      return "bg-danger";
    default:
      return "bg-secondary";
  }
}

function formatStatusLabel(status: string): string {
  return status
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeLinks(raw: SpeakerManageResponse["profile"]["links"]): string[] {
  return raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && typeof entry.url === "string") return entry.url;
      return "";
    })
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function showResendSpeakerManageLinkForm(
  root: HTMLElement,
  apiBase: string,
  eventSlug: string,
  introMessage?: string,
): void {
  showManageLinkRecoveryForm({
    root,
    loadingSelector: "[data-speaker-loading]",
    sectionSelector: "[data-resend-speaker-manage-section]",
    buttonSelector: "[data-resend-speaker-manage-btn]",
    statusSelector: "[data-resend-speaker-manage-status]",
    emailSelector: "[data-resend-speaker-manage-email]",
    endpoint: `${apiBase}/events/${eventSlug}/proposals/resend-speaker-manage-link`,
    successMessage: "If the details match an invited speaker, you will receive an email shortly. Please check your inbox (and spam folder).",
    introMessage,
  });
}

async function main(): Promise<void> {
  const boot = bootstrap("[data-event-speaker-manage]");
  if (!boot) return;

  const token = boot.query.token?.trim() ?? null;
  if (!token) {
    showResendSpeakerManageLinkForm(
      boot.root,
      boot.apiBase,
      boot.eventSlug,
      "Missing speaker token. Request a fresh link below.",
    );
    return;
  }

  const loadingEl = boot.root.querySelector<HTMLElement>("[data-speaker-loading]");
  const contentEl = boot.root.querySelector<HTMLElement>("[data-speaker-content]");

  let data: SpeakerManageResponse;
  try {
    data = await getJson<SpeakerManageResponse>(`${boot.apiBase}/proposals/speaker/${encodeURIComponent(token)}`);
  } catch (error) {
    const normalized = normalizeValidation(error);
    showResendSpeakerManageLinkForm(
      boot.root,
      boot.apiBase,
      boot.eventSlug,
      `${normalized.globalMessage} You can request a fresh link below.`,
    );
    return;
  }

  // Summary
  const proposalTitle = boot.root.querySelector<HTMLElement>("[data-proposal-title]");
  const proposalType = boot.root.querySelector<HTMLElement>("[data-proposal-type]");
  const proposalStatus = boot.root.querySelector<HTMLElement>("[data-proposal-status-badge]");
  const deadlineRow = boot.root.querySelector<HTMLElement>("[data-presentation-deadline-row]");

  if (proposalTitle) proposalTitle.textContent = data.proposal.title;
  if (proposalType) proposalType.textContent = data.proposal.proposalType.replace(/_/g, " ");
  if (proposalStatus) {
    proposalStatus.textContent = formatStatusLabel(data.proposal.status);
    proposalStatus.className = `badge rounded-pill px-2 py-1 ${statusBadgeClass(data.proposal.status)}`;
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
  const presentationSection = boot.root.querySelector<HTMLElement>("[data-presentation-section]");
  const headshotPreview = boot.root.querySelector<HTMLElement>("[data-headshot-preview]");
  const headshotStatus = boot.root.querySelector<HTMLElement>("[data-headshot-status]");
  const headshotFile = boot.root.querySelector<HTMLInputElement>("[data-headshot-file]");

  function toggleEditableSections(isEnabled: boolean): void {
    headshotSection?.classList.toggle("d-none", !isEnabled);
    profileSection?.classList.toggle("d-none", !isEnabled);
    presentationSection?.classList.toggle("d-none", !isEnabled);
  }

  if (speakerStatusBadge) {
    speakerStatusBadge.textContent = formatStatusLabel(data.speaker.status);
    speakerStatusBadge.className = `badge rounded-pill px-2 py-1 ${statusBadgeClass(data.speaker.status)}`;
  }

  if (data.speaker.status === "invited") {
    confirmPanel?.classList.remove("d-none");
    toggleEditableSections(false);
  } else if (data.speaker.status === "confirmed") {
    confirmedMsg?.classList.remove("d-none");
    toggleEditableSections(true);
  } else if (data.speaker.status === "declined") {
    declinedMsg?.classList.remove("d-none");
    toggleEditableSections(false);
  }

  renderHeadshotPreview(headshotPreview, data.profile.headshotUrl, { alt: "Your headshot", emptyLabel: "No headshot uploaded yet." });

  // Confirm
  const confirmForm = boot.root.querySelector<HTMLFormElement>("[data-confirm-form]");
  const consentContainer = boot.root.querySelector<HTMLElement>("[data-speaker-consents]");
  let speakerTerms: RequiredTerm[] = [];

  if (confirmForm && consentContainer && data.speaker.status === "invited") {
    try {
      const termsResponse = await getJson<TermsApiResponse>(
        `${boot.apiBase}/events/${encodeURIComponent(boot.eventSlug)}/terms?audience=speaker`,
      );
      speakerTerms = termsResponse.terms ?? [];
      renderConsentInputs(consentContainer, speakerTerms);
    } catch (error) {
      console.error("Failed to load speaker terms", error);
      consentContainer.innerHTML = "<p class='text-danger small mb-0'>Could not load required terms right now.</p>";
    }
  }

  confirmForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = confirmForm.querySelector<HTMLButtonElement>("button[type='submit']");
    confirmForm.classList.add("was-validated");
    syncConsentValidation(confirmForm);

    const consents = readConsentValues(confirmForm);
    const requiredCount = speakerTerms.filter((term) => term.required).length;
    if (requiredCount > 0 && consents.length < requiredCount) {
      setStatus(boot.statusEl, "Please accept all required speaker terms to continue.", true);
      return;
    }

    if (submit) setButtonLoading(submit);
    try {
      await postJson(`${boot.apiBase}/proposals/speaker/${encodeURIComponent(token)}`, {
        action: "confirm",
        consents,
      });
      window.location.reload();
    } catch (error) {
      const normalized = normalizeValidation(error);
      setStatus(boot.statusEl, normalized.globalMessage, true);
      if (submit) resetButton(submit);
    }
  });

  const declineOpen = boot.root.querySelector<HTMLButtonElement>("[data-decline-open]");
  const declineCancel = boot.root.querySelector<HTMLButtonElement>("[data-decline-cancel]");
  const declineConfirm = boot.root.querySelector<HTMLButtonElement>("[data-decline-confirm]");
  const declineReason = boot.root.querySelector<HTMLTextAreaElement>("#decline-reason");

  declineOpen?.addEventListener("click", () => {
    declinePanel?.classList.remove("d-none");
  });
  declineCancel?.addEventListener("click", () => {
    declinePanel?.classList.add("d-none");
  });
  declineConfirm?.addEventListener("click", async () => {
    if (declineConfirm) setButtonLoading(declineConfirm);
    try {
      await postJson(`${boot.apiBase}/proposals/speaker/${encodeURIComponent(token)}`, {
        action: "decline",
        reason: declineReason?.value.trim() || undefined,
      });
      window.location.reload();
    } catch (error) {
      const normalized = normalizeValidation(error);
      setStatus(boot.statusEl, normalized.globalMessage, true);
      if (declineConfirm) resetButton(declineConfirm);
    }
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
    profileSavedState?.classList.add("d-none");
    profileFormWrap?.classList.remove("d-none");
    bioField?.focus();
  }

  function showProfileSavedState(): void {
    profileFormWrap?.classList.add("d-none");
    profileSavedState?.classList.remove("d-none");
  }

  profileEditButton?.addEventListener("click", showProfileEditForm);

  if (bioField) bioField.value = data.profile.biography ?? "";
  if (linksContainer) {
    linksWidget = renderProfileLinks(linksContainer, "links", { max: 10 });
    linksWidget.setLinks(normalizeLinks(data.profile.links));
  }

  profileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = profileForm.querySelector<HTMLButtonElement>("button[type='submit']");
    if (submit) setButtonLoading(submit);
    try {
      await patchJson(`${boot.apiBase}/proposals/speaker/${encodeURIComponent(token)}`, {
        biography: bioField?.value.trim() || "",
        links: (linksWidget?.getLinks() ?? []).map((url) => ({ label: url, url })),
      });
      setStatus(boot.statusEl, "Profile updated.");
      showProfileSavedState();
    } catch (error) {
      const normalized = normalizeValidation(error);
      setStatus(boot.statusEl, normalized.globalMessage, true);
      showProfileEditForm();
    } finally {
      if (submit) resetButton(submit);
    }
  });

  if (data.speaker.status === "declined") {
    headshotSection?.classList.add("d-none");
  } else {
    headshotFile?.addEventListener("change", () => {
      const file = headshotFile.files?.[0];
      if (!file) return;
      headshotFile.value = "";
      void (async () => {
        const accepted = await showHeadshotDisclaimer();
        if (!accepted) return;
        if (headshotStatus) headshotStatus.textContent = "Preparing image…";
        const cropped = await cropHeadshot(file);
        if (!cropped) return;
        const uploadBlob = await prepareHeadshotUploadBlob(cropped, 1024 * 1024);
        const uploadFile = new File([uploadBlob], "headshot.jpg", { type: "image/jpeg" });
        if (headshotStatus) headshotStatus.textContent = "Uploading…";

        const formData = new FormData();
        formData.append("file", uploadFile);
        formData.append("consent", "true");

        try {
          const response = await fetch(`${boot.apiBase}/proposals/speaker/${encodeURIComponent(token)}/headshot`, {
            method: "PUT",
            body: formData,
          });
          const json = await response.json() as { success?: boolean; headshotUrl?: string; error?: { message?: string } };
          if (!response.ok) throw new Error(json.error?.message ?? `HTTP ${response.status}`);
          if (headshotStatus) headshotStatus.textContent = "Headshot uploaded successfully.";
          renderHeadshotPreview(headshotPreview, json.headshotUrl ?? `${boot.apiBase}/proposals/speaker/${encodeURIComponent(token)}/headshot?v=${Date.now()}`, { alt: "Your headshot", emptyLabel: "No headshot uploaded yet." });
        } catch (error) {
          if (headshotStatus) headshotStatus.textContent = `Upload failed: ${(error as Error).message}`;
        }
      })();
    });
  }

  // Presentation upload
  const presentationMsg = boot.root.querySelector<HTMLElement>("[data-presentation-status-msg]");
  const presentationInput = boot.root.querySelector<HTMLInputElement>("[data-presentation-file]");
  const presentationUploadStatus = boot.root.querySelector<HTMLElement>("[data-presentation-upload-status]");

  if (data.proposal.status === "accepted") {
    presentationSection?.classList.remove("d-none");
    if (presentationMsg) {
      presentationMsg.textContent = data.proposal.presentationUploaded
        ? "Presentation uploaded. You can replace it with a newer version if needed."
        : "Please upload your final presentation file.";
    }
  }

  presentationInput?.addEventListener("change", () => {
    const file = presentationInput.files?.[0];
    if (!file) return;
    presentationInput.value = "";
    void (async () => {
      if (presentationUploadStatus) presentationUploadStatus.textContent = "Uploading…";
      const formData = new FormData();
      formData.append("file", file);
      try {
        const response = await fetch(`${boot.apiBase}/proposals/speaker/${encodeURIComponent(token)}/presentation`, {
          method: "PUT",
          body: formData,
        });
        const json = await response.json() as { success?: boolean; error?: { message?: string } };
        if (!response.ok) throw new Error(json.error?.message ?? `HTTP ${response.status}`);
        if (presentationUploadStatus) presentationUploadStatus.textContent = "Presentation uploaded.";
      } catch (error) {
        if (presentationUploadStatus) presentationUploadStatus.textContent = `Upload failed: ${(error as Error).message}`;
      }
    })();
  });

  if (loadingEl) loadingEl.classList.add("d-none");
  if (contentEl) contentEl.classList.remove("d-none");
}

void main();
