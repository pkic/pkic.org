/**
 * Renaming or reassigning a paired screen, from the revision the list showed.
 * When someone else changed the screen first, the dialog reads it again,
 * shows the latest values and says so, so nothing is overwritten unseen.
 */
import { useState } from "preact/hooks";
import { screenUpdateSchema, type ScreenRecord } from "../../../../../../../shared/schemas/event-screens";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import type { CollectionLoader } from "../../../../../../hooks/useServerCollection";
import { Alert } from "../../../../../../ui/Alert";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { ScreenAssignmentFields, screenAssignmentBody, screenAssignmentDraft } from "./ScreenAssignmentFields";
import { isScreenRevisionConflict, readScreenRecord, updateScreen } from "./screen-requests";

const CONFLICT_NOTICE =
  "Someone changed this screen while you were editing it. Its latest details are shown; save again to replace them.";

export function ScreenEditDialog({
  slug,
  screen: initial,
  onSaved,
  onChanged,
  onClose,
  load,
}: {
  slug: string;
  screen: ScreenRecord;
  onSaved: (screen: ScreenRecord) => void | Promise<void>;
  /** The screen changed under the editor; the list reads it again. */
  onChanged: () => void | Promise<void>;
  onClose: () => void;
  load?: CollectionLoader;
}) {
  const [screen, setScreen] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [assignment, setAssignment] = useState(() => screenAssignmentDraft(initial.assignment));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const form = useContractForm(screenUpdateSchema, {
    expectedRevision: screen.revision,
    name,
    assignment: screenAssignmentBody(assignment),
  });

  async function rebase() {
    const latest = await readScreenRecord(screen.id);
    setScreen(latest);
    setName(latest.name);
    setAssignment(screenAssignmentDraft(latest.assignment));
    form.reset();
    setConflict(true);
    void onChanged();
  }

  async function submit() {
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      const saved = await updateScreen(screen.id, checked.data);
      onClose();
      await onSaved(saved);
    } catch (cause) {
      if (isScreenRevisionConflict(cause)) {
        try {
          await rebase();
        } catch (reload) {
          setError(form.refuse(reload));
        }
      } else setError(form.refuse(cause));
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
      {conflict && <Alert tone="warn">{CONFLICT_NOTICE}</Alert>}
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
          slug={slug}
          draft={assignment}
          load={load}
          fields={form.of}
          onChange={(patch) => setAssignment({ ...assignment, ...patch })}
        />
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
    </Dialog>
  );
}
