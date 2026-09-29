import { SpeakerList } from "../components/proposals/ProposerSpeakerList";
import { mountMarkdownField } from "../components/markdown-editor/mount-markdown-field";
import { render } from "preact";
import { getJson, patchJson, postJson } from "../shared/api-client";
import type { ProposalAccessResponse } from "../shared/types";
import { normalizeValidation } from "../shared/form/validation-map";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form/validation";
import { withLoadingButton, handleSubmitError } from "../shared/form/submit";
import { bootstrap, setStatus } from "./boot";
import { readField, setField, q, findSubmitButton } from "../shared/form/helpers";
import { showManageLinkRecoveryForm } from "../shared/widgets/link-recovery";
import {
  coSpeakerInviteResponseSchema,
  proposalAccessPatchResponseSchema,
  proposalAccessPatchSchema,
  proposalAccessReadResponseSchema,
} from "../../shared/schemas/proposal-management";
import { proposalAccessPath } from "../../shared/proposal-access-paths";

function tokenFromRoot(root: HTMLElement, fallback: string | null): string | null {
  const token = root.dataset.manageToken?.trim();
  return token || fallback;
}

function showResendProposalManageLinkForm(
  root: HTMLElement,
  apiBase: string,
  eventSlug: string,
  introMessage: string,
): void {
  const content = root.querySelector<HTMLElement>("[data-proposal-manage-content]");
  if (content) content.hidden = true;
  showManageLinkRecoveryForm({
    root,
    loadingSelector: "[data-proposal-manage-loading]",
    sectionSelector: "[data-resend-proposal-manage-section]",
    buttonSelector: "[data-resend-proposal-manage-btn]",
    statusSelector: "[data-resend-proposal-manage-status]",
    emailSelector: "[data-resend-proposal-manage-email]",
    endpoint: `${apiBase}/events/${eventSlug}/proposals/resend-manage-link`,
    successMessage:
      "If the details match an active proposal, you will receive an email shortly. Please check your inbox (and spam folder).",
    introMessage,
  });
}

function renderSpeakerList(
  speakers: ProposalAccessResponse["speakers"],
  token: string,
  apiBase: string,
  proposerUserId: string,
  onReload: () => Promise<void>,
  onStatus: (message: string, isError?: boolean) => void,
): void {
  const list = q("[data-cospeaker-list]");
  if (!list) return;
  render(
    <SpeakerList
      speakers={speakers}
      token={token}
      apiBase={apiBase}
      proposerUserId={proposerUserId}
      onReload={onReload}
      onStatus={onStatus}
    />,
    list as HTMLElement,
  );
}

async function main(): Promise<void> {
  const boot = bootstrap("[data-event-proposal-manage]");
  if (!boot) {
    return;
  }
  installLiveValidation(boot.form, boot.statusEl);

  const token = tokenFromRoot(boot.root, boot.query.token);
  if (!token) {
    showResendProposalManageLinkForm(
      boot.root,
      boot.apiBase,
      boot.eventSlug,
      "Missing proposal management token. Request a fresh link below.",
    );
    return;
  }
  const apiBase = boot.apiBase;
  const manageToken = token;

  let proposalData: ProposalAccessResponse | null;

  async function reloadSpeakers(): Promise<void> {
    const refreshed = await getJson(proposalAccessPath(apiBase, manageToken), proposalAccessReadResponseSchema);
    proposalData = refreshed;
    renderSpeakerList(
      refreshed.speakers,
      manageToken,
      apiBase,
      refreshed.proposal.proposer_user_id,
      reloadSpeakers,
      (message, isError) => {
        if (csStatus) setStatus(csStatus, message, isError);
      },
    );
  }

  try {
    proposalData = await getJson(proposalAccessPath(apiBase, manageToken), proposalAccessReadResponseSchema);
    setField(boot.form, "proposalType", proposalData.proposal.proposal_type);
    setField(boot.form, "title", proposalData.proposal.title);
    setField(boot.form, "abstract", proposalData.proposal.abstract);
    await mountMarkdownField(
      boot.form.querySelector<HTMLTextAreaElement>("#manage-proposal-abstract"),
      "Abstract",
      proposalAccessPatchSchema.shape.abstract,
    );
  } catch (error) {
    const normalized = normalizeValidation(error);
    showResendProposalManageLinkForm(
      boot.root,
      boot.apiBase,
      boot.eventSlug,
      `${normalized.globalMessage} You can request a fresh link below.`,
    );
    return;
  }

  const loadingEl = boot.root.querySelector<HTMLElement>("[data-proposal-manage-loading]");
  if (loadingEl) loadingEl.hidden = true;
  const contentEl = boot.root.querySelector<HTMLElement>("[data-proposal-manage-content]");
  if (contentEl) contentEl.hidden = false;

  boot.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    // `was-validated` is not set here any more: `validateBeforeSubmit` adds it
    // in the one case it means anything — a submission that failed — and
    // setting it up front marked a form the reader had not got wrong yet.
    if (!validateBeforeSubmit(boot.form, boot.statusEl)) return;

    await withLoadingButton(findSubmitButton(boot.form), async () => {
      try {
        const response = await patchJson(
          proposalAccessPath(apiBase, manageToken),
          {
            proposalType: readField(boot.form, "proposalType"),
            title: readField(boot.form, "title"),
            abstract: readField(boot.form, "abstract"),
          },
          proposalAccessPatchResponseSchema,
        );
        setStatus(boot.statusEl, `Proposal updated. Current status: '${response.proposal.status}'.`);
      } catch (error) {
        handleSubmitError(error, boot.form, boot.statusEl);
      }
    });
  });

  const withdrawButton = boot.form.querySelector<HTMLButtonElement>("[data-action='withdraw']");
  withdrawButton?.addEventListener("click", async () => {
    try {
      const response = await patchJson(
        proposalAccessPath(apiBase, manageToken),
        { status: "withdrawn" },
        proposalAccessPatchResponseSchema,
      );
      setStatus(boot.statusEl, `Proposal updated. Current status: '${response.proposal.status}'.`);
    } catch (error) {
      const normalized = normalizeValidation(error);
      setStatus(boot.statusEl, normalized.globalMessage, true);
    }
  });

  // Co-speaker invite
  const inviteBtn = q<HTMLButtonElement>("[data-cospeaker-invite-btn]", boot.root);
  const csStatus = q<HTMLElement>("[data-cospeaker-status]", boot.root);

  renderSpeakerList(
    proposalData.speakers,
    manageToken,
    apiBase,
    proposalData.proposal.proposer_user_id,
    reloadSpeakers,
    (message, isError) => {
      if (csStatus) setStatus(csStatus, message, isError);
    },
  );

  inviteBtn?.addEventListener("click", async () => {
    const email = (q<HTMLInputElement>("#cs-email", boot.root)?.value ?? "").trim();
    const firstName = (q<HTMLInputElement>("#cs-first-name", boot.root)?.value ?? "").trim() || undefined;
    const lastName = (q<HTMLInputElement>("#cs-last-name", boot.root)?.value ?? "").trim() || undefined;
    const role = q<HTMLSelectElement>("#cs-role", boot.root)?.value ?? "speaker";

    if (!email) {
      if (csStatus) setStatus(csStatus, "Please enter an email address.", true);
      return;
    }

    await withLoadingButton(inviteBtn, async () => {
      try {
        const invited = await postJson(
          proposalAccessPath(apiBase, manageToken, "speakers"),
          { email, firstName, lastName, role },
          coSpeakerInviteResponseSchema,
        );
        if (csStatus) {
          setStatus(csStatus, invited.queued ? `Invite sent to ${email}.` : `${email} already has an active invite.`);
        }
        const emailEl = q<HTMLInputElement>("#cs-email", boot.root);
        const firstEl = q<HTMLInputElement>("#cs-first-name", boot.root);
        const lastEl = q<HTMLInputElement>("#cs-last-name", boot.root);
        if (emailEl) emailEl.value = "";
        if (firstEl) firstEl.value = "";
        if (lastEl) lastEl.value = "";
        await reloadSpeakers();
      } catch (error) {
        const normalized = normalizeValidation(error);
        if (csStatus) setStatus(csStatus, normalized.globalMessage, true);
      }
    });
  });
}

void main();
