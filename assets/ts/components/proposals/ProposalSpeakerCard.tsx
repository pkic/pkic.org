/**
 * One speaker on a proposal: who they are, where they stand, and what an
 * operator can do about it.
 *
 * The card reads like every other record card in the portal. The photo is the
 * same `PictureTile` a user's portrait uses — the picture is the control, the
 * remove sits in its corner — rather than a column of three buttons under a
 * placeholder. The commands live behind one `…` menu at the card's top right;
 * they used to be a row of five buttons and a select beside the name, which
 * made a list of speakers read as a list of things to click. Editing turns
 * the card's values into inputs in place, behind that menu, never on arrival.
 */
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { speakerRoleSchema } from "../../../shared/schemas/registration";
import { isEligibleReplacementProposerStatus } from "../../../shared/schemas/proposal-status";
import { proposalSpeakerPatchResponseSchema, type ProposalSpeaker } from "../../../shared/schemas/proposal-speakers";
import { proposalSpeakerRemovalResponseSchema } from "../../../shared/schemas/proposal-management";
import { headshotUrlResponseSchema } from "../../../shared/schemas/registration";
import { successResponseSchema } from "../../../shared/schemas/api-common";
import { Badge } from "../Badge";
import { confirmAction } from "../ConfirmDialog";
import { PictureTile } from "../PictureTile";
import { ProfileLinksInput, type ProfileLinksHandle } from "../ProfileLinksInput";
import { normalizeProfileLinks } from "../../shared/widgets/profile-links";
import { SPEAKER_ROLE_OPTIONS } from "../../shared/speaker-roles";
import { requestJson } from "../../shared/api-client";
import { cropHeadshot } from "../../shared/headshot/crop";
import { confirmHeadshotUsage } from "../../shared/headshot/controller";
import { ADMIN_HEADSHOT_DISCLAIMER } from "../../shared/headshot/AdminHeadshotManager";
import { formatDateTime, type ToastType } from "../../shared/ui";
import { Badge as ToneBadge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/Field";
import { LinkList } from "../../ui/LinkList";
import { Menu, type MenuItem } from "../../ui/Menu";
import { Panel, PanelBody } from "../../ui/Panel";
import { Select, TextInput } from "../../ui/TextControl";
// `pk-answer-pre` is written here as a class name rather than reached through a
// component, so this module has to pull its stylesheet into its own chunk.
import "../../ui/Content.css";
import { MarkdownEditor } from "../markdown-editor/MarkdownInput";

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

const quiet: (message: string, type: ToastType) => void = () => {};

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
  notify = quiet,
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
  // The proposer cannot simply be removed: the proposal has to pass to
  // another speaker first, and that choice is asked for in a dialog of its
  // own rather than a select standing open beside the name.
  const [choosingReplacement, setChoosingReplacement] = useState(false);
  const [replacementProposerUserId, setReplacementProposerUserId] = useState("");
  const linksRef = useRef<ProfileLinksHandle>(null);
  // ProfileLinksInput labels its own controls, so the group takes its name from
  // the visible heading rather than a `for`/`id` pair pointing at nothing.
  const linksLabelId = `${useId()}-profile-links`;
  const name = [speaker.firstName, speaker.lastName].filter(Boolean).join(" ") || speaker.email;
  const speakerPath = (suffix = "") => endpoints.speakerPath(proposalId, speaker.userId, suffix);
  const assetPath = (asset: "headshot" | "gravatar") => endpoints.assetPath(proposalId, speaker.userId, asset);

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
      notify("Speaker profile updated", "success");
    } catch (caught) {
      notify((caught as Error).message, "error");
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
      notify(`${kind === "profile" ? "Profile" : "Presentation"} reminder sent`, "success");
    } catch (caught) {
      notify((caught as Error).message, "error");
    }
  }

  async function useGravatar() {
    try {
      const data = await requestJson(assetPath("gravatar"), headshotUrlResponseSchema, {
        method: "POST",
        ...(endpoints.gravatarBody === undefined ? {} : { body: JSON.stringify(endpoints.gravatarBody) }),
      });
      onSaved(speaker.userId, { headshotUrl: data.headshotUrl, hasHeadshot: Boolean(data.headshotUrl) });
      notify("Gravatar imported successfully", "success");
    } catch (caught) {
      notify((caught as Error).message, "error");
    }
  }

  async function remove(replacementUserId?: string) {
    setRemoving(true);
    try {
      await requestJson(speakerPath(), proposalSpeakerRemovalResponseSchema, {
        method: "DELETE",
        body: JSON.stringify({ replacementProposerUserId: replacementUserId }),
      });
      notify("Speaker removed", "success");
      onRemoved();
    } catch (caught) {
      notify((caught as Error).message, "error");
    } finally {
      setRemoving(false);
    }
  }

  async function removeSpeaker() {
    if (isCurrentProposer) {
      setReplacementProposerUserId("");
      setChoosingReplacement(true);
      return;
    }
    const confirmed = await confirmAction({
      title: `Remove ${name} from this proposal?`,
      consequences: ["The user profile and audit history are kept"],
      confirmLabel: "Remove speaker",
      tone: "danger",
    });
    if (!confirmed) return;
    await remove();
  }

  const canRemove = Boolean(canFinalize) && (!isCurrentProposer || replacementSpeakers.length > 0);
  const actions: MenuItem[] = [];
  if (canEdit) {
    actions.push({
      id: "edit",
      label: editing ? "Cancel editing" : "Edit profile",
      onSelect: () => setEditing((current) => !current),
    });
    actions.push({ id: "gravatar", label: "Use Gravatar photo", onSelect: () => void useGravatar() });
  }
  if (canFinalize) {
    actions.push({
      id: "remind-profile",
      label: "Send profile reminder",
      separatorBefore: actions.length > 0,
      onSelect: () => void sendReminder("profile"),
    });
    if (requiresPresentation && decisionStatus === "accepted") {
      actions.push({
        id: "remind-presentation",
        label: "Send presentation reminder",
        onSelect: () => void sendReminder("presentation"),
      });
    }
  }
  if (canRemove) {
    actions.push({
      id: "remove",
      label: removing ? "Removing…" : "Remove speaker",
      danger: true,
      disabled: removing,
      separatorBefore: true,
      onSelect: () => void removeSpeaker(),
    });
  }

  const profileLinks = normalizeProfileLinks(speaker.links);
  return (
    <div class="pk">
      <Panel aria-label={`Speaker ${name}`}>
        <PanelBody class="pk-stack pk-stack--snug">
          <div class="pk-cluster pk-cluster--start pk-cluster--between pk-cluster--nowrap">
            <div class="pk-cluster pk-cluster--start pk-cluster--nowrap">
              <PictureTile
                name={name}
                noun="photo"
                shape="round"
                size="mark"
                canChange={canEdit}
                imageUrl={speaker.headshotUrl ?? null}
                alt={name}
                hint="JPEG, PNG or WebP."
                removeConfirmation={`Remove ${name}'s photo?`}
                removeLabel="Remove photo"
                onUpload={async (file) => {
                  // The same two steps a user's portrait takes before it is
                  // stored: the uploader asserts they may publish it, and the
                  // image is cropped square.
                  const accepted = await confirmHeadshotUsage({
                    title: "Before uploading a photo",
                    texts: ADMIN_HEADSHOT_DISCLAIMER,
                    confirmText: "Proceed",
                  });
                  if (!accepted) return false;
                  const cropped = await cropHeadshot(file);
                  if (!cropped) return false;
                  const data = await requestJson(assetPath("headshot"), headshotUrlResponseSchema, {
                    method: "PUT",
                    headers: { "Content-Type": cropped.type || "image/jpeg" },
                    body: cropped,
                  });
                  onSaved(speaker.userId, {
                    headshotUrl: data.headshotUrl ?? null,
                    hasHeadshot: Boolean(data.headshotUrl),
                  });
                  return true;
                }}
                onRemove={async () => {
                  await requestJson(assetPath("headshot"), successResponseSchema, { method: "DELETE" });
                  onSaved(speaker.userId, { headshotUrl: null, hasHeadshot: false });
                }}
                onChanged={() => {}}
                toast={notify}
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
            </div>
            <div class="pk-cluster pk-cluster--nowrap">
              {!speaker.hasBio && <ToneBadge tone="warn">No bio</ToneBadge>}
              {!speaker.hasHeadshot && <ToneBadge tone="warn">No headshot</ToneBadge>}
              {actions.length > 0 && <Menu label={`Actions for ${name}`} align="end" items={actions} />}
            </div>
          </div>
          {!editing && speaker.biography && <p class="pk-small pk-answer-pre">{speaker.biography}</p>}
          {/* The speaker's own profile links, in the one marked vocabulary
              every other record uses. */}
          {!editing && <LinkList links={profileLinks} ownerName={name} />}
          {canFinalize && isCurrentProposer && replacementSpeakers.length === 0 && (
            <p class="pk-small pk-muted">
              The proposer can only be removed once an invited or confirmed replacement speaker exists. Otherwise, ask
              the proposer to use the separate Withdraw proposal action; every proposal must retain its speaker roster.
            </p>
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
                    {/* The proposer keeps the proposal, so their own card
                        offers only "proposer": the role moves by promoting
                        another speaker, never by relabelling this one. Every
                        other card offers the rest of the vocabulary for the
                        same reason. */}
                    {SPEAKER_ROLE_OPTIONS.filter((option) =>
                      isCurrentProposer ? option.value === "proposer" : option.value !== "proposer",
                    ).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Biography">
                {(control) => (
                  <MarkdownEditor
                    {...control}
                    variant="compact"
                    name="biography"
                    label="Biography"
                    initialValue={bio}
                    onChange={setBio}
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
      {choosingReplacement && (
        <Dialog
          open
          destructive
          title={`Remove ${name} from this proposal?`}
          description="The proposal passes to another speaker; the user profile and audit history are kept."
          confirmLabel="Remove speaker"
          confirmDisabled={!replacementProposerUserId}
          onCancel={() => setChoosingReplacement(false)}
          onConfirm={() => {
            setChoosingReplacement(false);
            void remove(replacementProposerUserId);
          }}
        >
          <Field label="Replacement proposer" required>
            {(control) => (
              <Select
                {...control}
                data-replacement-proposer
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
          </Field>
        </Dialog>
      )}
    </div>
  );
}
