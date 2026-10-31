import { useState } from "preact/hooks";
import { proposalSpeakerPatchSchema, type ProposalAccessResponse } from "../../../shared/schemas/proposal-management";
import { speakerRoleSchema } from "../../../shared/schemas/registration";
import { successResponseSchema } from "../../../shared/schemas/api-common";
import { proposalAccessPath, type ProposalResourceAccess } from "../../../shared/proposal-access-paths";
import { patchJson } from "../../shared/api-client";
import { SPEAKER_ROLE_OPTIONS } from "../../shared/speaker-roles";
import { useContractForm } from "../../hooks/useContractForm";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Select } from "../../ui/TextControl";
import { ErrorAlert } from "../ErrorAlert";
import { DescriptionList } from "../../ui/DescriptionList";

/**
 * What the proposer changes on a speaker: their role on this proposal. The
 * name and photo are the person's and the title, biography and links the
 * identity's they speak as; the speaker edits those on their own speaker page.
 */
export function ProposerSpeakerEditor({
  speaker,
  token,
  apiBase,
  isCurrentProposer,
  onReload,
  onStatus,
  onClose,
}: {
  speaker: ProposalAccessResponse["speakers"][number];
  token: ProposalResourceAccess;
  apiBase: string;
  isCurrentProposer: boolean;
  onReload: () => Promise<void>;
  onStatus: (message: string, isError?: boolean) => void;
  onClose: () => void;
}) {
  const [role, setRole] = useState(speaker.role);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const name = [speaker.firstName, speaker.lastName].filter(Boolean).join(" ") || speaker.email;
  const form = useContractForm(proposalSpeakerPatchSchema, { role });
  async function save(event: Event) {
    event.preventDefault();
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
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
      onStatus(`Saved the role of ${speaker.email}.`);
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
      aria-label={`Change the role of ${name}`}
    >
      <PanelHeader title={`Change role · ${name}`}>
        <Button type="button" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
      </PanelHeader>
      <PanelBody class="pk-stack">
        <DescriptionList
          density="compact"
          items={[
            { term: "Email", value: speaker.email },
            { term: "Organization", value: speaker.organizationName },
            { term: "Job title", value: speaker.jobTitle },
          ]}
        />
        <p class="pk-small pk-muted">
          Speakers keep their own name, photo and profile up to date on their speaker page. Send them a reminder if
          something needs changing.
        </p>
        {error && <ErrorAlert error={error} />}
        <form
          noValidate
          {...form.handlers}
          class="pk-stack"
          data-speaker-user-id={speaker.userId}
          onSubmit={(event) => void save(event)}
        >
          <fieldset class="pk-fieldset pk-stack" disabled={saving}>
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
            <div class="pk-cluster">
              <Button type="submit" variant="primary" loading={saving}>
                Save role
              </Button>
            </div>
          </fieldset>
        </form>
      </PanelBody>
    </Panel>
  );
}
