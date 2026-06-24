import { showHeadshotDisclaimer } from "../shared/headshot/upload";
import { showManageLinkRecoveryForm } from "../shared/widgets/link-recovery";
import { normalizeValidation } from "../shared/form/validation-map";
import { bootstrap, setStatus } from "./boot";

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
  "I am authorised to share this presentation with the PKI Consortium.",
  "The presentation does not contain confidential or commercially sensitive information that cannot be made public.",
  "The presentation does not include unlicensed third-party material.",
  "I accept that this presentation may be published on the event website and related materials.",
  "The presentation does not contain unsolicited commercial messages or advertising.",
];

interface PresentationApiResponse {
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
    presentationUploadedAt: string | null;
    presentationUploader: { firstName: string | null; lastName: string | null; uploadedAt: string } | null;
    coSpeakers: Array<{ firstName: string | null; lastName: string | null; status: string }>;
  };
  presentationTerms: PresentationTerm[];
  profile: {
    firstName: string | null;
    lastName: string | null;
    email: string;
  };
}

function showResendForm(root: HTMLElement, apiBase: string, eventSlug: string, introMessage?: string): void {
  showManageLinkRecoveryForm({
    root,
    loadingSelector: "[data-speaker-loading]",
    sectionSelector: "[data-resend-speaker-manage-section]",
    buttonSelector: "[data-resend-speaker-manage-btn]",
    statusSelector: "[data-resend-speaker-manage-status]",
    emailSelector: "[data-resend-speaker-manage-email]",
    endpoint: `${apiBase}/events/${eventSlug}/proposals/resend-speaker-manage-link`,
    successMessage:
      "If the details match an invited speaker, you will receive an email shortly. Please check your inbox (and spam folder).",
    introMessage,
  });
}

async function main(): Promise<void> {
  const boot = bootstrap("[data-event-speaker-presentation]");
  if (!boot) return;

  const token = boot.query.token?.trim() ?? null;
  if (!token) {
    showResendForm(boot.root, boot.apiBase, boot.eventSlug, "Missing speaker token. Request a fresh link below.");
    return;
  }

  const loadingEl = boot.root.querySelector<HTMLElement>("[data-speaker-loading]");
  const contentEl = boot.root.querySelector<HTMLElement>("[data-speaker-content]");
  const notAcceptedEl = boot.root.querySelector<HTMLElement>("[data-not-accepted-section]");

  let data: PresentationApiResponse;
  try {
    const res = await fetch(`${boot.apiBase}/proposals/speaker/${encodeURIComponent(token)}`);
    if (!res.ok) {
      const json = (await res.json()) as { error?: { message?: string } };
      throw new Error(json.error?.message ?? `HTTP ${res.status}`);
    }
    data = (await res.json()) as PresentationApiResponse;
  } catch (error) {
    const normalized = normalizeValidation(error);
    showResendForm(
      boot.root,
      boot.apiBase,
      boot.eventSlug,
      `${normalized.globalMessage} You can request a fresh link below.`,
    );
    return;
  }

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
      const formData = new FormData();
      formData.append("file", file);
      try {
        const response = await fetch(`${boot.apiBase}/proposals/speaker/${encodeURIComponent(token)}/presentation`, {
          method: "PUT",
          body: formData,
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
