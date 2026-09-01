import { useState } from "preact/hooks";
import {
  groupFormDefinitionResponseSchema,
  groupFormPlacementUpdateSchema,
  type GroupFormPlacementUpdateInput,
} from "../../../../../shared/schemas/group-forms";
import type { FormPlacement } from "../../../../../shared/schemas/forms";
import { patchJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { TextInput } from "../../../../ui/TextControl";
import { toast } from "../../ui";

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isoDateTime(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
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
  const [audience, setAudience] = useState(placement.audience);
  const [active, setActive] = useState(placement.active);
  const [opensAt, setOpensAt] = useState(localDateTime(placement.opensAt));
  const [closesAt, setClosesAt] = useState(localDateTime(placement.closesAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const activeId = `form-placement-active-${placement.id}`;

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const input: GroupFormPlacementUpdateInput = groupFormPlacementUpdateSchema.parse({
        audience,
        active,
        opensAt: isoDateTime(opensAt),
        closesAt: isoDateTime(closesAt),
      });
      await patchJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/forms/${encodeURIComponent(placement.id)}`,
        input,
        groupFormDefinitionResponseSchema,
      );
      toast("Form availability updated", "success");
      await onSaved();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class="pk pk-stack" onSubmit={(event) => void save(event)}>
      {/* One disabled fieldset takes every control out of play while the save
          is in flight, rather than each deciding for itself. The submit stays
          outside it so the button the reader just pressed keeps focus instead
          of being disabled from under them. */}
      <fieldset class="pk-fieldset pk-stack" disabled={saving}>
        <div class="pk-grid pk-grid--tight">
          <Field label="Audience" required help="Who this form is offered to, in the words readers will see.">
            {(control) => (
              <TextInput
                {...control}
                value={audience}
                maxLength={100}
                onInput={(event) => setAudience(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field label="Opens" help="Leave empty to accept responses from now.">
            {(control) => (
              <TextInput
                {...control}
                type="datetime-local"
                value={opensAt}
                onInput={(event) => setOpensAt(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field label="Closes" help="Leave empty to keep the form open indefinitely.">
            {(control) => (
              <TextInput
                {...control}
                type="datetime-local"
                value={closesAt}
                onInput={(event) => setClosesAt(event.currentTarget.value)}
              />
            )}
          </Field>
        </div>
        <label class="pk-check" for={activeId}>
          <input
            id={activeId}
            class="pk-check__input"
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.currentTarget.checked)}
          />
          <span class="pk-check__label">Accept responses while within the availability window</span>
        </label>
      </fieldset>
      <div class="pk-cluster">
        <Button type="submit" variant="primary" loading={saving}>
          {saving ? "Saving…" : "Save availability"}
        </Button>
      </div>
      {/* The failure is a block with role="alert", not a coloured span: the
          words have to reach a reader who cannot separate the red. */}
      {error && <Alert tone="danger">{error}</Alert>}
    </form>
  );
}
