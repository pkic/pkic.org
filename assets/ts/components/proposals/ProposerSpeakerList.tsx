import { useEffect, useRef, useState } from "preact/hooks";
import { deleteJson, patchJson, postJson, requestJson } from "../../shared/api-client";
import { formatDateTime } from "../../shared/ui";
import type { ProposalAccessResponse } from "../../shared/types";
import { normalizeValidation } from "../../shared/form/validation-map";
import { formatStatusLabel } from "../../shared/form/helpers";
import { statusTone } from "../Badge";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Panel, PanelBody } from "../../ui/Panel";
import { Field } from "../../ui/Field";
import { Select, TextInput } from "../../ui/TextControl";
import { AdminHeadshotManager } from "../../shared/headshot/AdminHeadshotManager";
import { ProfileLinksInput, type ProfileLinksHandle } from "../ProfileLinksInput";
import { normalizeProfileLinks } from "../../shared/widgets/profile-links";
import { speakerRoleSchema, headshotUploadResponseSchema } from "../../../shared/schemas/registration";
import { successResponseSchema } from "../../../shared/schemas/api-common";
import {
  proposerSpeakerPatchSchema,
  proposalSpeakerRemovalResponseSchema,
} from "../../../shared/schemas/proposal-management";
import { SPEAKER_ROLE_OPTIONS } from "../../shared/speaker-roles";
import { MarkdownEditor } from "../markdown-editor/MarkdownInput";
import { proposalAccessPath, type ProposalResourceAccess } from "../../../shared/proposal-access-paths";

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
  token: ProposalResourceAccess;
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
    setHeadshotStatus(speaker.headshotUpdatedAt ? `Updated: ${formatDateTime(speaker.headshotUpdatedAt)}` : "");
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

  // The shared option labels rather than an underscore-stripping replace, so
  // a role reads the same in the badge as it does in the select below it.
  const roleLabel = SPEAKER_ROLE_OPTIONS.find((option) => option.value === speaker.role)?.label ?? speaker.role;

  return (
    <Panel data-speaker-card data-speaker-email={speaker.email} aria-label={`Speaker ${speakerName}`}>
      <PanelBody>
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
            <Badge tone="neutral">{roleLabel}</Badge>
            <Badge tone={statusTone(speaker.status)}>{formatStatusLabel(speaker.status)}</Badge>
            {(speaker.status === "invited" || speaker.status === "confirmed") && (
              // `loading` rather than `disabled`: a disabled control loses
              // focus, which throws a screen-reader user out of the card they
              // were working in mid-request.
              <Button variant="secondary" size="sm" loading={reminding} onClick={() => void sendReminder()}>
                {reminding
                  ? "Sending…"
                  : speaker.status === "invited"
                    ? "Send invitation reminder"
                    : "Request speaker to review or update their profile"}
              </Button>
            )}
            {!isCurrentProposer && (
              <Button
                variant="danger-quiet"
                size="sm"
                data-remove-proposal-speaker
                loading={removing}
                onClick={() => void removeSpeaker()}
              >
                {removing ? "Removing…" : "Remove speaker"}
              </Button>
            )}
          </div>

          <form class="pk-stack" data-speaker-user-id={speaker.userId} onSubmit={(event) => void saveProfile(event)}>
            <div class="pk-grid">
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
              <Field label="Role">
                {(control) => (
                  <Select
                    {...control}
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
                  </Select>
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
            <Field label="Biography" help="Visible to attendees on the event program.">
              {(control) => (
                // The shared Markdown editor (#114), remounted when the saved
                // biography changes so a reload shows what was saved. The
                // guidance is wired to the control rather than merely sitting
                // under it, so it is announced with the field it is about.
                <MarkdownEditor
                  key={speaker.bio ?? ""}
                  {...control}
                  variant="compact"
                  name={`speaker-biography-${speaker.userId}`}
                  label="Biography"
                  initialValue={biography}
                  onChange={setBiography}
                />
              )}
            </Field>
            <ProfileLinksInput ref={linksRef} fieldName={`speaker-links-${speaker.userId}`} />
            <div class="pk-cluster">
              <Button type="submit" variant="primary" size="sm" loading={saving}>
                {saving ? "Saving…" : "Save speaker details"}
              </Button>
            </div>
          </form>
        </div>
      </PanelBody>
    </Panel>
  );
}

/** Exported so the empty state can be asserted without booting the page. */
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
  if (!speakers.length) {
    return <EmptyState title="No speakers added yet" body="Invite a co-speaker to add one to this proposal." />;
  }
  return (
    // The gap belongs to the list, not to a margin on each card.
    <div class="pk-stack">
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
