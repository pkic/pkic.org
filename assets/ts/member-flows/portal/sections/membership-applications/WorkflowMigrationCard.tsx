import { useState } from "preact/hooks";
import type { z } from "zod";
import {
  membershipWorkflowMigrationPreviewSchema,
  membershipWorkflowMigrationPreviewResponseSchema,
  membershipWorkflowMigrationSchema,
  membershipWorkflowMigrationResponseSchema,
} from "../../../../../shared/schemas/membership-workflow-migration";
import { useContractForm } from "../../../../hooks/useContractForm";
import { getJson, postJson } from "../../../../shared/api-client";
import { MembershipWorkflowSelect } from "../../../../components/MembershipWorkflowSelect";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Button } from "../../../../ui/Button";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Textarea } from "../../../../ui/TextControl";
import { usePortalHashLocation } from "../../hash-location";
type Preview = z.infer<typeof membershipWorkflowMigrationPreviewResponseSchema>;
function MigrationConfirmation({ preview, onCancel }: { preview: Preview; onCancel: () => void }) {
  const [, navigate] = usePortalHashLocation();
  const [reason, setReason] = useState("");
  const [acknowledgeRestart, setAcknowledgeRestart] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useContractForm(membershipWorkflowMigrationSchema, {
    versionId: preview.target.id,
    previewFingerprint: preview.fingerprint,
    reason,
    acknowledgeRestart,
  });
  async function submit(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) return setError(checked.message);
    if (busy) return;
    setBusy(true);
    try {
      await postJson(
        `/api/v1/members/applications/${preview.applicationId}/workflow/migration`,
        checked.data,
        membershipWorkflowMigrationResponseSchema,
      );
      navigate(`/membership/applications/${preview.applicationId}/review`);
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form noValidate {...form.handlers} onSubmit={(event) => void submit(event)} class="pk-stack">
      <p>
        <strong>
          {preview.target.definition.name} · version {preview.target.version}
        </strong>
      </p>
      <p>{preview.effect}</p>
      <p>
        Preserved: {preview.unresolvedObjections} unresolved objections and {preview.paidFees} paid fees.
      </p>
      <ol>
        {preview.target.definition.steps.map((step) => (
          <li key={step.id}>
            {step.label}: {step.instructions}
          </li>
        ))}
      </ol>
      <Field label="Reason for changing this application" {...form.of("reason")} required>
        {(control) => (
          <Textarea
            {...control}
            name="reason"
            value={reason}
            onInput={(event) => setReason(event.currentTarget.value)}
          />
        )}
      </Field>
      <Checkbox
        name="acknowledgeRestart"
        checked={acknowledgeRestart}
        onChange={(event) => setAcknowledgeRestart(event.currentTarget.checked)}
        label="I acknowledge that every requirement restarts and all objections remain recorded."
      />
      <ErrorAlert error={error} />
      <div class="pk-cluster">
        <Button type="submit" variant="primary" loading={busy}>
          Apply reviewed workflow change
        </Button>
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
export function WorkflowMigrationCard({ applicationId }: { applicationId: string }) {
  const [versionId, setVersionId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useContractForm(membershipWorkflowMigrationPreviewSchema, { versionId });
  async function inspect(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) return setError(checked.message);
    if (busy) return;
    setBusy(true);
    try {
      setPreview(
        await getJson(
          `/api/v1/members/applications/${applicationId}/workflow/migration?versionId=${encodeURIComponent(checked.data.versionId)}`,
          membershipWorkflowMigrationPreviewResponseSchema,
        ),
      );
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader title="Restart or change workflow" />
      <PanelBody class="pk-stack">
        {preview ? (
          <MigrationConfirmation preview={preview} onCancel={() => setPreview(null)} />
        ) : (
          <form noValidate {...form.handlers} onSubmit={(event) => void inspect(event)} class="pk-stack">
            <p>
              Preview a restart before correcting reviewed application details, or select a different published policy.
              Selecting the current version restarts its requirements.
            </p>
            <Field label="Published workflow version" {...form.of("versionId")} required>
              {(control) => (
                <MembershipWorkflowSelect {...control} name="versionId" value={versionId} onChange={setVersionId} />
              )}
            </Field>
            <ErrorAlert error={error} />
            <div>
              <Button type="submit" loading={busy}>
                Preview workflow change
              </Button>
            </div>
          </form>
        )}
      </PanelBody>
    </Panel>
  );
}
