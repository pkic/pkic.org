import { showHeadshotDisclaimer } from "../shared/headshot/upload";
import { setStatus } from "./boot";
import { presentationUploadRequest } from "../../shared/presentation-upload";
import type { SpeakerAccessSummary, SpeakerProposalSummary } from "./speaker-api-types";
import { loadSpeakerPageData } from "./speaker-link-recovery";

/** Matches the DB record shape returned directly by the GET endpoint. */
interface PresentationTerm {
  term_key: string;
  version: string;
  required: number | boolean;
  display_text: string | null;
  help_text: string | null;
  content_ref: string | null;
}

const DEFAULT_PRESENTATION_TERMS = [
  "I am authorized to share this presentation with the PKI Consortium.",
  "The presentation does not contain confidential or commercially sensitive information that cannot be made public.",
  "The presentation does not include unlicensed third-party material.",
  "I accept that this presentation may be published on the event website and related materials.",
  "The presentation does not contain unsolicited commercial messages or advertising.",
];

interface PresentationApiResponse {
  speaker: SpeakerAccessSummary;
  proposal: SpeakerProposalSummary;
  presentationTerms: PresentationTerm[];
  profile: {
    firstName: string | null;
    lastName: string | null;
    email: string;
  };
}

async function main(): Promise<void> {
  const loaded = await loadSpeakerPageData<PresentationApiResponse>({
    selector: "[data-event-speaker-presentation]",
    request: async (token, boot) => {
      const response = await fetch(`${boot.apiBase}/proposals/speaker/${encodeURIComponent(token)}`);
      if (!response.ok) {
        const json = (await response.json()) as { error?: { message?: string } };
        throw new Error(json.error?.message ?? `HTTP ${response.status}`);
      }
      return (await response.json()) as PresentationApiResponse;
    },
  });
  if (!loaded) return;
  const { boot, token, data, loadingEl, contentEl } = loaded;
  const notAcceptedEl = boot.root.querySelector<HTMLElement>("[data-not-accepted-section]");

  if (loadingEl) loadingEl.classList.add("d-none");

  // If speaker is not accepted or proposal is not accepted, show not-accepted state
  if (data.speaker.status === "declined" || data.proposal.status !== "accepted") {
    notAcceptedEl?.classList.remove("d-none");
    return;
  }

  if (contentEl) contentEl.classList.remove("d-none");

  // Proposal summary
  const proposalTitleEl = boot.root.querySelector<HTMLElement>("[data-proposal-title]");
  const deadlineEl = boot.root.querySelector<HTMLElement>("[data-presentation-deadline-row]");

  if (proposalTitleEl) proposalTitleEl.textContent = data.proposal.title;
  if (deadlineEl) {
    if (data.proposal.presentationDeadline) {
      deadlineEl.textContent = `Presentation deadline: ${new Date(data.proposal.presentationDeadline).toLocaleString()}`;
    } else {
      deadlineEl.textContent = "";
    }
  }

  // Co-speaker notice
  const coSpeakerNotice = boot.root.querySelector<HTMLElement>("[data-cospeaker-upload-notice]");
  const uploader = data.proposal.presentationUploader;
  if (coSpeakerNotice && uploader) {
    const uploaderName = [uploader.firstName, uploader.lastName].filter(Boolean).join(" ") || "A co-presenter";
    const uploadedDate = new Date(uploader.uploadedAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    coSpeakerNotice.textContent = `${uploaderName} already uploaded a presentation for this session on ${uploadedDate}. You only need to upload again if you want to replace it.`;
    coSpeakerNotice.classList.remove("d-none");
  }

  // Status message
  const presentationMsg = boot.root.querySelector<HTMLElement>("[data-presentation-status-msg]");
  if (presentationMsg) {
    const hasCoSpeakers = data.proposal.coSpeakers.length > 0;
    presentationMsg.textContent = data.proposal.presentationUploaded
      ? "Presentation uploaded. You can replace it with a newer version if needed."
      : hasCoSpeakers
        ? "Please upload your final presentation file. If a co-presenter uploads first, you'll see a notice here."
        : "Please upload your final presentation file.";
  }

  // Presentation terms — use API terms or fall back to defaults
  const disclaimerTexts =
    data.presentationTerms && data.presentationTerms.length > 0
      ? data.presentationTerms
          .map((t) => t.display_text ?? t.term_key)
          .filter((t): t is string => typeof t === "string")
      : DEFAULT_PRESENTATION_TERMS;

  // File upload with disclaimer
  const presentationLabel = boot.root.querySelector<HTMLLabelElement>("[data-presentation-upload-label]");
  const presentationInput = boot.root.querySelector<HTMLInputElement>("[data-presentation-file]");
  const presentationUploadStatus = boot.root.querySelector<HTMLElement>("[data-presentation-upload-status]");

  presentationLabel?.addEventListener("click", async (e) => {
    e.preventDefault();
    const accepted = await showHeadshotDisclaimer({
      title: "Before you upload your presentation",
      texts: disclaimerTexts,
      confirmText: "Upload presentation",
    });
    if (accepted) {
      presentationInput?.click();
    }
  });

  presentationInput?.addEventListener("change", () => {
    const file = presentationInput.files?.[0];
    if (!file) return;
    presentationInput.value = "";
    void (async () => {
      if (presentationUploadStatus) presentationUploadStatus.textContent = "Uploading…";
      try {
        const upload = presentationUploadRequest(file);
        const response = await fetch(`${boot.apiBase}/proposals/speaker/${encodeURIComponent(token)}/presentation`, {
          method: "PUT",
          ...upload,
        });
        const json = (await response.json()) as { success?: boolean; error?: { message?: string } };
        if (!response.ok) throw new Error(json.error?.message ?? `HTTP ${response.status}`);
        if (presentationUploadStatus) presentationUploadStatus.textContent = "Presentation uploaded successfully.";
        if (presentationMsg)
          presentationMsg.textContent = "Presentation uploaded. You can replace it with a newer version if needed.";
        if (coSpeakerNotice) coSpeakerNotice.classList.add("d-none");
        setStatus(boot.statusEl, "Presentation uploaded successfully.");
      } catch (error) {
        if (presentationUploadStatus)
          presentationUploadStatus.textContent = `Upload failed: ${(error as Error).message}`;
        setStatus(boot.statusEl, `Upload failed: ${(error as Error).message}`, true);
      }
    })();
  });
}

void main();
