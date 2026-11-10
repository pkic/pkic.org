/**
 * Pairing a screen: staff read the pairing code and screen ID off the
 * screen, say where it stands and, if they know it yet, what it shows.
 */
import { useState } from "preact/hooks";
import {
  SCREEN_PAIRING_CODE_LENGTH,
  eventScreenPairingCreateSchema,
  type ScreenRecord,
} from "../../../../../../../shared/schemas/event-screens";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import type { CollectionLoader } from "../../../../../../hooks/useServerCollection";
import { Alert } from "../../../../../../ui/Alert";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { FormSection } from "../../../../../../ui/FormSection";
import { TextInput } from "../../../../../../ui/TextControl";
import {
  EMPTY_SCREEN_ASSIGNMENT,
  ScreenAssignmentFields,
  screenAssignmentBody,
  type ScreenAssignmentDraft,
} from "./ScreenAssignmentFields";
import { pairScreen } from "./screen-requests";

interface PairDraft {
  screenId: string;
  pairingCode: string;
  name: string;
  assignment: ScreenAssignmentDraft;
}

const EMPTY_DRAFT: PairDraft = { screenId: "", pairingCode: "", name: "", assignment: EMPTY_SCREEN_ASSIGNMENT };

export function ScreenPairDialog({
  open,
  slug,
  onPaired,
  onClose,
  load,
}: {
  open: boolean;
  slug: string;
  onPaired: (screen: ScreenRecord) => void | Promise<void>;
  onClose: () => void;
  /** Reads the room choices; the gallery hands in its own. */
  load?: CollectionLoader;
}) {
  const [draft, setDraft] = useState<PairDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(eventScreenPairingCreateSchema, {
    screenId: draft.screenId,
    pairingCode: draft.pairingCode,
    name: draft.name,
    // Left unassigned, a screen paired again in this event keeps what it showed.
    assignment: screenAssignmentBody(draft.assignment) ?? undefined,
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
      const screen = await pairScreen(slug, checked.data);
      setDraft(EMPTY_DRAFT);
      form.reset();
      onClose();
      await onPaired(screen);
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Pair screen"
      description="Copy the pairing code and screen ID from the screen."
      closeLabel="Close pairing"
      confirmLabel={busy ? "Pairing…" : "Pair screen"}
      confirmDisabled={busy}
      onConfirm={() => void submit()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      {/* The sections own the rhythm between them; a stack gap would double it. */}
      <form
        noValidate
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormSection title="The screen">
          <Field
            label="Pairing code"
            required
            help={`The large code, ${String(SCREEN_PAIRING_CODE_LENGTH)} characters.`}
            {...form.of("pairingCode")}
          >
            {(control) => (
              <TextInput
                {...control}
                name="pairingCode"
                value={draft.pairingCode}
                autocomplete="off"
                autocapitalize="characters"
                spellcheck={false}
                maxLength={SCREEN_PAIRING_CODE_LENGTH + 2}
                onInput={(event) => setDraft({ ...draft, pairingCode: event.currentTarget.value })}
              />
            )}
          </Field>
          <Field label="Screen ID" required help="Shown next to the code." {...form.of("screenId")}>
            {(control) => (
              <TextInput
                {...control}
                name="screenId"
                value={draft.screenId}
                autocomplete="off"
                autocapitalize="characters"
                spellcheck={false}
                onInput={(event) => setDraft({ ...draft, screenId: event.currentTarget.value })}
              />
            )}
          </Field>
          <Field label="Name" required help="Where it stands, such as “Foyer, by registration”." {...form.of("name")}>
            {(control) => (
              <TextInput
                {...control}
                name="name"
                value={draft.name}
                onInput={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
              />
            )}
          </Field>
        </FormSection>
        <ScreenAssignmentFields
          slug={slug}
          draft={draft.assignment}
          load={load}
          fields={form.of}
          onChange={(patch) => setDraft({ ...draft, assignment: { ...draft.assignment, ...patch } })}
        />
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
    </Dialog>
  );
}
