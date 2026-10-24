import { useState } from "preact/hooks";
import { UserPicker, type PickedUser } from "../../components/UserPicker";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { Field } from "../Field";
import type { PreviewSection } from "./PreviewShell";

function AgendaPickerSpecimen() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<PickedUser | null>(null);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Edit speakers</Button>
      <Dialog
        open={open}
        title="Session speakers"
        confirmLabel="Save session"
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      >
        <p>Find an existing user within a dialog.</p>
        <Field label="Add speaker">
          {(control) => <UserPicker value={value} onChange={setValue} endpoint="/api/v1/users" inputProps={control} />}
        </Field>
      </Dialog>
    </>
  );
}

export const agendaPickerSections: PreviewSection[] = [
  {
    id: "agenda-picker",
    title: "Autocomplete in a dialog",
    note: "The shared picker stays attached to its field when the visible viewport changes.",
    render: () => <AgendaPickerSpecimen />,
  },
];
