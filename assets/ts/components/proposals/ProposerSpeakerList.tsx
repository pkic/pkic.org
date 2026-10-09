import { useState } from "preact/hooks";
import { deleteJson, postJson } from "../../shared/api-client";
import type { ProposalAccessResponse } from "../../shared/types";
import { normalizeValidation } from "../../shared/form/validation-map";
import { formatStatusLabel } from "../../shared/form/helpers";
import { statusTone } from "../Badge";
import { confirmAction } from "../ConfirmDialog";
import { Badge } from "../../ui/Badge";
import { EmptyState } from "../../ui/EmptyState";
import { Panel, PanelHeader, PanelBody } from "../../ui/Panel";
import { Menu, type MenuItem } from "../../ui/Menu";
import { LinkList } from "../../ui/LinkList";
import { Markdown } from "../../ui/Markdown";
import { normalizeProfileLinks } from "../../shared/widgets/profile-links";
import { successResponseSchema } from "../../../shared/schemas/api-common";
import { proposalSpeakerRemovalResponseSchema } from "../../../shared/schemas/proposal-management";
import { SPEAKER_ROLE_OPTIONS } from "../../shared/speaker-roles";
import { proposalAccessPath, type ProposalResourceAccess } from "../../../shared/proposal-access-paths";
import { ProposerSpeakerEditor, ProposerSpeakerPhoto } from "./ProposerSpeakerEditor";

export function ProposalManageSpeakerCard({
  speaker,
  token,
  apiBase,
  isCurrentProposer,
  onEdit,
  onReload,
  onStatus,
}: {
  speaker: ProposalAccessResponse["speakers"][number];
  token: ProposalResourceAccess;
  apiBase: string;
  isCurrentProposer: boolean;
  onEdit: () => void;
  onReload: () => Promise<void>;
  onStatus: (message: string, isError?: boolean) => void;
}) {
  const [reminding, setReminding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const speakerName = [speaker.firstName, speaker.lastName].filter(Boolean).join(" ") || speaker.email;
  const profileEndpoint = proposalAccessPath(apiBase, token, "speakers", speaker.userId);

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
    const confirmed = await confirmAction({
      title: `Remove ${speakerName} from this proposal?`,
      consequences: ["Their user profile and proposal history are kept."],
      confirmLabel: "Remove speaker",
    });
    if (!confirmed) return;
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

  const roleLabel = SPEAKER_ROLE_OPTIONS.find((option) => option.value === speaker.role)?.label ?? speaker.role;
  const busy = reminding || removing;
  const actions: MenuItem[] = [{ id: "edit", label: "Edit speaker details", disabled: busy, onSelect: onEdit }];
  if (speaker.status === "invited" || speaker.status === "confirmed")
    actions.push({
      id: "remind",
      label:
        speaker.status === "invited" ? "Send invitation reminder" : "Request speaker to review or update their profile",
      disabled: busy,
      onSelect: () => void sendReminder(),
    });
  if (!isCurrentProposer)
    actions.push({
      id: "remove",
      label: "Remove speaker",
      danger: true,
      separatorBefore: true,
      disabled: busy,
      onSelect: () => void removeSpeaker(),
    });

  return (
    <Panel
      data-speaker-card
      data-speaker-email={speaker.email}
      data-speaker-user-id={speaker.userId}
      aria-label={`Speaker ${speakerName}`}
    >
      <PanelHeader title={speakerName}>
        <Menu label={`Actions for ${speakerName}`} align="end" items={actions} />
      </PanelHeader>
      <PanelBody class="pk-stack pk-stack--snug">
        <ProposerSpeakerPhoto
          speaker={speaker}
          token={token}
          apiBase={apiBase}
          readOnly
          onReload={onReload}
          onStatus={onStatus}
        />
        <div class="pk-cluster">
          <span>{speaker.email}</span>
          <Badge tone="neutral">{roleLabel}</Badge>
          <Badge tone={statusTone(speaker.status)}>{formatStatusLabel(speaker.status)}</Badge>
        </div>
        {(speaker.organizationName || speaker.jobTitle) && (
          <p class="pk-small">{[speaker.jobTitle, speaker.organizationName].filter(Boolean).join(" · ")}</p>
        )}
        {speaker.bio && <Markdown markdown={speaker.bio} className="pk-small" />}
        <LinkList links={normalizeProfileLinks(speaker.links)} ownerName={speakerName} />
        {busy && <p role="status">{removing ? "Removing speaker…" : "Sending…"}</p>}
      </PanelBody>
    </Panel>
  );
}

export function SpeakerList({
  speakers,
  token,
  apiBase,
  proposerUserId,
  onReload,
  onStatus,
}: {
  speakers: ProposalAccessResponse["speakers"];
  token: ProposalResourceAccess;
  apiBase: string;
  proposerUserId: string;
  onReload: () => Promise<void>;
  onStatus: (message: string, isError?: boolean) => void;
}) {
  const [editingId, setEditing] = useState<string | null>(null);
  const editing = speakers.find((speaker) => speaker.userId === editingId);
  if (editing)
    return (
      <ProposerSpeakerEditor
        key={editing.userId}
        speaker={editing}
        token={token}
        apiBase={apiBase}
        isCurrentProposer={editing.userId === proposerUserId}
        onReload={onReload}
        onStatus={onStatus}
        onClose={() => setEditing(null)}
      />
    );
  if (!speakers.length)
    return <EmptyState title="No speakers added yet" body="Invite a co-speaker to add one to this proposal." />;
  return (
    <div class="pk-stack">
      {speakers.map((speaker) => (
        <ProposalManageSpeakerCard
          key={speaker.userId}
          speaker={speaker}
          token={token}
          apiBase={apiBase}
          isCurrentProposer={speaker.userId === proposerUserId}
          onEdit={() => setEditing(speaker.userId)}
          onReload={onReload}
          onStatus={onStatus}
        />
      ))}
    </div>
  );
}
