import { useEffect, useRef, useState } from "preact/hooks";
import { speakerRoleSchema } from "../../../../../../shared/schemas/registration";
import { Badge } from "../../../../../components/Badge";
import { ProfileLinksInput, type ProfileLinksHandle } from "../../../../../components/ProfileLinksInput";
import { AdminHeadshotManager, ADMIN_HEADSHOT_DISCLAIMER } from "../../../../../shared/headshot/AdminHeadshotManager";
import { normalizeProfileLinks } from "../../../../../shared/widgets/profile-links";
import { api } from "../../../../api";
import type { ProposalSpeaker } from "../../../../types";
import { fmt, toast } from "../../../../ui";

export function SpeakerCard({
  speaker,
  proposalId,
  canEdit,
  canFinalize,
  decisionStatus,
  requiresPresentation,
  onSaved,
}: {
  speaker: ProposalSpeaker;
  proposalId: string;
  canEdit: boolean;
  canFinalize?: boolean;
  decisionStatus?: string | null;
  requiresPresentation?: boolean;
  onSaved: (userId: string, patch: Partial<ProposalSpeaker>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(speaker.firstName ?? "");
  const [lastName, setLastName] = useState(speaker.lastName ?? "");
  const [organizationName, setOrganizationName] = useState(speaker.organizationName ?? "");
  const [jobTitle, setJobTitle] = useState(speaker.jobTitle ?? "");
  const [bio, setBio] = useState(speaker.biography ?? "");
  const [role, setRole] = useState(speaker.role);
  const [saving, setSaving] = useState(false);
  const [headshotStatus, setHeadshotStatus] = useState("");
  const linksRef = useRef<ProfileLinksHandle>(null);

  const name = [speaker.firstName, speaker.lastName].filter(Boolean).join(" ") || speaker.email;

  useEffect(() => {
    setHeadshotStatus("");
    setRole(speaker.role);
    setFirstName(speaker.firstName ?? "");
    setLastName(speaker.lastName ?? "");
    setOrganizationName(speaker.organizationName ?? "");
    setJobTitle(speaker.jobTitle ?? "");
    setBio(speaker.biography ?? "");
    linksRef.current?.setLinks(normalizeProfileLinks(speaker.links));
  }, [speaker]);

  useEffect(() => {
    if (editing) linksRef.current?.setLinks(normalizeProfileLinks(speaker.links));
  }, [editing, speaker.links]);

  async function uploadHeadshotFile(file: Blob) {
    const response = await fetch(`/api/v1/admin/users/${speaker.userId}/headshot`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": file.type || "image/jpeg" },
      body: file,
    });
    const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);

    const userData = await api<{ user: { headshotUrl: string | null } }>(`/api/v1/admin/users/${speaker.userId}`);
    return { headshotUrl: userData.user.headshotUrl ?? null };
  }

  async function fetchGravatar() {
    setHeadshotStatus("Looking up Gravatar...");
    try {
      await api(`/api/v1/admin/users/${speaker.userId}/gravatar`, { method: "POST" });
      const userData = await api<{ user: { headshotUrl: string | null } }>(`/api/v1/admin/users/${speaker.userId}`);
      toast("Gravatar imported successfully", "success");
      onSaved(speaker.userId, {
        headshotUrl: userData.user.headshotUrl,
        hasHeadshot: Boolean(userData.user.headshotUrl),
      });
      setHeadshotStatus("Gravatar imported");
    } catch (caught) {
      const message = (caught as Error).message;
      toast(message, "error");
      setHeadshotStatus(`Error: ${message}`);
    }
  }

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

  const profileLinks = normalizeProfileLinks(speaker.links);

  return (
    <div class="card mb-3">
      <div class="card-body">
        <div class="d-flex gap-3 align-items-start">
          <div class="flex-shrink-0">
            <AdminHeadshotManager
              initialUrl={speaker.headshotUrl ?? null}
              alt={name}
              emptyLabel="User"
              statusText={headshotStatus}
              uploadHeadshot={uploadHeadshotFile}
              deleteHeadshot={() => api(`/api/v1/admin/users/${speaker.userId}/headshot`, { method: "DELETE" })}
              onFetchGravatar={fetchGravatar}
              disclaimerTexts={ADMIN_HEADSHOT_DISCLAIMER}
              onUploaded={(headshotUrl) => {
                onSaved(speaker.userId, { headshotUrl: headshotUrl ?? null, hasHeadshot: Boolean(headshotUrl) });
                toast("Headshot uploaded", "success");
              }}
              onDeleted={() => {
                onSaved(speaker.userId, { headshotUrl: null, hasHeadshot: false });
                toast("Headshot removed", "success");
              }}
              onError={(message) => toast(message, "error")}
              confirmDeleteMessage="Remove this user's headshot?"
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
                  <option value="proposer">Proposer</option>
                  <option value="speaker">Speaker</option>
                  <option value="co_speaker">Co-speaker</option>
                  <option value="moderator">Moderator</option>
                  <option value="panelist">Panelist</option>
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
