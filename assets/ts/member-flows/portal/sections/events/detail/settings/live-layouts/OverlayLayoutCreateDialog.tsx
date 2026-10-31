import { useState } from "preact/hooks";
import {
  eventLiveOverlayLayoutPutSchema,
  eventLiveOverlayLayoutsResponseSchema,
  type EventLiveOverlayLayoutsResponse,
  type LiveOverlayLayout,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { putJson } from "../../../../../../../shared/api-client";
import { Alert } from "../../../../../../../ui/Alert";
import { Dialog } from "../../../../../../../ui/Dialog";
import { Field } from "../../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../../ui/TextControl";
import { layoutSlugFor } from "./overlay-layout-slug";

/**
 * A new layout, started from any of the event's layouts: a built-in one, or
 * one to duplicate. It is saved at once, under a source name taken from its
 * name.
 */
export function OverlayLayoutCreateDialog({
  endpoint,
  layouts,
  from,
  duplicate,
  onCancel,
  onCreated,
}: {
  endpoint: string;
  layouts: readonly LiveOverlayLayout[];
  /** The layout it starts from, and whether it is a copy of that one. */
  from: LiveOverlayLayout;
  duplicate: boolean;
  onCancel: () => void;
  onCreated: (saved: EventLiveOverlayLayoutsResponse, slug: string) => void;
}) {
  const [name, setName] = useState(duplicate ? `Copy of ${from.name}` : "New layout");
  const [source, setSource] = useState(from.slug);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = layouts.find((layout) => layout.slug === source) ?? from;
  const slug = layoutSlugFor(name, new Set(layouts.map((layout) => layout.slug)));
  const form = useContractForm(eventLiveOverlayLayoutPutSchema, {
    expectedUpdatedAt: null,
    name,
    preset: start.preset,
    elements: start.elements,
  });
  async function create() {
    if (busy) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setBusy(true);
    try {
      onCreated(
        await putJson(`${endpoint}/${encodeURIComponent(slug)}`, checked.data, eventLiveOverlayLayoutsResponseSchema),
        slug,
      );
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title="New layout"
      description="Start from any layout, then arrange its elements."
      confirmLabel="Create layout"
      confirmDisabled={busy}
      onConfirm={() => void create()}
      onCancel={onCancel}
    >
      <form
        noValidate
        class="pk-stack"
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Field label="Name" help={`Browser sources name it “${slug}”.`} {...form.of("name")}>
          {(control) => (
            <TextInput
              {...control}
              name="name"
              value={name}
              maxLength={60}
              disabled={busy}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          )}
        </Field>
        <Field label="Start from">
          {(control) => (
            <Select
              {...control}
              name="startFrom"
              value={source}
              disabled={busy}
              onChange={(event) => setSource(event.currentTarget.value)}
            >
              {layouts.map((layout) => (
                <option key={layout.slug} value={layout.slug}>
                  {layout.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
