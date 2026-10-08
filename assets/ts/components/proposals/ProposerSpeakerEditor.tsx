import { useState } from "preact/hooks";
import { proposerSpeakerPatchSchema, type ProposalAccessResponse } from "../../../shared/schemas/proposal-management";
import { speakerRoleSchema, headshotUploadResponseSchema } from "../../../shared/schemas/registration";
import { successResponseSchema } from "../../../shared/schemas/api-common";
import { proposalAccessPath, type ProposalResourceAccess } from "../../../shared/proposal-access-paths";
import { patchJson, requestJson } from "../../shared/api-client";
import { formatDateTime } from "../../shared/ui";
import { normalizeProfileLinks } from "../../shared/widgets/profile-links";
import { SPEAKER_ROLE_OPTIONS } from "../../shared/speaker-roles";
import { AdminHeadshotManager } from "../../shared/headshot/AdminHeadshotManager";
import { useContractForm } from "../../hooks/useContractForm";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { TextInput, Select } from "../../ui/TextControl";
import { ProfileLinksInput } from "../ProfileLinksInput";
import { MarkdownEditor } from "../markdown-editor/MarkdownInput";
import { ErrorAlert } from "../ErrorAlert";

interface SpeakerContext {
  speaker: ProposalAccessResponse["speakers"][number];
  token: ProposalResourceAccess;
  apiBase: string;
  onReload: () => Promise<void>;
  onStatus: (message: string, isError?: boolean) => void;
}

/** The existing photo commands stay scoped to this proposal's speaker. */
export function ProposerSpeakerPhoto({
  speaker,
  token,
  apiBase,
  onReload,
  onStatus,
  readOnly = false,
}: SpeakerContext & { readOnly?: boolean }) {
  const name = [speaker.firstName, speaker.lastName].filter(Boolean).join(" ") || speaker.email;
  const endpoint = proposalAccessPath(apiBase, token, "speakers", speaker.userId, "headshot");
  return (
    <AdminHeadshotManager
      initialUrl={speaker.headshotUrl ?? null}
      alt={name}
      emptyLabel="No photo"
      readOnly={readOnly}
      statusText={speaker.headshotUpdatedAt ? `Updated: ${formatDateTime(speaker.headshotUpdatedAt)}` : ""}
      uploadLabel="Upload photo"
      deleteLabel="Remove photo"
      uploadSuccessStatus="Photo uploaded."
      deleteSuccessStatus="Photo removed."
      confirmDeleteMessage="Remove this speaker photo?"
      uploadHeadshot={async (file) => {
        const body = new FormData();
        body.append("file", file, "headshot.jpg");
        const response = await requestJson(endpoint, headshotUploadResponseSchema, { method: "PUT", body });
        return { headshotUrl: response.headshotUrl ?? null };
      }}
      deleteHeadshot={async () => {
        await requestJson(endpoint, successResponseSchema, { method: "DELETE" });
      }}
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
  );
}

/** A selected roster record, using the proposer's editorial override contract. */
export function ProposerSpeakerEditor({
  speaker,
  token,
  apiBase,
  isCurrentProposer,
  onReload,
  onStatus,
  onClose,
}: SpeakerContext & {
  isCurrentProposer: boolean;
  onClose: () => void;
}) {
  const [firstName, setFirstName] = useState(speaker.firstName ?? "");
  const [lastName, setLastName] = useState(speaker.lastName ?? "");
  const [organizationName, setOrganizationName] = useState(speaker.organizationName ?? "");
  const [jobTitle, setJobTitle] = useState(speaker.jobTitle ?? "");
  const [biography, setBiography] = useState(speaker.bio ?? "");
  const [role, setRole] = useState(speaker.role);
  const [links, setLinks] = useState(() => normalizeProfileLinks(speaker.links));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const name = [speaker.firstName, speaker.lastName].filter(Boolean).join(" ") || speaker.email;
  const form = useContractForm(proposerSpeakerPatchSchema, {
    firstName: firstName.trim() || null,
    lastName: lastName.trim() || null,
    organizationName: organizationName.trim() || null,
    jobTitle: jobTitle.trim() || null,
    biography: biography.trim() || null,
    role,
    links,
  });
  async function save(event: Event) {
    event.preventDefault();
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await patchJson(
        proposalAccessPath(apiBase, token, "speakers", speaker.userId),
        checked.data,
        successResponseSchema,
      );
      await onReload();
      onStatus(`Saved speaker details for ${speaker.email}.`);
      onClose();
    } catch (cause) {
      const message = form.refuse(cause);
      setError(message);
      onStatus(message, true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Panel
      data-speaker-card
      data-speaker-email={speaker.email}
      data-speaker-user-id={speaker.userId}
      aria-label={`Edit speaker ${name}`}
    >
      <PanelHeader title={`Edit speaker details · ${name}`}>
        <Button type="button" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
      </PanelHeader>
      <PanelBody class="pk-stack">
        <p>{speaker.email}</p>
        <p class="pk-muted">Edit the speaker details shown for this proposal.</p>
        <ProposerSpeakerPhoto
          speaker={speaker}
          token={token}
          apiBase={apiBase}
          onReload={onReload}
          onStatus={onStatus}
        />
        {error && <ErrorAlert error={error} />}
        <form
          noValidate
          {...form.handlers}
          class="pk-stack"
          data-speaker-user-id={speaker.userId}
          onSubmit={(event) => void save(event)}
        >
          <fieldset class="pk-fieldset pk-stack" disabled={saving}>
            <div class="pk-grid">
              <Field label="First name" {...form.of("firstName")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="firstName"
                    value={firstName}
                    onInput={(event) => setFirstName(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field label="Last name" {...form.of("lastName")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="lastName"
                    value={lastName}
                    onInput={(event) => setLastName(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field label="Role" {...form.of("role")}>
                {(control) => (
                  <Select
                    {...control}
                    name="role"
                    value={role}
                    onChange={(event) => setRole(speakerRoleSchema.parse(event.currentTarget.value))}
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
              <Field label="Organization" {...form.of("organizationName")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="organizationName"
                    value={organizationName}
                    onInput={(event) => setOrganizationName(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field label="Job title" {...form.of("jobTitle")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="jobTitle"
                    value={jobTitle}
                    onInput={(event) => setJobTitle(event.currentTarget.value)}
                  />
                )}
              </Field>
            </div>
            <Field label="Biography" help="Visible to attendees on the event program." {...form.of("biography")}>
              {(control) => (
                <MarkdownEditor
                  {...control}
                  variant="compact"
                  name="biography"
                  label="Biography"
                  initialValue={biography}
                  onChange={setBiography}
                  disabled={saving}
                />
              )}
            </Field>
            <Field label="Profile links" group {...form.of("links")}>
              {(control) => (
                <div {...control} role="group">
                  <ProfileLinksInput fieldName="links" value={links} onChange={setLinks} />
                </div>
              )}
            </Field>
            <div class="pk-cluster">
              <Button type="submit" variant="primary" loading={saving}>
                Save speaker details
              </Button>
            </div>
          </fieldset>
        </form>
      </PanelBody>
    </Panel>
  );
}
