import { useEffect, useId, useRef, useState } from "preact/hooks";
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
import { Badge as ToneBadge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Panel, PanelBody } from "../../ui/Panel";
import { Select, Textarea, TextInput } from "../../ui/TextControl";
import { ProposalSpeakerHeadshotManager } from "./ProposalSpeakerHeadshotManager";
// `pk-answer-pre` is written here as a class name rather than reached through a
// component, so this module has to pull its stylesheet into its own chunk.
import "../../ui/Content.css";

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
  // ProfileLinksInput labels its own controls, so the group takes its name from
  // the visible heading rather than a `for`/`id` pair pointing at nothing.
  const linksLabelId = `${useId()}-profile-links`;
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
    <div class="pk">
      <Panel>
        <PanelBody class="pk-stack pk-stack--snug">
          <div class="pk-cluster pk-cluster--start">
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
            <div class="pk-stack pk-stack--tight">
              <div class="pk-cluster">
                <strong>{name}</strong>
                {name !== speaker.email && <span class="pk-small">{speaker.email}</span>}
                <Badge status={speaker.role} />
                <Badge status={speaker.status} />
              </div>
              {(speaker.organizationName || speaker.jobTitle) && (
                <div class="pk-small">{[speaker.jobTitle, speaker.organizationName].filter(Boolean).join(" · ")}</div>
              )}
              {/* The lifecycle badge beside the name already carries the state
                  and its tone; these lines only say when it happened, so they
                  stay plain text instead of repeating the colour. */}
              <div class="pk-cluster">
                {speaker.confirmedAt && <span class="pk-small">Confirmed {formatDateTime(speaker.confirmedAt)}</span>}
                {speaker.declinedAt && <span class="pk-small">Declined {formatDateTime(speaker.declinedAt)}</span>}
                {speaker.status === "invited" && speaker.inviteExpiresAt && (
                  <span class="pk-small">Invitation expires {formatDateTime(speaker.inviteExpiresAt)}</span>
                )}
              </div>
              {speaker.declineReason && <div class="pk-small">Decline reason: {speaker.declineReason}</div>}
            </div>
            <div class="pk-cluster pk-cluster--end pk-push">
              {!speaker.hasBio && <ToneBadge tone="warn">No bio</ToneBadge>}
              {!speaker.hasHeadshot && <ToneBadge tone="warn">No headshot</ToneBadge>}
              {canEdit && (
                <Button size="sm" onClick={() => setEditing((current) => !current)}>
                  {editing ? "Cancel" : "Edit profile"}
                </Button>
              )}
              {canFinalize && (
                <Button size="sm" title="Send profile completion reminder" onClick={() => void sendReminder("profile")}>
                  ✉ Profile reminder
                </Button>
              )}
              {canFinalize && requiresPresentation && decisionStatus === "accepted" && (
                <Button
                  size="sm"
                  title="Send presentation upload reminder"
                  onClick={() => void sendReminder("presentation")}
                >
                  ✉ Presentation reminder
                </Button>
              )}
              {canFinalize && replacementSpeakers.length > 0 && (
                <>
                  {isCurrentProposer && (
                    <Select
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
                    </Select>
                  )}
                  <Button
                    size="sm"
                    variant="danger-quiet"
                    data-remove-proposal-speaker
                    disabled={removing || (isCurrentProposer && !replacementProposerUserId)}
                    onClick={() => void removeSpeaker()}
                  >
                    {removing ? "Removing…" : "Remove speaker"}
                  </Button>
                </>
              )}
              {canFinalize && replacementSpeakers.length === 0 && (
                <span class="pk-small">
                  Add an invited or confirmed replacement speaker. Otherwise, ask the proposer to use the separate
                  Withdraw proposal action; every proposal must retain its speaker roster.
                </span>
              )}
            </div>
          </div>
          {!editing && speaker.biography && <p class="pk-small pk-answer-pre">{speaker.biography}</p>}
          {!editing && profileLinks.length > 0 && (
            <div class="pk-stack pk-stack--tight pk-small">
              {profileLinks.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
              ))}
            </div>
          )}
          {editing && (
            <form onSubmit={(event) => void handleSave(event)} class="pk-stack">
              <div class="pk-grid pk-grid--tight">
                <Field label="First name">
                  {(control) => (
                    <TextInput
                      {...control}
                      value={firstName}
                      onInput={(event) => setFirstName((event.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <Field label="Last name">
                  {(control) => (
                    <TextInput
                      {...control}
                      value={lastName}
                      onInput={(event) => setLastName((event.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <Field label="Organization">
                  {(control) => (
                    <TextInput
                      {...control}
                      value={organizationName}
                      onInput={(event) => setOrganizationName((event.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <Field label="Job title">
                  {(control) => (
                    <TextInput
                      {...control}
                      value={jobTitle}
                      onInput={(event) => setJobTitle((event.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
              </div>
              <Field label="Role">
                {(control) => (
                  <Select
                    {...control}
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
                  </Select>
                )}
              </Field>
              <Field label="Biography">
                {(control) => (
                  <Textarea
                    {...control}
                    rows={4}
                    value={bio}
                    onInput={(event) => setBio((event.target as HTMLTextAreaElement).value)}
                    placeholder="Speaker biography…"
                  />
                )}
              </Field>
              <div class="pk-stack pk-stack--tight">
                <span class="pk-strong" id={linksLabelId}>
                  Profile links
                </span>
                <div role="group" aria-labelledby={linksLabelId}>
                  <ProfileLinksInput ref={linksRef} fieldName={`speakerProfileLink.${speaker.userId}`} />
                </div>
              </div>
              <div class="pk-cluster">
                <Button type="submit" variant="primary" loading={saving}>
                  {saving ? "Saving…" : "Save profile"}
                </Button>
                <Button type="button" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
