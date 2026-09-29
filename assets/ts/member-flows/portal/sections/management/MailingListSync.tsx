import { mailingListSyncPath, requestMailingListSync } from "./mailing-list-sync-request";
import { useState } from "preact/hooks";
import {
  mailingListSyncResponseSchema,
  mailingListSyncUpdateSchema,
} from "../../../../../shared/schemas/mailing-list-sync";
import { useContractForm } from "../../../../hooks/useContractForm";
import { useData } from "../../../../hooks/useData";
import { getJson, patchJson } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { Panel, PanelHeader, PanelBody } from "../../../../ui/Panel";

export function useMailingListSync(groupId: string, listId: string) {
  const endpoint = mailingListSyncPath(groupId, listId);
  const state = useData(() => getJson(endpoint, mailingListSyncResponseSchema), [endpoint]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const settings = state.data?.synchronization;
  const form = useContractForm(mailingListSyncUpdateSchema, {
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
      await patchJson(endpoint, checked.data, mailingListSyncResponseSchema);
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
      setNotice(await requestMailingListSync(endpoint, settings.revision));
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  return { settings, enabled, setEnabled, busy, error: error || state.error, notice, form, save, sync };
}

export function MailingListSyncSettings({ sync }: { sync: ReturnType<typeof useMailingListSync> }) {
  const { settings, enabled, setEnabled, busy, form, save } = sync;
  return (
    <Panel aria-label="Google Groups synchronization">
      <PanelHeader title="Google Groups synchronization" />
      <PanelBody class="pk-stack">
        <p>
          Keep this mailing list aligned with eligible users and their subscription preferences. Pausing retains pending
          changes; a request already sent to Google may finish. To request a sync, choose “Sync now” from this mailing
          list’s three-dot actions menu.
        </p>
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
            </div>
          </form>
        )}
      </PanelBody>
    </Panel>
  );
}
