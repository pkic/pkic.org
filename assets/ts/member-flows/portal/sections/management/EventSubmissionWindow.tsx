import { useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import {
  groupEventFormPlacementUpdateSchema,
  groupEventFormResponseSchema,
} from "../../../../../shared/schemas/group-event-forms";
import { formatDateTimeInZone } from "../../../../../shared/format-date";
import {
  SubmissionWindowFields,
  instantFromLocal,
  localFromInstant,
} from "../../../../components/forms/SubmissionWindowFields";
import { useContractForm } from "../../../../hooks/useContractForm";
import { patchJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { EditActions } from "../../../../ui/EditActions";
import { Panel, PanelHeader, PanelBody } from "../../../../ui/Panel";

export type PlacementResponse = z.infer<typeof groupEventFormResponseSchema>;
export type SubmissionPlacement = NonNullable<PlacementResponse["form"]>["placement"];
export type SubmissionWindowInput = z.infer<typeof groupEventFormPlacementUpdateSchema>;

/** The one write of an event form's submission window: every surface that opens or closes it sends this PATCH. */
export function patchSubmissionWindow(base: string, body: SubmissionWindowInput): Promise<PlacementResponse> {
  return patchJson(base, body, groupEventFormResponseSchema);
}

/**
 * The draft, contract and save of one placement's submission window.
 *
 * The panel in Settings and the dialog on the Proposals tab both edit the same
 * two instants, so they share this and `EventSubmissionWindowFields`; neither
 * owns a copy of the conversion, the contract or the PATCH. The window is a
 * wall clock participants agreed to, so it is always entered and shown in the
 * event's own IANA zone, never the reader's.
 */
export function useEventSubmissionWindow({
  base,
  placement,
  expectedUpdatedAt,
  timeZone,
  onSaved,
}: {
  base: string;
  placement: SubmissionPlacement;
  expectedUpdatedAt: string;
  /** The event's IANA zone. */
  timeZone: string;
  onSaved: (response: PlacementResponse) => void;
}) {
  const draftFromPlacement = () => ({
    opensAt: localFromInstant(placement.opensAt, timeZone),
    closesAt: localFromInstant(placement.closesAt, timeZone),
  });
  const [draft, setDraft] = useState(draftFromPlacement);
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
  }, [placement.id, placement.opensAt, placement.closesAt]);
  function reset() {
    setDraft(draftFromPlacement());
    form.reset();
    setError("");
    setSaved(false);
  }
  /** Checks the draft against the contract and sends it; true when the window was saved. */
  async function save(): Promise<boolean> {
    if (saving) return false;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return false;
    }
    setSaving(true);
    setError("");
    try {
      onSaved(await patchSubmissionWindow(base, checked.data));
      setSaved(true);
      return true;
    } catch (cause) {
      setError(form.refuse(cause));
      return false;
    } finally {
      setSaving(false);
    }
  }
  return {
    timeZone,
    zoneOwner: "Event time" as const,
    draft,
    change: (patch: { opensAt?: string; closesAt?: string }) => setDraft((current) => ({ ...current, ...patch })),
    form,
    saving,
    error,
    saved,
    reset,
    save,
  };
}

export type EventSubmissionWindowEditor = ReturnType<typeof useEventSubmissionWindow>;

/** The Opens and Closes controls of an editor from `useEventSubmissionWindow`. */
export function EventSubmissionWindowFields({ editor }: { editor: EventSubmissionWindowEditor }) {
  return (
    <fieldset class="pk-fieldset pk-grid" disabled={editor.saving}>
      <SubmissionWindowFields
        timeZone={editor.timeZone}
        zoneOwner={editor.zoneOwner}
        opensAt={editor.draft.opensAt}
        closesAt={editor.draft.closesAt}
        onChange={editor.change}
        fieldProps={{ opensAt: editor.form.of("opensAt"), closesAt: editor.form.of("closesAt") }}
      />
    </fieldset>
  );
}

export function EventSubmissionWindow({
  base,
  placement,
  expectedUpdatedAt,
  timeZone,
  onSaved,
}: {
  base: string;
  placement: SubmissionPlacement;
  expectedUpdatedAt: string;
  timeZone: string;
  onSaved: (response: PlacementResponse) => void;
}) {
  const editor = useEventSubmissionWindow({ base, placement, expectedUpdatedAt, timeZone, onSaved });
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [placement.id, placement.opensAt, placement.closesAt]);
  async function save(event: Event) {
    event.preventDefault();
    if (!editing) return;
    if (await editor.save()) setEditing(false);
  }
  return (
    <Panel aria-label="Submission window">
      <form noValidate {...editor.form.handlers} onSubmit={save}>
        <PanelHeader title="Submission window" headingLevel={4}>
          <EditActions
            label="Submission window actions"
            editing={editing}
            saving={editor.saving}
            saveLabel="Save submission window"
            onEdit={() => {
              editor.reset();
              setEditing(true);
            }}
            onCancel={() => {
              editor.reset();
              setEditing(false);
            }}
          />
        </PanelHeader>
        <PanelBody class="pk-stack">
          {editing ? (
            <EventSubmissionWindowFields editor={editor} />
          ) : (
            <DescriptionList
              items={[
                {
                  term: "Opens",
                  value: placement.opensAt
                    ? formatDateTimeInZone(placement.opensAt, timeZone)
                    : "No opening restriction",
                },
                {
                  term: "Closes",
                  value: placement.closesAt
                    ? formatDateTimeInZone(placement.closesAt, timeZone)
                    : "No closing restriction",
                },
                { term: "Time zone", value: timeZone },
              ]}
            />
          )}
          {editor.error && <Alert tone="danger">{editor.error}</Alert>}
          {editor.saved && <Alert tone="ok">Submission window saved.</Alert>}
        </PanelBody>
      </form>
    </Panel>
  );
}
