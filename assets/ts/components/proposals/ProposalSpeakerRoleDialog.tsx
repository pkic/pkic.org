/**
 * Changing what a speaker does on one proposal — speaker, moderator,
 * panelist — the one thing about them the proposal itself holds. Asked in a
 * dialog from the card's menu rather than a select standing open on the card.
 *
 * The proposer may take any role; only the proposer may hold the proposer
 * role. Transfer ownership by promoting another speaker.
 */
import { useState } from "preact/hooks";
import { proposalSpeakerPatchSchema } from "../../../shared/schemas/proposal-management";
import { proposalSpeakerPatchResponseSchema } from "../../../shared/schemas/proposal-speakers";
import { speakerRoleSchema, type SpeakerRole } from "../../../shared/schemas/registration";
import { useContractForm } from "../../hooks/useContractForm";
import { requestJson } from "../../shared/api-client";
import { assignableSpeakerRoleOptions } from "../../shared/speaker-roles";
import type { ToastType } from "../../shared/ui";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/Field";
import { Select } from "../../ui/TextControl";

export function ProposalSpeakerRoleDialog({
  name,
  role,
  isCurrentProposer,
  path,
  onSaved,
  onClose,
  notify,
}: {
  name: string;
  role: SpeakerRole;
  /** Whether this speaker is the proposal's proposer, the only one who may hold the proposer role. */
  isCurrentProposer: boolean;
  /** The speaker on this proposal's roster. */
  path: string;
  onSaved: (role: SpeakerRole) => void;
  onClose: () => void;
  notify: (message: string, type: ToastType) => void;
}) {
  const [draft, setDraft] = useState(role);
  const [saving, setSaving] = useState(false);
  const form = useContractForm(proposalSpeakerPatchSchema, { role: draft });

  async function save() {
    const checked = form.submit();
    if (!checked.data) {
      if (checked.formMessage) notify(checked.formMessage, "error");
      return;
    }
    if (checked.data.role === role) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await requestJson(path, proposalSpeakerPatchResponseSchema, {
        method: "PATCH",
        body: JSON.stringify(checked.data),
      });
      onSaved(checked.data.role);
      notify("Role changed", "success");
      onClose();
    } catch (cause) {
      notify(form.refuse(cause), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title={`Change ${name}'s role`}
      confirmLabel={saving ? "Saving…" : "Save role"}
      confirmDisabled={saving}
      onConfirm={() => void save()}
      onCancel={onClose}
    >
      <Field label="Role" {...form.of("role")}>
        {(control) => (
          <Select
            {...control}
            name="role"
            value={draft}
            onChange={(event) => setDraft(speakerRoleSchema.parse(event.currentTarget.value))}
          >
            {assignableSpeakerRoleOptions({ isCurrentProposer }).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Dialog>
  );
}
