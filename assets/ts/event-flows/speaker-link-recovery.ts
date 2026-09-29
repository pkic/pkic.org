import { showManageLinkRecoveryForm } from "../shared/widgets/link-recovery";
import { normalizeValidation } from "../shared/form/validation-map";
import { bootstrap, type FlowBoot } from "./boot";

export function showSpeakerManageLinkRecovery(
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
    successMessage:
      "If the details match an invited speaker, you will receive an email shortly. Please check your inbox (and spam folder).",
    introMessage,
  });
}

export interface LoadedSpeakerPage<T> {
  boot: FlowBoot;
  token: string;
  data: T;
  loadingEl: HTMLElement | null;
  contentEl: HTMLElement | null;
}

/** Resolves the common speaker token, recovery UI, and initial API request. */
export async function loadSpeakerPageData<T>(options: {
  selector: string;
  request: (token: string, boot: FlowBoot) => Promise<T>;
}): Promise<LoadedSpeakerPage<T> | null> {
  const boot = bootstrap(options.selector);
  if (!boot) return null;

  const token = boot.query.token?.trim() ?? null;
  if (!token) {
    showSpeakerManageLinkRecovery(
      boot.root,
      boot.apiBase,
      boot.eventSlug,
      "Missing speaker token. Request a fresh link below.",
    );
    return null;
  }

  try {
    const data = await options.request(token, boot);
    return {
      boot,
      token,
      data,
      loadingEl: boot.root.querySelector<HTMLElement>("[data-speaker-loading]"),
      contentEl: boot.root.querySelector<HTMLElement>("[data-speaker-content]"),
    };
  } catch (error) {
    const normalized = normalizeValidation(error);
    showSpeakerManageLinkRecovery(
      boot.root,
      boot.apiBase,
      boot.eventSlug,
      `${normalized.globalMessage} You can request a fresh link below.`,
    );
    return null;
  }
}
