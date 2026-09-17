import { useState } from "preact/hooks";
import {
  groupMailingSyncResponseSchema,
  groupMailingSyncUpdateSchema,
  groupMailingSyncRunResponseSchema,
} from "../../../../../shared/schemas/group-mailing-sync";
import { useContractForm } from "../../../../hooks/useContractForm";
import { useData } from "../../../../hooks/useData";
import { getJson, patchJson, postJson } from "../../../../shared/api-client";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Button } from "../../../../ui/Button";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { Panel, PanelHeader, PanelBody } from "../../../../ui/Panel";

export function GroupMailingSync({ groupId }: { groupId: string }) {
  const endpoint = `/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists/synchronization`;
  const state = useData(() => getJson(endpoint, groupMailingSyncResponseSchema), [endpoint]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const settings = state.data?.synchronization;
  const form = useContractForm(groupMailingSyncUpdateSchema, {
    enabled: enabled ?? settings?.enabled,
    expectedRevision: settings?.revision,
  });
  async function save(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) return setError(checked.message);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await patchJson(endpoint, checked.data, groupMailingSyncResponseSchema);
      await state.reload();
      setEnabled(null);
      form.reset();
      setNotice("Synchronization settings saved.");
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  async function sync() {
    if (!settings) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await postJson(
        `${endpoint}/runs`,
        { expectedRevision: settings.revision },
        groupMailingSyncRunResponseSchema,
      );
      setNotice(
        result.queued
          ? `${result.queued} subscription changes queued for Google Groups. Delivery status is available in Scheduled jobs.`
          : "No subscription changes need synchronization.",
      );
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel aria-label="Google Groups synchronization">
      <PanelHeader title="Google Groups synchronization" />
      <PanelBody class="pk-stack">
        <p>
          Keep this group's mailing lists aligned with eligible users and their subscription preferences. Pausing
          retains pending changes; a request already sent to Google may finish.
        </p>
        <ErrorAlert error={error || state.error} />
        {settings && (
          <form noValidate {...form.handlers} onSubmit={(event) => void save(event)} class="pk-stack">
            <Field label="Synchronization" {...form.of("enabled")}>
              {(control) => (
                <Checkbox
                  {...control}
                  name="enabled"
                  label="Enable Google Groups synchronization"
                  checked={enabled ?? settings.enabled}
                  onChange={(event) => setEnabled(event.currentTarget.checked)}
                />
              )}
            </Field>
            <div class="pk-cluster">
              <Button type="submit" loading={busy} disabled={enabled === null || enabled === settings.enabled}>
                Save synchronization settings
              </Button>
              <Button
                type="button"
                onClick={() => void sync()}
                disabled={!settings.enabled || busy || (enabled !== null && enabled !== settings.enabled)}
              >
                Sync now
              </Button>
            </div>
          </form>
        )}
        {notice && <p role="status">{notice}</p>}
      </PanelBody>
    </Panel>
  );
}
