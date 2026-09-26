/**
 * When a form accepts responses.
 *
 * The window is two optional instants stored in UTC. The controls are
 * `datetime-local`, which speaks a wall clock with no zone attached, so both
 * directions go through the shared timezone codec against the reader's own
 * zone: the browser shows and takes local time, the wire carries UTC, and the
 * conversion happens here and nowhere deeper.
 */
import { useEffect, useState } from "preact/hooks";
import {
  groupFormDefinitionResponseSchema,
  groupFormPlacementUpdateSchema,
} from "../../../../../shared/schemas/group-forms";
import type { FormPlacement } from "../../../../../shared/schemas/forms";
import { useContractForm } from "../../../../hooks/useContractForm";
import { patchJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { PanelHeader } from "../../../../ui/Panel";
import { EditActions } from "../../../../ui/EditActions";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { formatDateTime } from "../../../../../shared/format-date";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { TextInput } from "../../../../ui/TextControl";
import { browserTimeZone, toast } from "../../ui";
import {
  SubmissionWindowFields,
  instantFromLocal,
  localFromInstant,
} from "../../../../components/forms/SubmissionWindowFields";

interface WindowDraft {
  audience: string;
  active: boolean;
  opensAt: string;
  closesAt: string;
}

function draftFrom(placement: FormPlacement): WindowDraft {
  return {
    audience: placement.audience,
    active: placement.active,
    opensAt: localFromInstant(placement.opensAt),
    closesAt: localFromInstant(placement.closesAt),
  };
}

function payloadFrom(draft: WindowDraft, timeZone: string) {
  return {
    audience: draft.audience,
    active: draft.active,
    opensAt: instantFromLocal(draft.opensAt, timeZone),
    closesAt: instantFromLocal(draft.closesAt, timeZone),
  };
}

export function GroupFormPlacementEditor({
  groupId,
  placement,
  onSaved,
}: {
  groupId: string;
  placement: FormPlacement;
  onSaved: () => void | Promise<void>;
}) {
  const [timeZone] = useState(browserTimeZone);
  const [draft, setDraft] = useState<WindowDraft>(() => draftFrom(placement));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(groupFormPlacementUpdateSchema, payloadFrom(draft, timeZone));
  const activeId = `form-placement-active-${placement.id}`;
  useEffect(() => {
    setDraft(draftFrom(placement));
    setEditing(false);
  }, [placement.id, placement.updatedAt]);
  function reset() {
    setDraft(draftFrom(placement));
    form.reset();
    setError("");
  }

  const set = <K extends keyof WindowDraft>(key: K, value: WindowDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    if (!editing || saving) return;
    setError("");
    const { data, message } = form.submit();
    if (!data) {
      setError(message);
      toast(message, "error");
      return;
    }
    setSaving(true);
    try {
      await patchJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/forms/${encodeURIComponent(placement.id)}`,
        data,
        groupFormDefinitionResponseSchema,
      );
      toast("Form availability updated", "success");
      await onSaved();
      setEditing(false);
    } catch (caught) {
      const refusal = form.refuse(caught);
      setError(refusal);
      toast(refusal, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    // `noValidate`: the contract speaks for the form, so the browser's own
    // bubble never gets in ahead of it.
    <form class="pk pk-stack" noValidate onSubmit={(event) => void save(event)} {...form.handlers}>
      <PanelHeader title="Form availability" headingLevel={3}>
        <EditActions
          label="Form availability actions"
          editing={editing}
          saving={saving}
          saveLabel="Save availability"
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
      {editing ? (
        <>
          {/* One disabled fieldset takes every control out of play while the save
          is in flight, rather than each deciding for itself. The submit stays
          outside it so the button the reader just pressed keeps focus instead
          of being disabled from under them. */}
          <fieldset class="pk-fieldset pk-stack" disabled={saving}>
            <div class="pk-grid pk-grid--tight">
              <Field
                label="Audience"
                required
                help="Who this form is offered to, in the words readers will see."
                {...form.of("audience")}
              >
                {(control) => (
                  <TextInput
                    {...control}
                    name="audience"
                    value={draft.audience}
                    maxLength={100}
                    onInput={(event) => set("audience", event.currentTarget.value)}
                  />
                )}
              </Field>
              <SubmissionWindowFields
                timeZone={timeZone}
                opensAt={draft.opensAt}
                closesAt={draft.closesAt}
                onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
                fieldProps={{ opensAt: form.of("opensAt"), closesAt: form.of("closesAt") }}
              />
            </div>
            <Checkbox
              id={activeId}
              name="active"
              checked={draft.active}
              onChange={(event) => set("active", event.currentTarget.checked)}
              label="Accept responses while within the availability window"
            />
          </fieldset>
        </>
      ) : (
        <DescriptionList
          items={[
            { term: "Audience", value: placement.audience },
            { term: "Responses", value: placement.active ? "Accepted within the submission window" : "Paused" },
            { term: "Opens", value: placement.opensAt ? formatDateTime(placement.opensAt) : "No opening restriction" },
            {
              term: "Closes",
              value: placement.closesAt ? formatDateTime(placement.closesAt) : "No closing restriction",
            },
            { term: "Time zone", value: timeZone },
          ]}
        />
      )}
      {/* The failure is a block with role="alert", not a coloured span: the
          words have to reach a reader who cannot separate the red. */}
      {error && <Alert tone="danger">{error}</Alert>}
    </form>
  );
}
