import { useState } from "preact/hooks";
import {
  eventLiveOverlayLayoutPutSchema,
  type EventLiveOverlayLayoutPut,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { Dialog } from "../../../../../../../ui/Dialog";
import { Field } from "../../../../../../../ui/Field";
import { TextInput } from "../../../../../../../ui/TextControl";

/**
 * A new name for the scene being edited. It joins the scene's other unsaved
 * changes, checked by the same contract the save sends; the name browser
 * sources use for the scene never changes.
 */
export function OverlayLayoutRenameDialog({
  scene,
  slug,
  onCancel,
  onRename,
}: {
  /** The scene's draft as the save would send it. */
  scene: EventLiveOverlayLayoutPut;
  slug: string;
  onCancel: () => void;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState(scene.name);
  const form = useContractForm(eventLiveOverlayLayoutPutSchema, { ...scene, name });
  const rename = () => {
    if (form.submit().data) onRename(name.trim());
  };
  return (
    <Dialog
      open
      title="Rename scene"
      description="The new name joins your other changes; save the scene to keep it."
      confirmLabel="Rename"
      onConfirm={rename}
      onCancel={onCancel}
    >
      <form
        noValidate
        class="pk-stack"
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          rename();
        }}
      >
        <Field label="Name" help={`Browser sources keep naming it “${slug}”.`} {...form.of("name")}>
          {(control) => (
            <TextInput
              {...control}
              name="name"
              value={name}
              maxLength={60}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
