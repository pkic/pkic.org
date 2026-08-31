import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { deleteJson, getJson, patchJson, postJson, requestJson } from "../shared/api-client";
import type { ProposalAccessResponse } from "../shared/types";
import { normalizeValidation } from "../shared/form/validation-map";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form/validation";
import { withLoadingButton, handleSubmitError } from "../shared/form/submit";
import { bootstrap, setStatus } from "./boot";
import {
  readField,
  setField,
  formatStatusLabel,
  statusBadgeToneClass,
  q,
  findSubmitButton,
} from "../shared/form/helpers";
import { AdminHeadshotManager } from "../shared/headshot/AdminHeadshotManager";
import { ProfileLinksInput, type ProfileLinksHandle } from "../components/ProfileLinksInput";
import { normalizeProfileLinks } from "../shared/widgets/profile-links";
import { showManageLinkRecoveryForm } from "../shared/widgets/link-recovery";
import { speakerRoleSchema, headshotUploadResponseSchema } from "../../shared/schemas/registration";
import { successResponseSchema } from "../../shared/schemas/api-common";
import {
  coSpeakerInviteResponseSchema,
  proposalAccessPatchResponseSchema,
  proposalAccessReadResponseSchema,
  proposerSpeakerPatchSchema,
  proposalSpeakerRemovalResponseSchema,
} from "../../shared/schemas/proposal-management";
import { SPEAKER_ROLE_OPTIONS } from "../shared/speaker-roles";
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

function displaySpeakerName(speaker: ProposalAccessResponse["speakers"][number]): string {
  return [speaker.firstName, speaker.lastName].filter(Boolean).join(" ") || speaker.email;
}

export function ProposalManageSpeakerCard({
  speaker,
  token,
  apiBase,
  isCurrentProposer,
  onReload,
  onStatus,
}: {
  speaker: ProposalAccessResponse["speakers"][number];
  token: string;
  apiBase: string;
  isCurrentProposer: boolean;
  onReload: () => Promise<void>;
  onStatus: (message: string, isError?: boolean) => void;
}) {
  const [firstName, setFirstName] = useState(speaker.firstName ?? "");
  const [lastName, setLastName] = useState(speaker.lastName ?? "");
  const [organizationName, setOrganizationName] = useState(speaker.organizationName ?? "");
  const [jobTitle, setJobTitle] = useState(speaker.jobTitle ?? "");
  const [biography, setBiography] = useState(speaker.bio ?? "");
  const [role, setRole] = useState(speaker.role);
  const [saving, setSaving] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [headshotStatus, setHeadshotStatus] = useState("");
  const linksRef = useRef<ProfileLinksHandle>(null);

  useEffect(() => {
    setFirstName(speaker.firstName ?? "");
    setLastName(speaker.lastName ?? "");
    setOrganizationName(speaker.organizationName ?? "");
    setJobTitle(speaker.jobTitle ?? "");
    setBiography(speaker.bio ?? "");
    setRole(speaker.role);
    setHeadshotStatus(
      speaker.headshotUpdatedAt ? `Updated: ${new Date(speaker.headshotUpdatedAt).toLocaleString("en-US")}` : "",
    );
    linksRef.current?.setLinks(normalizeProfileLinks(speaker.links));
  }, [speaker]);

  const speakerName = displaySpeakerName(speaker);
  const profileEndpoint = proposalAccessPath(apiBase, token, "speakers", speaker.userId);
  const headshotEndpoint = proposalAccessPath(apiBase, token, "speakers", speaker.userId, "headshot");

  async function saveProfile(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    try {
      await patchJson(
        profileEndpoint,
        proposerSpeakerPatchSchema.parse({
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          role,
          organizationName: organizationName.trim() || null,
          jobTitle: jobTitle.trim() || null,
          biography: biography.trim() || null,
          links: linksRef.current?.getLinks() ?? [],
        }),
        successResponseSchema,
      );
      await onReload();
      onStatus(`Saved speaker details for ${speaker.email}.`);
    } catch (error) {
      onStatus(normalizeValidation(error).globalMessage, true);
    } finally {
      setSaving(false);
    }
  }

  async function sendReminder(): Promise<void> {
    setReminding(true);
    try {
      await postJson(
        proposalAccessPath(apiBase, token, "speakers", speaker.userId, "reminders"),
        {},
        successResponseSchema,
      );
      onStatus(`${speaker.status === "invited" ? "Reminder" : "Profile link"} sent to ${speaker.email}.`);
    } catch (error) {
      onStatus(normalizeValidation(error).globalMessage, true);
    } finally {
      setReminding(false);
    }
  }

  async function removeSpeaker(): Promise<void> {
    if (!confirm(`Remove ${speakerName} from this proposal? Their user profile and proposal history will be kept.`)) {
      return;
    }
    setRemoving(true);
    try {
      await deleteJson(profileEndpoint, proposalSpeakerRemovalResponseSchema);
      await onReload();
      onStatus(`Removed ${speaker.email} from the proposal.`);
    } catch (error) {
      onStatus(normalizeValidation(error).globalMessage, true);
    } finally {
      setRemoving(false);
    }
  }

  async function uploadHeadshot(file: Blob) {
    const formData = new FormData();
    formData.append("file", file, "headshot.jpg");
    const payload = await requestJson(headshotEndpoint, headshotUploadResponseSchema, {
      method: "PUT",
      body: formData,
    });
    return { headshotUrl: payload.headshotUrl ?? null };
  }

  async function deleteHeadshot(): Promise<void> {
    await requestJson(headshotEndpoint, successResponseSchema, { method: "DELETE" });
  }

  const roleLabel = speaker.role.replace(/_/g, " ");

  return (
    <div class="pk-panel" data-speaker-card data-speaker-email={speaker.email}>
      <div class="pk-panel__body">
        <div class="pk-stack">
          <div>
            <AdminHeadshotManager
              initialUrl={speaker.headshotUrl ?? null}
              alt={speakerName}
              emptyLabel="No photo"
              statusText={headshotStatus}
              uploadLabel="Upload photo"
              deleteLabel="Remove photo"
              uploadSuccessStatus="Photo uploaded."
              deleteSuccessStatus="Photo removed."
              confirmDeleteMessage="Remove this speaker photo?"
              uploadHeadshot={uploadHeadshot}
              deleteHeadshot={deleteHeadshot}
              onUploaded={async () => {
                await onReload();
                onStatus(`Uploaded headshot for ${speaker.email}.`);
              }}
              onDeleted={async () => {
                await onReload();
                onStatus(`Removed headshot for ${speaker.email}.`);
              }}
              onError={(message) => onStatus(message, true)}
            />
          </div>

          <div class="pk-cluster">
            <strong>{speakerName}</strong>
            {speakerName !== speaker.email && <span class="pk-small">&lt;{speaker.email}&gt;</span>}
            <span class="pk-badge pk-badge--neutral">{roleLabel}</span>
            <span class={statusBadgeToneClass(speaker.status)}>{formatStatusLabel(speaker.status)}</span>
            {(speaker.status === "invited" || speaker.status === "confirmed") && (
              <button
                type="button"
                class="pk-btn pk-btn--secondary pk-btn--sm"
                disabled={reminding}
                onClick={() => void sendReminder()}
              >
                {reminding
                  ? "Sending…"
                  : speaker.status === "invited"
                    ? "Send invitation reminder"
                    : "Request speaker to review or update their profile"}
              </button>
            )}
            {!isCurrentProposer && (
              <button
                type="button"
                class="pk-btn pk-btn--danger-quiet pk-btn--sm"
                data-remove-proposal-speaker
                disabled={removing}
                onClick={() => void removeSpeaker()}
              >
                {removing ? "Removing…" : "Remove speaker"}
              </button>
            )}
          </div>

          <form class="pk-stack" onSubmit={(event) => void saveProfile(event)}>
            <div class="pk-grid">
              <div class="pk-field">
                <label class="pk-field__label" for={`speaker-first-name-${speaker.userId}`}>
                  First name
                </label>
                <input
                  id={`speaker-first-name-${speaker.userId}`}
                  class="pk-input"
                  value={firstName}
                  onInput={(event) => setFirstName((event.target as HTMLInputElement).value)}
                />
              </div>
              <div class="pk-field">
                <label class="pk-field__label" for={`speaker-last-name-${speaker.userId}`}>
                  Last name
                </label>
                <input
                  id={`speaker-last-name-${speaker.userId}`}
                  class="pk-input"
                  value={lastName}
                  onInput={(event) => setLastName((event.target as HTMLInputElement).value)}
                />
              </div>
              <div class="pk-field">
                <label class="pk-field__label" for={`speaker-role-${speaker.userId}`}>
                  Role
                </label>
                <select
                  id={`speaker-role-${speaker.userId}`}
                  class="pk-input pk-input--select"
                  value={role}
                  onChange={(event) => setRole(speakerRoleSchema.parse((event.target as HTMLSelectElement).value))}
                >
                  {SPEAKER_ROLE_OPTIONS.filter((option) => isCurrentProposer || option.value !== "proposer").map(
                    (option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div class="pk-field">
                <label class="pk-field__label" for={`speaker-organization-${speaker.userId}`}>
                  Organization
                </label>
                <input
                  id={`speaker-organization-${speaker.userId}`}
                  class="pk-input"
                  value={organizationName}
                  onInput={(event) => setOrganizationName((event.target as HTMLInputElement).value)}
                />
              </div>
              <div class="pk-field">
                <label class="pk-field__label" for={`speaker-job-title-${speaker.userId}`}>
                  Job title
                </label>
                <input
                  id={`speaker-job-title-${speaker.userId}`}
                  class="pk-input"
                  value={jobTitle}
                  onInput={(event) => setJobTitle((event.target as HTMLInputElement).value)}
                />
              </div>
            </div>
            <div class="pk-field">
              <label class="pk-field__label" for={`speaker-bio-${speaker.userId}`}>
                Biography
              </label>
              <textarea
                id={`speaker-bio-${speaker.userId}`}
                class="pk-input pk-input--textarea"
                rows={4}
                value={biography}
                onInput={(event) => setBiography((event.target as HTMLTextAreaElement).value)}
              />
              <div class="pk-field__help">Visible to attendees on the event program.</div>
            </div>
            <div>
              <ProfileLinksInput ref={linksRef} fieldName={`speaker-links-${speaker.userId}`} />
            </div>
            <div class="pk-cluster">
              <button type="submit" class="pk-btn pk-btn--primary pk-btn--sm" disabled={saving}>
                {saving ? "Saving…" : "Save speaker details"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function SpeakerList({
  speakers,
  token,
  apiBase,
  proposerUserId,
  onReload,
  onStatus,
}: {
  speakers: ProposalAccessResponse["speakers"];
  token: string;
  apiBase: string;
  proposerUserId: string;
  onReload: () => Promise<void>;
  onStatus: (message: string, isError?: boolean) => void;
}) {
  if (!speakers.length) {
    return <p class="pk-small">No speakers added yet.</p>;
  }
  return (
    <div>
      {speakers.map((speaker) => (
        <ProposalManageSpeakerCard
          key={speaker.userId}
          speaker={speaker}
          token={token}
          apiBase={apiBase}
          isCurrentProposer={speaker.userId === proposerUserId}
          onReload={onReload}
          onStatus={onStatus}
        />
      ))}
    </div>
  );
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
    boot.form.classList.add("was-validated");
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
