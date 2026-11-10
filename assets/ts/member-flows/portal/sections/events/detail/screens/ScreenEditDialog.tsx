/** Renaming or reassigning a paired screen, from the revision the list showed. */
import { useState } from "preact/hooks";
import {
  screenUpdateSchema,
  type ScreenRecord,
  type ScreenUpdate,
} from "../../../../../../../shared/schemas/event-screens";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../ui/Alert";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import {
  ScreenAssignmentFields,
  screenAssignmentBody,
  screenAssignmentDraft,
  type ScreenLayoutChoice,
  type ScreenRoomChoice,
} from "./ScreenAssignmentFields";

export function ScreenEditDialog({
  screen,
  rooms,
  layouts,
  onSave,
  onClose,
}: {
  screen: ScreenRecord;
  rooms: readonly ScreenRoomChoice[];
  layouts: readonly ScreenLayoutChoice[];
  onSave: (screen: ScreenRecord, body: ScreenUpdate) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(screen.name);
  const [assignment, setAssignment] = useState(() => screenAssignmentDraft(screen.assignment));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(screenUpdateSchema, {
    expectedRevision: screen.revision,
    name,
    assignment: screenAssignmentBody(assignment),
  });

  async function submit() {
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(screen, checked.data);
      onClose();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={`Edit “${screen.name}”`}
      meta={`Screen ID ${screen.id}`}
      closeLabel="Close screen"
      confirmLabel={busy ? "Saving…" : "Save screen"}
      confirmDisabled={busy}
      onConfirm={() => void submit()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      <form
        noValidate
        class="pk-stack"
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Name" required help="Where it stands, such as “Foyer, by registration”." {...form.of("name")}>
          {(control) => (
            <TextInput {...control} name="name" value={name} onInput={(event) => setName(event.currentTarget.value)} />
          )}
        </Field>
        <ScreenAssignmentFields
          draft={assignment}
          rooms={rooms}
          layouts={layouts}
          fields={form.of}
          onChange={(patch) => setAssignment({ ...assignment, ...patch })}
        />
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
