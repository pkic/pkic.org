import { useEffect, useRef, useState } from "preact/hooks";
import { speakerRoleSchema } from "../../../../../../shared/schemas/registration";
import { isEligibleReplacementProposerStatus } from "../../../../../../shared/schemas/proposal-status";
import { Badge } from "../../../../../components/Badge";
import { ProfileLinksInput, type ProfileLinksHandle } from "../../../../../components/ProfileLinksInput";
import { normalizeProfileLinks } from "../../../../../shared/widgets/profile-links";
import { api } from "../../../../api";
import type { ProposalSpeaker } from "../../../../types";
import { fmt, toast } from "../../../../ui";
import { ProposalSpeakerHeadshotManager } from "./ProposalSpeakerHeadshotManager";

export function buildReplacementProposerOptions(
  speakers: ProposalSpeaker[],
  removedUserId: string,
): Array<{ userId: string; label: string }> {
  return speakers
    .filter((candidate) => candidate.userId !== removedUserId && isEligibleReplacementProposerStatus(candidate.status))
    .map((candidate) => ({
      userId: candidate.userId,
      label: [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || candidate.email,
    }));
}

export function SpeakerCard({
  speaker,
  proposalId,
  canEdit,
  canFinalize,
  decisionStatus,
  requiresPresentation,
  isCurrentProposer,
  replacementSpeakers,
  onSaved,
  onRemoved,
}: {
  speaker: ProposalSpeaker;
  proposalId: string;
  canEdit: boolean;
  canFinalize?: boolean;
  decisionStatus?: string | null;
  requiresPresentation?: boolean;
  isCurrentProposer: boolean;
  replacementSpeakers: Array<{ userId: string; label: string }>;
  onSaved: (userId: string, patch: Partial<ProposalSpeaker>) => void;
  onRemoved: () => void;
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
      await api(`/api/v1/admin/proposals/${proposalId}/speakers/${speaker.userId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      onSaved(speaker.userId, { ...patch, hasBio: Boolean(bio.trim()) });
      setEditing(false);
      toast("Speaker profile updated", "success");
    } catch (caught) {
      toast((caught as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function sendReminder(kind: "profile" | "presentation") {
    const suffix = kind === "profile" ? "remind" : "remind-presentation";
    try {
      await api(`/api/v1/admin/proposals/${proposalId}/speakers/${speaker.userId}/${suffix}`, { method: "POST" });
      toast(`${kind === "profile" ? "Profile" : "Presentation"} reminder sent`, "success");
    } catch (caught) {
      toast((caught as Error).message, "error");
    }
  }

  async function removeSpeaker() {
    if (
      !confirm(
        `Remove ${name} from this proposal? The user profile and audit history will be kept.${isCurrentProposer ? " Proposal ownership will transfer to the selected replacement." : ""}`,
      )
    ) {
      return;
    }
    setRemoving(true);
    try {
      await api(`/api/v1/admin/proposals/${proposalId}/speakers/${speaker.userId}`, {
        method: "DELETE",
        body: JSON.stringify({
          replacementProposerUserId: isCurrentProposer ? replacementProposerUserId : undefined,
        }),
      });
      toast("Speaker removed", "success");
      onRemoved();
    } catch (caught) {
      toast((caught as Error).message, "error");
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
              onSaved={onSaved}
            />
          </div>

          <div class="flex-fill min-w-0">
            <div class="d-flex gap-2 align-items-center flex-wrap mb-1">
              <strong>{name}</strong>
              {name !== speaker.email && <span class="text-muted small">{speaker.email}</span>}
              <span class="badge text-bg-secondary text-capitalize">{speaker.role.replace(/_/g, " ")}</span>
              <Badge status={speaker.status} />
            </div>
            {(speaker.organizationName || speaker.jobTitle) && (
              <div class="small text-muted mb-1">
                {[speaker.jobTitle, speaker.organizationName].filter(Boolean).join(" · ")}
              </div>
            )}
            <div class="d-flex gap-2 flex-wrap">
              {speaker.confirmedAt && <span class="small text-success">✓ Confirmed {fmt(speaker.confirmedAt)}</span>}
              {speaker.declinedAt && <span class="small text-danger">✗ Declined {fmt(speaker.declinedAt)}</span>}
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
                <ProfileLinksInput ref={linksRef} fieldName={`speakerProfileLink.${speaker.userId}`} max={15} />
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
