/**
 * One speaker on a proposal: who they are, where they stand, and what an
 * operator can do about it.
 *
 * Where they stand is plain text — the role, then "Accepted · Registered
 * (in-person)" — because a normal state needs no color. Only what an
 * organizer has to chase (an invitation not yet accepted, a missing bio) is
 * listed under it, each line with a warning mark. A missing headshot is not
 * listed: the empty photo already says "No headshot" where the photo goes.
 * The record's user and their registration for this event open from the
 * card's menu, so nobody copies a name into another page's search.
 *
 * The card reads like every other record card in the portal. The photo is the
 * same `HeadshotTile` a user's portrait uses — the picture is the control, the
 * remove sits in its corner — rather than a column of three buttons under a
 * placeholder. The commands live behind one `…` menu at the card's top right;
 * they used to be a row of five buttons and a select beside the name, which
 * made a list of speakers read as a list of things to click.
 *
 * Nothing the card shows about the person is the proposal's own. The name and
 * headshot are the person's; the organization, job title, biography and links
 * are the identity they speak as. So editing is editing those: the headshot
 * through the person's own headshot, the profile through the identity's
 * shared editor, opened in a dialog from the menu and never on arrival. The
 * proposal holds only the speaker's role, changed in a dialog of its own.
 */
import { useEffect, useState } from "preact/hooks";
import { isEligibleReplacementProposerStatus } from "../../../shared/schemas/proposal-status";
import {
  proposalSpeakerAcceptanceRequestSchema,
  proposalSpeakerAcceptanceResponseSchema,
} from "../../../shared/schemas/proposal-speakers";
import type { ProposalSpeaker, ProposalRosterSpeaker } from "../../../shared/schemas/proposal-speakers";
import { proposalSpeakerRemovalResponseSchema } from "../../../shared/schemas/proposal-management";
import { successResponseSchema } from "../../../shared/schemas/api-common";
import { statusLabel } from "../Badge";
import { confirmAction } from "../ConfirmDialog";
import { normalizeProfileLinks } from "../../shared/widgets/profile-links";
import { SPEAKER_ROLE_OPTIONS } from "../../shared/speaker-roles";
import { requestJson } from "../../shared/api-client";
import { HeadshotTile } from "../../shared/headshot/HeadshotTile";
import {
  IMPORT_GRAVATAR_LABEL,
  importUserGravatar,
  staffUserHeadshotEndpoint,
} from "../../shared/headshot/user-headshot";
import { formatDate, formatDateTime, type ToastType } from "../../shared/ui";
import { attendanceTypeLabel } from "../../shared/attendance";
import { SPEAKER_NOT_YET_ACCEPTED_LABEL } from "../../../shared/proposal-speaker-acceptance";
import { AttentionList, type AttentionItem } from "../../ui/AttentionList";
import { Button } from "../../ui/Button";
import { Markdown } from "../../ui/Markdown";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/Field";
import { LinkList } from "../../ui/LinkList";
import { Menu, type MenuItem } from "../../ui/Menu";
import { SpeakerPortraitCard } from "../../ui/SpeakerPortraitCard";
import { Select } from "../../ui/TextControl";
// `pk-answer-pre` is written here as a class name rather than reached through a
// component, so this module has to pull its stylesheet into its own chunk.
import "../../ui/Content.css";
import { IdentityRecordEditor } from "../identities/IdentityRecordEditor";
import type { IndependentCapacityReview } from "../../../shared/schemas/independent-capacity";
import {
  IndependentCapacityBadge,
  IndependentCapacityDetails,
  independentCapacityActions,
} from "./IndependentCapacityReview";
import { ProposalSpeakerRoleDialog } from "./ProposalSpeakerRoleDialog";

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
  acceptancePath?: (proposalId: string, userId: string) => string;
  reminderPath?: (proposalId: string, userId: string, kind: "profile" | "presentation") => string;
  reminderBody?: (kind: "profile" | "presentation") => unknown;
}

/** What the viewer may change about the people on the roster; the backend guards stay authoritative. */
export interface ProposalSpeakerProfileAccess {
  /** May edit the identity a speaker speaks as (membership:write). */
  canEditIdentity: boolean;
  /** May change a person's headshot (users:write). */
  canEditHeadshot: boolean;
}

export const NO_PROFILE_ACCESS: ProposalSpeakerProfileAccess = { canEditIdentity: false, canEditHeadshot: false };

const quiet: (message: string, type: ToastType) => void = () => {};

const ROLE_LABELS = new Map(SPEAKER_ROLE_OPTIONS.map((option) => [option.value, option.label]));

/** "Accepted 3 Oct 2026", "Declined …": the answer, when it is a normal one. Open invitations are attention items. */
function participationText(speaker: ProposalSpeaker): string | null {
  if (speaker.status === "confirmed") {
    return speaker.confirmedAt ? `Accepted ${formatDate(speaker.confirmedAt)}` : "Accepted";
  }
  if (speaker.status === "declined") {
    return speaker.declinedAt ? `Declined ${formatDate(speaker.declinedAt)}` : "Declined";
  }
  return null;
}

/** "Registered (in-person)", "Not registered", "Registration cancelled". */
export function speakerRegistrationText(registration: ProposalRosterSpeaker["registration"]): string {
  if (!registration) return "Not registered";
  if (registration.status === "registered") {
    return `Registered (${attendanceTypeLabel(registration.attendanceType).toLowerCase()})`;
  }
  return `Registration ${statusLabel(registration.status).toLowerCase()}`;
}

/** What an organizer still has to chase for this speaker, in the order they would chase it. */
export function speakerAttention(speaker: ProposalSpeaker): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (speaker.status === "invited" || speaker.status === "pending") {
    items.push({
      key: "acceptance",
      children: speaker.inviteExpiresAt
        ? `${SPEAKER_NOT_YET_ACCEPTED_LABEL} (invitation expires ${formatDateTime(speaker.inviteExpiresAt)})`
        : SPEAKER_NOT_YET_ACCEPTED_LABEL,
    });
  }
  if (!speaker.hasBio) items.push({ key: "bio", children: "No bio" });
  return items;
}

export function ProposalSpeakerCard({
  speaker,
  identityId,
  registration,
  userHref,
  identityHref,
  registrationHref,
  independentCapacity,
  onIndependentCapacityReviewed,
  proposalId,
  profileAccess = NO_PROFILE_ACCESS,
  canFinalize,
  decisionStatus,
  requiresPresentation,
  isCurrentProposer,
  replacementSpeakers,
  endpoints,
  onSaved,
  onProfileChanged,
  onRemoved,
  notify = quiet,
}: {
  speaker: ProposalSpeaker;
  /** The identity the speaker speaks as; null when they hold none, undefined where the caller does not know it. */
  identityId?: string | null;
  /** The speaker's registration for this event; undefined where the caller does not know it. */
  registration?: ProposalRosterSpeaker["registration"];
  /** The portal page of the speaker's user record, when the viewer may open it. */
  userHref?: string;
  /** The portal page that shows the speaker's identities, when the viewer may open it. */
  identityHref?: string;
  /** The portal page of this speaker's registration, when the viewer may open it. */
  registrationHref?: string;
  /** A reviewer-only flag for a speaker taking part as an individual. */
  independentCapacity?: IndependentCapacityReview | null;
  onIndependentCapacityReviewed?: (review: IndependentCapacityReview) => void;
  proposalId: string;
  profileAccess?: ProposalSpeakerProfileAccess;
  canFinalize?: boolean;
  decisionStatus?: string | null;
  requiresPresentation?: boolean;
  isCurrentProposer: boolean;
  replacementSpeakers: Array<{ userId: string; label: string }>;
  endpoints: ProposalSpeakerEndpointConfig;
  /** A change the proposal holds — the speaker's role — applied without reading the roster again. */
  onSaved: (userId: string, patch: Partial<ProposalSpeaker>) => void;
  /** The person's headshot or their identity changed; the roster reads them again. */
  onProfileChanged?: () => void;
  onRemoved: () => void;
  notify?: (message: string, type: ToastType) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [changingRole, setChangingRole] = useState(false);
  const [importingGravatar, setImportingGravatar] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [removing, setRemoving] = useState(false);
  // The proposer cannot simply be removed: the proposal has to pass to
  // another speaker first, and that choice is asked for in a dialog of its
  // own rather than a select standing open beside the name.
  const [choosingReplacement, setChoosingReplacement] = useState(false);
  const [replacementProposerUserId, setReplacementProposerUserId] = useState("");
  const name = [speaker.firstName, speaker.lastName].filter(Boolean).join(" ") || "Speaker";
  const speakerPath = (suffix = "") => endpoints.speakerPath(proposalId, speaker.userId, suffix);
  const canEditIdentity = profileAccess.canEditIdentity && Boolean(identityId);
  const canEditHeadshot = profileAccess.canEditHeadshot;
  const profileChanged = () => onProfileChanged?.();

  useEffect(() => setReplacementProposerUserId(""), [speaker]);

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

  async function importGravatar() {
    setImportingGravatar(true);
    try {
      if (await importUserGravatar(speaker.userId, notify)) profileChanged();
    } finally {
      setImportingGravatar(false);
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
  const actions: MenuItem[] = [
    ...(userHref ? [{ id: "user", label: "Open user", href: userHref }] : []),
    ...(identityHref ? [{ id: "identity", label: "Open identity", href: identityHref }] : []),
    ...(registrationHref ? [{ id: "registration", label: "Open registration", href: registrationHref }] : []),
    {
      id: "details",
      label: "View profile details",
      separatorBefore: Boolean(userHref || identityHref || registrationHref),
      onSelect: () => setDetailsOpen(true),
    },
  ];
  if (canEditIdentity || canEditHeadshot) {
    actions.push({
      id: "edit",
      label: canEditIdentity ? "Edit identity" : "Change headshot",
      onSelect: () => setEditing(true),
    });
  }
  if (canEditHeadshot) {
    actions.push({
      id: "gravatar",
      label: importingGravatar ? "Importing photo…" : IMPORT_GRAVATAR_LABEL,
      disabled: importingGravatar,
      onSelect: () => void importGravatar(),
    });
  }
  if (canFinalize && endpoints.acceptancePath && (speaker.status === "invited" || speaker.status === "pending")) {
    actions.push({
      id: "accept-invitation",
      label: accepting ? "Accepting invitation…" : "Accept on behalf of speaker",
      disabled: accepting,
      onSelect: async () => {
        if (
          !(await confirmAction({
            title: `Accept the invitation for ${name}?`,
            body: "Confirm the displayed identity and accept participation and required event terms on this speaker’s behalf. We’ll email them the terms and explain how to contact the PKI Consortium if they disagree.",
            confirmLabel: "Accept invitation",
            tone: "primary",
          }))
        )
          return;
        try {
          setAccepting(true);
          await requestJson(
            endpoints.acceptancePath!(proposalId, speaker.userId),
            proposalSpeakerAcceptanceResponseSchema,
            {
              method: "POST",
              body: JSON.stringify(proposalSpeakerAcceptanceRequestSchema.parse({})),
            },
          );
          notify("Speaker invitation accepted", "success");
          onProfileChanged?.();
        } catch (error) {
          notify((error as Error).message, "error");
        } finally {
          setAccepting(false);
        }
      },
    });
  }
  if (canFinalize && !isCurrentProposer) {
    actions.push({ id: "role", label: "Change role…", onSelect: () => setChangingRole(true) });
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
  if (canFinalize && onIndependentCapacityReviewed)
    actions.push(
      ...independentCapacityActions(
        independentCapacity,
        speakerPath("disclosure/review"),
        onIndependentCapacityReviewed,
        notify,
      ),
    );
  if (canFinalize) {
    actions.push({
      id: "remove",
      label: removing ? "Removing…" : "Remove speaker",
      danger: true,
      disabled: removing,
      separatorBefore: true,
      onSelect: () => {
        if (!canRemove) {
          notify("Invite another speaker to take over before removing the proposer.", "error");
          return;
        }
        void removeSpeaker();
      },
    });
  }

  const profileLinks = normalizeProfileLinks(speaker.links);
  return (
    <div class="pk">
      <SpeakerPortraitCard
        name={name}
        imageSrc={speaker.headshotUrl}
        actions={<Menu label={`Actions for ${name}`} align="end" items={actions} />}
        missingImage={
          <>
            <span>No headshot</span>
            {canEditHeadshot && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Add headshot
              </Button>
            )}
          </>
        }
      >
        <div class="pk-stack pk-stack--snug">
          <div class="pk-stack pk-stack--tight">
            <span class="pk-agenda-speaker-directory__name">
              <strong>{name}</strong>
            </span>
            {(speaker.organizationName || speaker.jobTitle) && (
              <span class="pk-agenda-speaker-directory__title">
                {[speaker.jobTitle, speaker.organizationName].filter(Boolean).join(", ")}
              </span>
            )}
          </div>
          <dl class="pk-speaker-portrait-standing" aria-label={`Where ${name} stands`}>
            <dt class="pk-sr-only">Role</dt>
            <dd>{ROLE_LABELS.get(speaker.role) ?? statusLabel(speaker.role)}</dd>
            <dt class="pk-sr-only">Status</dt>
            <dd>
              {[participationText(speaker), registration === undefined ? null : speakerRegistrationText(registration)]
                .filter(Boolean)
                .join(" · ")}
            </dd>
            {speaker.declineReason && (
              <>
                <dt class="pk-sr-only">Decline reason</dt>
                <dd>“{speaker.declineReason}”</dd>
              </>
            )}
          </dl>
          {independentCapacity && <IndependentCapacityBadge status={independentCapacity.status} />}
          <AttentionList label={`Still needed for ${name}`} items={speakerAttention(speaker)} />
        </div>
      </SpeakerPortraitCard>
      {editing && (
        // The editor has its own Save and Cancel, so the dialog brings no
        // confirmation of its own: it closes through its header and Escape.
        <Dialog
          open
          viewer
          title={canEditIdentity ? `Edit ${name}'s identity` : `Change ${name}'s headshot`}
          closeLabel="Close editor"
          confirmLabel="Close"
          onConfirm={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        >
          <div class="pk-stack">
            {canEditHeadshot && (
              <HeadshotTile
                name={name}
                canChange
                imageUrl={speaker.headshotUrl ?? null}
                consent="on-behalf"
                endpoint={staffUserHeadshotEndpoint(speaker.userId)}
                onChanged={profileChanged}
                notify={notify}
              />
            )}
            {canEditIdentity && identityId && (
              <IdentityRecordEditor
                identityId={identityId}
                onSaved={() => {
                  notify("Identity updated", "success");
                  setEditing(false);
                  profileChanged();
                }}
                onCancel={() => setEditing(false)}
              />
            )}
          </div>
        </Dialog>
      )}
      {changingRole && (
        <ProposalSpeakerRoleDialog
          name={name}
          role={speaker.role}
          path={speakerPath()}
          notify={notify}
          onSaved={(role) => onSaved(speaker.userId, { role })}
          onClose={() => setChangingRole(false)}
        />
      )}
      {detailsOpen && (
        <Dialog
          open
          title={name}
          confirmLabel="Close"
          onConfirm={() => setDetailsOpen(false)}
          onCancel={() => setDetailsOpen(false)}
        >
          <div class="pk-stack">
            <p>{speaker.email}</p>
            <p>{[speaker.jobTitle, speaker.organizationName].filter(Boolean).join(" · ")}</p>
            {speaker.biography && <Markdown markdown={speaker.biography} />}
            {independentCapacity && <IndependentCapacityDetails review={independentCapacity} />}
            <LinkList links={profileLinks} ownerName={name} />
          </div>
        </Dialog>
      )}
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
