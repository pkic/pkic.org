import { useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import {
  groupEventFormPlacementUpdateSchema,
  groupEventFormResponseSchema,
} from "../../../../../shared/schemas/group-event-forms";
import { formatDateTime } from "../../../../../shared/format-date";
import {
  SubmissionWindowFields,
  instantFromLocal,
  localFromInstant,
} from "../../../../components/forms/SubmissionWindowFields";
import { useContractForm } from "../../../../hooks/useContractForm";
import { patchJson } from "../../../../shared/api-client";
import { browserTimeZone } from "../../ui";
import { Alert } from "../../../../ui/Alert";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { EditActions } from "../../../../ui/EditActions";
import { Panel, PanelHeader, PanelBody } from "../../../../ui/Panel";

type PlacementResponse = z.infer<typeof groupEventFormResponseSchema>;

export function EventSubmissionWindow({
  base,
  placement,
  expectedUpdatedAt,
  onSaved,
}: {
  base: string;
  placement: NonNullable<PlacementResponse["form"]>["placement"];
  expectedUpdatedAt: string;
  onSaved: (response: PlacementResponse) => void;
}) {
  const [timeZone] = useState(browserTimeZone);
  const draftFromPlacement = () => ({
    opensAt: localFromInstant(placement.opensAt),
    closesAt: localFromInstant(placement.closesAt),
  });
  const [draft, setDraft] = useState(draftFromPlacement);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const form = useContractForm(groupEventFormPlacementUpdateSchema, {
    expectedUpdatedAt,
    opensAt: instantFromLocal(draft.opensAt, timeZone),
    closesAt: instantFromLocal(draft.closesAt, timeZone),
  });
  useEffect(() => {
    setDraft(draftFromPlacement());
    setEditing(false);
  }, [placement.id, placement.opensAt, placement.closesAt]);
  function reset() {
    setDraft(draftFromPlacement());
    form.reset();
    setError("");
    setSaved(false);
  }
  async function save(event: Event) {
    event.preventDefault();
    if (!editing || saving) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSaving(true);
    setError("");
    try {
      onSaved(await patchJson(base, checked.data, groupEventFormResponseSchema));
      setEditing(false);
      setSaved(true);
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Panel aria-label="Submission window">
      <form noValidate {...form.handlers} onSubmit={save}>
        <PanelHeader title="Submission window" headingLevel={4}>
          <EditActions
            label="Submission window actions"
            editing={editing}
            saving={saving}
            saveLabel="Save submission window"
            onEdit={() => {
              reset();
              setEditing(true);
            }}
            onCancel={() => {
              reset();
              setEditing(false);
            }}
          />
        </PanelHeader>
        <PanelBody class="pk-stack">
          {editing ? (
            <fieldset class="pk-fieldset pk-grid" disabled={saving}>
              <SubmissionWindowFields
                timeZone={timeZone}
                opensAt={draft.opensAt}
                closesAt={draft.closesAt}
                onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
                fieldProps={{ opensAt: form.of("opensAt"), closesAt: form.of("closesAt") }}
              />
            </fieldset>
          ) : (
            <DescriptionList
              items={[
                {
                  term: "Opens",
                  value: placement.opensAt ? formatDateTime(placement.opensAt) : "No opening restriction",
                },
                {
                  term: "Closes",
                  value: placement.closesAt ? formatDateTime(placement.closesAt) : "No closing restriction",
                },
                { term: "Time zone", value: timeZone },
              ]}
            />
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          {saved && <Alert tone="ok">Submission window saved.</Alert>}
        </PanelBody>
      </form>
    </Panel>
  );
}
