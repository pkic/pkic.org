import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { getJson, patchJson, postJson } from "../shared/api-client";
import type { ProposalManageResponse } from "../shared/types";
import { normalizeValidation } from "../shared/form/validation-map";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form/validation";
import { withLoadingButton, handleSubmitError } from "../shared/form/submit";
import { bootstrap, setStatus } from "./boot";
import { readField, setField, formatStatusLabel, statusBadgeClass, q, findSubmitButton } from "../shared/form/helpers";
import { AdminHeadshotManager } from "../shared/headshot/AdminHeadshotManager";
import { ProfileLinksInput, type ProfileLinksHandle } from "../components/ProfileLinksInput";

function tokenFromRoot(root: HTMLElement, fallback: string | null): string | null {
  const token = root.dataset.manageToken?.trim();
  return token || fallback;
}

function normalizeLinks(raw: ProposalManageResponse["speakers"][number]["links"]): string[] {
  return raw
    .map((value) => {
      if (typeof value === "string") return value.trim();
      if (value && typeof value === "object" && "url" in value && typeof value.url === "string") {
        return value.url.trim();
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 10);
}

function displaySpeakerName(speaker: ProposalManageResponse["speakers"][number]): string {
  return [speaker.firstName, speaker.lastName].filter(Boolean).join(" ") || speaker.email;
}

const SPEAKER_ROLES = [
  { value: "proposer", label: "Proposer" },
  { value: "speaker", label: "Speaker" },
  { value: "co_speaker", label: "Co-speaker" },
  { value: "moderator", label: "Moderator" },
  { value: "panelist", label: "Panelist" },
] as const;

function SpeakerCard({
  speaker,
  token,
  apiBase,
  onReload,
  onStatus,
}: {
  speaker: ProposalManageResponse["speakers"][number];
  token: string;
  apiBase: string;
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
      speaker.headshotUpdatedAt ? `Updated: ${new Date(speaker.headshotUpdatedAt).toLocaleString("en-GB")}` : "",
    );
    linksRef.current?.setLinks(normalizeLinks(speaker.links));
  }, [speaker]);

  const speakerName = displaySpeakerName(speaker);
  const profileEndpoint = `${apiBase}/proposals/manage/${encodeURIComponent(token)}/speakers/${encodeURIComponent(speaker.userId)}`;
  const headshotEndpoint = `${profileEndpoint}/headshot`;

  async function saveProfile(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    try {
      await patchJson(profileEndpoint, {
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        role,
        organizationName: organizationName.trim() || null,
        jobTitle: jobTitle.trim() || null,
        biography: biography.trim() || null,
        links: (linksRef.current?.getLinks() ?? []).map((url) => ({ label: url, url })),
      });
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
      await postJson(`${apiBase}/proposals/manage/${encodeURIComponent(token)}/speakers/remind`, {
        userId: speaker.userId,
      });
      onStatus(`${speaker.status === "invited" ? "Reminder" : "Profile link"} sent to ${speaker.email}.`);
    } catch (error) {
      onStatus(normalizeValidation(error).globalMessage, true);
    } finally {
      setReminding(false);
    }
  }

  async function uploadHeadshot(file: Blob) {
    const formData = new FormData();
    formData.append("file", file, "headshot.jpg");
    const response = await fetch(headshotEndpoint, {
      method: "PUT",
      body: formData,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      headshotUrl?: string;
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
    return { headshotUrl: payload.headshotUrl ?? null };
  }

  async function deleteHeadshot(): Promise<void> {
    const response = await fetch(headshotEndpoint, { method: "DELETE" });
    const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
  }

  const roleLabel = speaker.role.replace(/_/g, " ");

  return (
    <div class="card shadow-sm mb-3" data-speaker-card data-speaker-email={speaker.email}>
      <div class="card-body">
        <div class="d-flex flex-column flex-lg-row gap-3">
          <div class="flex-shrink-0">
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

          <div class="flex-fill">
            <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
              <strong>{speakerName}</strong>
              {speakerName !== speaker.email && <span class="text-muted small">&lt;{speaker.email}&gt;</span>}
              <span class="badge bg-secondary text-capitalize">{roleLabel}</span>
              <span class={`badge rounded-pill px-2 py-1 ${statusBadgeClass(speaker.status)}`}>
                {formatStatusLabel(speaker.status)}
              </span>
              {(speaker.status === "invited" || speaker.status === "confirmed") && (
                <button
                  type="button"
                  class="btn btn-outline-secondary btn-sm ms-lg-auto"
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
            </div>

            <form class="row g-3" onSubmit={(event) => void saveProfile(event)}>
              <div class="col-12 col-md-6">
                <label class="form-label" for={`speaker-first-name-${speaker.userId}`}>
                  First name
                </label>
                <input
                  id={`speaker-first-name-${speaker.userId}`}
                  class="form-control"
                  value={firstName}
                  onInput={(event) => setFirstName((event.target as HTMLInputElement).value)}
                />
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label" for={`speaker-last-name-${speaker.userId}`}>
                  Last name
                </label>
                <input
                  id={`speaker-last-name-${speaker.userId}`}
                  class="form-control"
                  value={lastName}
                  onInput={(event) => setLastName((event.target as HTMLInputElement).value)}
                />
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label" for={`speaker-role-${speaker.userId}`}>
                  Role
                </label>
                <select
                  id={`speaker-role-${speaker.userId}`}
                  class="form-select"
                  value={role}
                  onChange={(event) => setRole((event.target as HTMLSelectElement).value)}
                >
                  {SPEAKER_ROLES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label" for={`speaker-organization-${speaker.userId}`}>
                  Organization
                </label>
                <input
                  id={`speaker-organization-${speaker.userId}`}
                  class="form-control"
                  value={organizationName}
                  onInput={(event) => setOrganizationName((event.target as HTMLInputElement).value)}
                />
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label" for={`speaker-job-title-${speaker.userId}`}>
                  Job title
                </label>
                <input
                  id={`speaker-job-title-${speaker.userId}`}
                  class="form-control"
                  value={jobTitle}
                  onInput={(event) => setJobTitle((event.target as HTMLInputElement).value)}
                />
              </div>
              <div class="col-12">
                <label class="form-label" for={`speaker-bio-${speaker.userId}`}>
                  Biography
                </label>
                <textarea
                  id={`speaker-bio-${speaker.userId}`}
                  class="form-control"
                  rows={4}
                  value={biography}
                  onInput={(event) => setBiography((event.target as HTMLTextAreaElement).value)}
                />
                <div class="form-text">Visible to attendees on the event programme.</div>
              </div>
              <div class="col-12">
                <ProfileLinksInput ref={linksRef} fieldName={`speaker-links-${speaker.userId}`} max={10} />
              </div>
              <div class="col-12">
                <button type="submit" class="btn btn-success btn-sm" disabled={saving}>
                  {saving ? "Saving…" : "Save speaker details"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function SpeakerList({
  speakers,
  token,
  apiBase,
  onReload,
  onStatus,
}: {
  speakers: ProposalManageResponse["speakers"];
  token: string;
  apiBase: string;
  onReload: () => Promise<void>;
  onStatus: (message: string, isError?: boolean) => void;
}) {
  if (!speakers.length) {
    return <p class="text-muted small">No speakers added yet.</p>;
  }
  return (
    <div>
      {speakers.map((speaker) => (
        <SpeakerCard
          key={speaker.userId}
          speaker={speaker}
          token={token}
          apiBase={apiBase}
          onReload={onReload}
          onStatus={onStatus}
        />
      ))}
    </div>
  );
}

function renderSpeakerList(
  speakers: ProposalManageResponse["speakers"],
  token: string,
  apiBase: string,
  onReload: () => Promise<void>,
  onStatus: (message: string, isError?: boolean) => void,
): void {
  const list = q("[data-cospeaker-list]");
  if (!list) return;
  render(
    <SpeakerList speakers={speakers} token={token} apiBase={apiBase} onReload={onReload} onStatus={onStatus} />,
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
    setStatus(boot.statusEl, "Missing manage token.", true);
    return;
  }
  const apiBase = boot.apiBase;
  const manageToken = token;

  let proposalData: ProposalManageResponse | null;

  async function reloadSpeakers(): Promise<void> {
    const refreshed = await getJson<ProposalManageResponse>(
      `${apiBase}/proposals/manage/${encodeURIComponent(manageToken)}`,
    );
    proposalData = refreshed;
    renderSpeakerList(refreshed.speakers, manageToken, apiBase, reloadSpeakers, (message, isError) => {
      if (csStatus) {
        csStatus.textContent = message;
        csStatus.className = `mt-2 small ${isError ? "text-danger" : "text-success"}`;
      }
    });
  }

  try {
    proposalData = await getJson<ProposalManageResponse>(
      `${apiBase}/proposals/manage/${encodeURIComponent(manageToken)}`,
    );
    setField(boot.form, "proposalType", proposalData.proposal.proposal_type);
    setField(boot.form, "title", proposalData.proposal.title);
    setField(boot.form, "abstract", proposalData.proposal.abstract);
  } catch (error) {
    const normalized = normalizeValidation(error);
    setStatus(boot.statusEl, normalized.globalMessage, true);
    return;
  }

  boot.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    boot.form.classList.add("was-validated");
    if (!validateBeforeSubmit(boot.form, boot.statusEl)) return;

    await withLoadingButton(findSubmitButton(boot.form), async () => {
      try {
        const response = await patchJson<{ success: true; proposal: { status: string } }>(
          `${apiBase}/proposals/manage/${encodeURIComponent(manageToken)}`,
          {
            action: "update",
            proposalType: readField(boot.form, "proposalType"),
            title: readField(boot.form, "title"),
            abstract: readField(boot.form, "abstract"),
          },
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
      const response = await patchJson<{ success: true; proposal: { status: string } }>(
        `${apiBase}/proposals/manage/${encodeURIComponent(manageToken)}`,
        { action: "withdraw" },
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

  renderSpeakerList(proposalData.speakers, manageToken, apiBase, reloadSpeakers, (message, isError) => {
    if (csStatus) {
      csStatus.textContent = message;
      csStatus.className = `mt-2 small ${isError ? "text-danger" : "text-success"}`;
    }
  });

  inviteBtn?.addEventListener("click", async () => {
    const email = (q<HTMLInputElement>("#cs-email", boot.root)?.value ?? "").trim();
    const firstName = (q<HTMLInputElement>("#cs-first-name", boot.root)?.value ?? "").trim() || undefined;
    const lastName = (q<HTMLInputElement>("#cs-last-name", boot.root)?.value ?? "").trim() || undefined;
    const role = q<HTMLSelectElement>("#cs-role", boot.root)?.value ?? "speaker";

    if (!email) {
      if (csStatus) {
        csStatus.textContent = "Please enter an email address.";
        csStatus.className = "mt-2 small text-danger";
      }
      return;
    }

    await withLoadingButton(inviteBtn, async () => {
      try {
        await postJson(`${apiBase}/proposals/manage/${encodeURIComponent(manageToken)}/speakers`, {
          email,
          firstName,
          lastName,
          role,
        });
        if (csStatus) {
          csStatus.textContent = `Invite sent to ${email}.`;
          csStatus.className = "mt-2 small text-success";
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
        if (csStatus) {
          csStatus.textContent = normalized.globalMessage;
          csStatus.className = "mt-2 small text-danger";
        }
      }
    });
  });
}

void main();
