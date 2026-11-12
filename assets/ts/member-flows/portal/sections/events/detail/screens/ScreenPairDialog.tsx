/**
 * Pairing a screen: staff read the pairing code and screen ID off the
 * screen, say where it stands and, if they know it yet, what it shows.
 */
import { useState } from "preact/hooks";
import {
  SCREEN_ID_IN_USE_CODE,
  eventScreenPairingCreateSchema,
  type ScreenRecord,
} from "../../../../../../../shared/schemas/event-screens";
import { ApiClientError } from "../../../../../../shared/api-client";
import { Checkbox } from "../../../../../../ui/Checkbox";
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
import { ScreenCodeFields } from "./ScreenCodeFields";
import { pairScreen } from "./screen-requests";

interface PairDraft {
  screenId: string;
  pairingCode: string;
  name: string;
  assignment: ScreenAssignmentDraft;
  /** Confirmed after the server said a signed-in screen has this ID. */
  replace: boolean;
}

const EMPTY_DRAFT: PairDraft = {
  screenId: "",
  pairingCode: "",
  name: "",
  assignment: EMPTY_SCREEN_ASSIGNMENT,
  replace: false,
};

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
  /** The screen ID the server said is signed in, so replacing it is offered for that ID only. */
  const [inUse, setInUse] = useState<string | null>(null);
  const form = useContractForm(eventScreenPairingCreateSchema, {
    screenId: draft.screenId,
    pairingCode: draft.pairingCode,
    name: draft.name,
    // Left unassigned, a screen paired again in this event keeps what it showed.
    assignment: screenAssignmentBody(draft.assignment) ?? undefined,
    replace: draft.replace && inUse === draft.screenId ? true : undefined,
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
      if (cause instanceof ApiClientError && cause.code === SCREEN_ID_IN_USE_CODE) setInUse(draft.screenId);
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
          <ScreenCodeFields
            pairingCode={draft.pairingCode}
            screenId={draft.screenId}
            idName="screenId"
            fields={form.of}
            onPairingCode={(pairingCode) => setDraft({ ...draft, pairingCode })}
            onScreenId={(screenId) => setDraft({ ...draft, screenId, replace: false })}
          >
            {inUse !== null && inUse === draft.screenId && (
              <Checkbox
                label="Replace the signed-in screen"
                hint="It signs out and this screen takes its place."
                checked={draft.replace}
                onChange={(event) => setDraft({ ...draft, replace: event.currentTarget.checked })}
              />
            )}
          </ScreenCodeFields>
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
