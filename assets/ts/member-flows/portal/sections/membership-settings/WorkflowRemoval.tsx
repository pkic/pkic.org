import { useState } from "preact/hooks";
import {
  membershipWorkflowRemovalSchema,
  membershipWorkflowRemovalResponseSchema,
  type MembershipWorkflowVersion,
} from "../../../../../shared/schemas/membership-workflows";
import { useContractForm } from "../../../../hooks/useContractForm";
import { requestJson } from "../../../../shared/api-client";
import { MEMBERSHIP_WORKFLOWS_API } from "../../../../shared/membership-workflow-catalog";
import { usePortalHashLocation } from "../../hash-location";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Textarea } from "../../../../ui/TextControl";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";

export function WorkflowRemoval({ version }: { version: MembershipWorkflowVersion }) {
  const [, navigate] = usePortalHashLocation();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useContractForm(membershipWorkflowRemovalSchema, { expectedRevision: version.revision, reason });
  const action = version.status === "draft" ? "Delete draft" : "Archive version";
  async function submit(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) return setError(checked.message);
    if (busy) return;
    setBusy(true);
    try {
      await requestJson(`${MEMBERSHIP_WORKFLOWS_API}/${version.id}`, membershipWorkflowRemovalResponseSchema, {
        method: "DELETE",
        body: JSON.stringify(checked.data),
      });
      navigate("/settings/application-workflow");
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  if (version.archivedAt)
    return <p>This version is archived. Existing applications retain their review history and requirements.</p>;
  return (
    <Panel>
      <PanelHeader title="Remove from use" />
      <PanelBody class="pk-stack">
        <p>
          {version.status === "draft"
            ? "Delete this unused draft permanently."
            : "Archive this published version to remove it from future selection. Existing applications continue under their pinned policy."}{" "}
          Categories must select another workflow first.
        </p>
        {!confirming ? (
          <div>
            <Button type="button" variant="danger-quiet" onClick={() => setConfirming(true)}>
              {action}…
            </Button>
          </div>
        ) : (
          <form noValidate {...form.handlers} class="pk-stack" onSubmit={(event) => void submit(event)}>
            <Field label="Reason for removal" required {...form.of("reason")}>
              {(control) => (
                <Textarea
                  {...control}
                  name="reason"
                  value={reason}
                  onInput={(event) => setReason(event.currentTarget.value)}
                />
              )}
            </Field>
            <ErrorAlert error={error} />
            <div class="pk-cluster">
              <Button type="submit" variant="danger-quiet" loading={busy}>
                {action}
              </Button>
              <Button type="button" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </PanelBody>
    </Panel>
  );
}
