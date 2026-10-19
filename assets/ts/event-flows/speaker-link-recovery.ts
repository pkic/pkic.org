import { h, render } from "preact";
import { Alert } from "../ui/Alert";
import { Button, ButtonLink } from "../ui/Button";
import { ADDRESS_IN_USE_COPY } from "../../shared/email-first-copy";
import type { VerifiedProposalEntry } from "../components/useProposalEntryIdentity";
import { postJson } from "../shared/api-client";
import {
  eventProposalProofVerifySchema,
  eventProposalProofVerifyResponseSchema,
} from "../../shared/schemas/event-proposal-proof";
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
  initialProof?: VerifiedProposalEntry;
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

  let initialProof: VerifiedProposalEntry | undefined;
  let token = boot.query.token?.trim() ?? null;
  const verificationToken = new URLSearchParams(location.hash.slice(1)).get("verify");
  if (!token && verificationToken && options.selector === "[data-event-speaker-manage]") {
    try {
      const proof = await postJson(
        `${boot.apiBase}/events/${encodeURIComponent(boot.eventSlug)}/proposals/proof/verify`,
        eventProposalProofVerifySchema.parse({ token: verificationToken }),
        eventProposalProofVerifyResponseSchema,
      );
      if (proof.status === "sign_in_required") {
        const loading = boot.root.querySelector<HTMLElement>("[data-speaker-loading]");
        if (loading) loading.hidden = true;
        const accountContinuation = document.createElement("div");
        accountContinuation.className = "pk-container pk-container--start";
        boot.root.prepend(accountContinuation);
        render(
          h(
            Alert,
            { tone: "warn", title: ADDRESS_IN_USE_COPY.title },
            h("p", {}, `Sign in with ${proof.email} to continue this speaker invitation using your existing account.`),
            h(
              "div",
              { class: "pk-cluster" },
              h(ButtonLink, { href: "/portal/", external: true, variant: "secondary" }, ADDRESS_IN_USE_COPY.action),
              h(Button, { type: "button", onClick: () => location.reload() }, "Continue after signing in"),
            ),
          ),
          accountContinuation,
        );
        return null;
      }
      if (proof.status !== "ready" || !proof.speakerManagementToken)
        throw new Error("We could not confirm this speaker invitation. Request a fresh link below.");
      initialProof = { token: verificationToken, result: proof };
      token = proof.speakerManagementToken;
      const destination = new URL(location.href);
      destination.searchParams.set("token", token);
      history.replaceState(history.state, "", destination.href);
    } catch (error) {
      showSpeakerManageLinkRecovery(
        boot.root,
        boot.apiBase,
        boot.eventSlug,
        error instanceof Error ? error.message : normalizeValidation(error).globalMessage,
      );
      return null;
    }
  }
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
      initialProof,
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
