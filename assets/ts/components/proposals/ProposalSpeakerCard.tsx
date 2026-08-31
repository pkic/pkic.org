import { useEffect, useRef, useState } from "preact/hooks";
import { speakerRoleSchema } from "../../../shared/schemas/registration";
import { isEligibleReplacementProposerStatus } from "../../../shared/schemas/proposal-status";
import { proposalSpeakerPatchResponseSchema, type ProposalSpeaker } from "../../../shared/schemas/proposal-speakers";
import { proposalSpeakerRemovalResponseSchema } from "../../../shared/schemas/proposal-management";
import { successResponseSchema } from "../../../shared/schemas/api-common";
import { Badge } from "../Badge";
import { confirmAction } from "../ConfirmDialog";
import { ProfileLinksInput, type ProfileLinksHandle } from "../ProfileLinksInput";
import { normalizeProfileLinks } from "../../shared/widgets/profile-links";
import { requestJson } from "../../shared/api-client";
import { formatDateTime, type ToastType } from "../../shared/ui";
import { ProposalSpeakerHeadshotManager } from "./ProposalSpeakerHeadshotManager";

export type { ProposalSpeaker };

export function buildReplacementProposerOptions(speakers: ProposalSpeaker[], removedUserId: string) {
  return speakers
    .filter((candidate) => candidate.userId !== removedUserId && isEligibleReplacementProposerStatus(candidate.status))
    .map((candidate) => ({
      userId: candidate.userId,
      label: [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || candidate.email,
    }));
}

export interface ProposalSpeakerEndpointConfig {
  speakerPath: (proposalId: string, userId: string, suffix?: string) => string;
  assetPath: (proposalId: string, userId: string, asset: "headshot" | "gravatar") => string;
  reminderPath?: (proposalId: string, userId: string, kind: "profile" | "presentation") => string;
  reminderBody?: (kind: "profile" | "presentation") => unknown;
  gravatarBody?: unknown;
}

export function ProposalSpeakerCard({
  speaker,
  proposalId,
  canEdit,
  canFinalize,
  decisionStatus,
  requiresPresentation,
  isCurrentProposer,
  replacementSpeakers,
  endpoints,
  onSaved,
  onRemoved,
  notify,
}: {
  speaker: ProposalSpeaker;
  proposalId: string;
  canEdit: boolean;
  canFinalize?: boolean;
  decisionStatus?: string | null;
  requiresPresentation?: boolean;
  isCurrentProposer: boolean;
  replacementSpeakers: Array<{ userId: string; label: string }>;
  endpoints: ProposalSpeakerEndpointConfig;
  onSaved: (userId: string, patch: Partial<ProposalSpeaker>) => void;
  onRemoved: () => void;
  notify?: (message: string, type: ToastType) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(speaker.firstName ?? "");
  const [lastName, setLastName] = useState(speaker.lastName ?? "");
  const [organizationName, setOrganizationName] = useState(speaker.organizationName ?? "");
  const [jobTitle, setJobTitle] = useState(speaker.jobTitle ?? "");
  const [bio, setBio] = useState(speaker.biography ?? "");
  const [role, setRole] = useState(speaker.role);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [replacementProposerUserId, setReplacementProposerUserId] = useState("");
  const linksRef = useRef<ProfileLinksHandle>(null);
  const name = [speaker.firstName, speaker.lastName].filter(Boolean).join(" ") || speaker.email;
  const speakerPath = (suffix = "") => endpoints.speakerPath(proposalId, speaker.userId, suffix);

  useEffect(() => {
    setRole(speaker.role);
    setFirstName(speaker.firstName ?? "");
    setLastName(speaker.lastName ?? "");
    setOrganizationName(speaker.organizationName ?? "");
    setJobTitle(speaker.jobTitle ?? "");
    setBio(speaker.biography ?? "");
    setReplacementProposerUserId("");
    linksRef.current?.setLinks(normalizeProfileLinks(speaker.links));
  }, [speaker]);

  useEffect(() => {
    if (editing) linksRef.current?.setLinks(normalizeProfileLinks(speaker.links));
  }, [editing, speaker.links]);

  async function handleSave(event: Event) {
    event.preventDefault();
    setSaving(true);
    try {
      const links = linksRef.current?.getLinks() ?? [];
      const patch = {
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        organizationName: organizationName.trim() || null,
        jobTitle: jobTitle.trim() || null,
        biography: bio.trim() || null,
        links,
        role,
      };
      await requestJson(speakerPath(), proposalSpeakerPatchResponseSchema, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      onSaved(speaker.userId, { ...patch, hasBio: Boolean(bio.trim()) });
      setEditing(false);
      notify?.("Speaker profile updated", "success");
    } catch (caught) {
      notify?.((caught as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function sendReminder(kind: "profile" | "presentation") {
    try {
      const reminderBody = endpoints.reminderBody?.(kind);
      await requestJson(
        endpoints.reminderPath?.(proposalId, speaker.userId, kind) ??
          speakerPath(kind === "profile" ? "remind" : "remind-presentation"),
        successResponseSchema,
        {
          method: "POST",
          ...(reminderBody === undefined ? {} : { body: JSON.stringify(reminderBody) }),
        },
      );
      notify?.(`${kind === "profile" ? "Profile" : "Presentation"} reminder sent`, "success");
    } catch (caught) {
      notify?.((caught as Error).message, "error");
    }
  }

  async function removeSpeaker() {
    const confirmed = await confirmAction({
      title: `Remove ${name} from this proposal?`,
      consequences: [
        "The user profile and audit history are kept",
        ...(isCurrentProposer ? ["Proposal ownership transfers to the selected replacement"] : []),
      ],
      confirmLabel: "Remove speaker",
      tone: "danger",
    });
    if (!confirmed) return;
    setRemoving(true);
    try {
      await requestJson(speakerPath(), proposalSpeakerRemovalResponseSchema, {
        method: "DELETE",
        body: JSON.stringify({ replacementProposerUserId: isCurrentProposer ? replacementProposerUserId : undefined }),
      });
      notify?.("Speaker removed", "success");
      onRemoved();
    } catch (caught) {
      notify?.((caught as Error).message, "error");
    } finally {
      setRemoving(false);
    }
  }

  const profileLinks = normalizeProfileLinks(speaker.links);
  return (
    <div class="card mb-3">
      <div class="card-body">
        <div class="d-flex gap-3 align-items-start">
          <div class="flex-shrink-0">
            <ProposalSpeakerHeadshotManager
              speaker={speaker}
              proposalId={proposalId}
              name={name}
              canEdit={canEdit}
              assetPath={endpoints.assetPath}
              gravatarBody={endpoints.gravatarBody}
              onSaved={onSaved}
              notify={notify}
            />
          </div>
          <div class="flex-fill min-w-0">
            <div class="d-flex gap-2 align-items-center flex-wrap mb-1">
              <strong>{name}</strong>
              {name !== speaker.email && <span class="text-muted small">{speaker.email}</span>}
              <Badge status={speaker.role} />
              <Badge status={speaker.status} />
            </div>
            {(speaker.organizationName || speaker.jobTitle) && (
              <div class="small text-muted mb-1">
                {[speaker.jobTitle, speaker.organizationName].filter(Boolean).join(" · ")}
              </div>
            )}
            <div class="d-flex gap-2 flex-wrap">
              {speaker.confirmedAt && (
                <span class="small text-success">✓ Confirmed {formatDateTime(speaker.confirmedAt)}</span>
              )}
              {speaker.declinedAt && (
                <span class="small text-danger">✗ Declined {formatDateTime(speaker.declinedAt)}</span>
              )}
              {speaker.status === "invited" && speaker.inviteExpiresAt && (
                <span class="small text-muted">Invitation expires {formatDateTime(speaker.inviteExpiresAt)}</span>
              )}
            </div>
            {speaker.declineReason && <div class="small text-muted mt-1">Decline reason: {speaker.declineReason}</div>}
            {!editing && speaker.biography && (
              <p class="small text-muted mt-2 mb-0 adm-pre-wrap">{speaker.biography}</p>
            )}
            {!editing && profileLinks.length > 0 && (
              <div class="small mt-2 d-flex flex-column gap-1">
                {profileLinks.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                ))}
              </div>
            )}
          </div>
          <div class="flex-shrink-0 d-flex flex-column gap-1 align-items-end">
            {!speaker.hasBio && <span class="badge text-bg-warning">No bio</span>}
            {!speaker.hasHeadshot && <span class="badge text-bg-warning">No headshot</span>}
            {canEdit && (
              <button class="btn btn-sm btn-outline-secondary" onClick={() => setEditing((current) => !current)}>
                {editing ? "Cancel" : "Edit profile"}
              </button>
            )}
            {canFinalize && (
              <button
                class="btn btn-sm btn-outline-secondary"
                title="Send profile completion reminder"
                onClick={() => void sendReminder("profile")}
              >
                ✉ Profile reminder
              </button>
            )}
            {canFinalize && requiresPresentation && decisionStatus === "accepted" && (
              <button
                class="btn btn-sm btn-outline-secondary"
                title="Send presentation upload reminder"
                onClick={() => void sendReminder("presentation")}
              >
                ✉ Presentation reminder
              </button>
            )}
            {canFinalize && replacementSpeakers.length > 0 && (
              <>
                {isCurrentProposer && (
                  <select
                    class="form-select form-select-sm"
                    data-replacement-proposer
                    aria-label="Replacement proposer"
                    value={replacementProposerUserId}
                    onChange={(event) => setReplacementProposerUserId((event.target as HTMLSelectElement).value)}
                  >
                    <option value="">Choose replacement proposer…</option>
                    {replacementSpeakers.map((replacement) => (
                      <option key={replacement.userId} value={replacement.userId}>
                        {replacement.label}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  class="btn btn-sm btn-outline-danger"
                  data-remove-proposal-speaker
                  disabled={removing || (isCurrentProposer && !replacementProposerUserId)}
                  onClick={() => void removeSpeaker()}
                >
                  {removing ? "Removing…" : "Remove speaker"}
                </button>
              </>
            )}
            {canFinalize && replacementSpeakers.length === 0 && (
              <span class="small text-muted text-end">
                Add an invited or confirmed replacement speaker. Otherwise, ask the proposer to use the separate
                Withdraw proposal action; every proposal must retain its speaker roster.
              </span>
            )}
          </div>
        </div>
        {editing && (
          <form onSubmit={(event) => void handleSave(event)} class="mt-3 border-top pt-3">
            <div class="row g-3">
              <div class="col-sm-6">
                <label class="form-label fw-semibold">First name</label>
                <input
                  class="form-control"
                  value={firstName}
                  onInput={(event) => setFirstName((event.target as HTMLInputElement).value)}
                />
              </div>
              <div class="col-sm-6">
                <label class="form-label fw-semibold">Last name</label>
                <input
                  class="form-control"
                  value={lastName}
                  onInput={(event) => setLastName((event.target as HTMLInputElement).value)}
                />
              </div>
              <div class="col-sm-6">
                <label class="form-label fw-semibold">Organization</label>
                <input
                  class="form-control"
                  value={organizationName}
                  onInput={(event) => setOrganizationName((event.target as HTMLInputElement).value)}
                />
              </div>
              <div class="col-sm-6">
                <label class="form-label fw-semibold">Job title</label>
                <input
                  class="form-control"
                  value={jobTitle}
                  onInput={(event) => setJobTitle((event.target as HTMLInputElement).value)}
                />
              </div>
              <div class="col-12">
                <label class="form-label fw-semibold">Role</label>
                <select
                  class="form-select"
                  value={role}
                  onChange={(event) => setRole(speakerRoleSchema.parse((event.target as HTMLSelectElement).value))}
                >
                  {isCurrentProposer ? (
                    <option value="proposer">Proposer</option>
                  ) : (
                    <>
                      <option value="speaker">Speaker</option>
                      <option value="co_speaker">Co-speaker</option>
                      <option value="moderator">Moderator</option>
                      <option value="panelist">Panelist</option>
                    </>
                  )}
                </select>
              </div>
              <div class="col-12">
                <label class="form-label fw-semibold">Biography</label>
                <textarea
                  class="form-control"
                  rows={4}
                  value={bio}
                  onInput={(event) => setBio((event.target as HTMLTextAreaElement).value)}
                  placeholder="Speaker biography…"
                />
              </div>
              <div class="col-12">
                <label class="form-label fw-semibold">Profile links</label>
                <ProfileLinksInput ref={linksRef} fieldName={`speakerProfileLink.${speaker.userId}`} />
              </div>
              <div class="col-12">
                <button type="submit" class="btn btn-primary" disabled={saving}>
                  {saving ? "Saving…" : "Save profile"}
                </button>
                <button type="button" class="btn btn-outline-secondary ms-2" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
