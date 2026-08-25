import { useState } from "preact/hooks";
import {
  groupFormDefinitionResponseSchema,
  groupFormPlacementUpdateSchema,
  type GroupFormPlacementUpdateInput,
} from "../../../../../shared/schemas/group-forms";
import type { FormPlacement } from "../../../../../shared/schemas/forms";
import { patchJson } from "../../../../shared/api-client";
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
    <form class="row g-3" onSubmit={(event) => void save(event)}>
      <div class="col-md-6">
        <label class="form-label small fw-semibold">Audience</label>
        <input
          class="form-control form-control-sm"
          value={audience}
          required
          maxlength={100}
          onInput={(event) => setAudience((event.target as HTMLInputElement).value)}
        />
      </div>
      <div class="col-md-3">
        <label class="form-label small fw-semibold">Opens</label>
        <input
          type="datetime-local"
          class="form-control form-control-sm"
          value={opensAt}
          onInput={(event) => setOpensAt((event.target as HTMLInputElement).value)}
        />
      </div>
      <div class="col-md-3">
        <label class="form-label small fw-semibold">Closes</label>
        <input
          type="datetime-local"
          class="form-control form-control-sm"
          value={closesAt}
          onInput={(event) => setClosesAt((event.target as HTMLInputElement).value)}
        />
      </div>
      <div class="col-12">
        <div class="form-check">
          <input
            id={`form-placement-active-${placement.id}`}
            class="form-check-input"
            type="checkbox"
            checked={active}
            onChange={(event) => setActive((event.target as HTMLInputElement).checked)}
          />
          <label class="form-check-label" for={`form-placement-active-${placement.id}`}>
            Accept responses while within the availability window
          </label>
        </div>
      </div>
      <div class="col-12 d-flex gap-2 align-items-center">
        <button type="submit" class="btn btn-sm btn-success" disabled={saving}>
          {saving ? "Saving…" : "Save availability"}
        </button>
        {error && <span class="small text-danger">{error}</span>}
      </div>
    </form>
  );
}
