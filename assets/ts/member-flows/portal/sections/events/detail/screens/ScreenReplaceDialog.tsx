/**
 * Replacing a screen's device, as after a reinstall that gave the device a
 * new screen ID: staff read the pairing code and screen ID off the new
 * device, and the screen keeps its name and assignment there. The current
 * device is signed out; while it is online it stops showing the screen.
 * When the new screen ID already belongs to a screen, as a reinstalled
 * device paired as a screen of its own, staff confirm it gives way. A device
 * signed in under that ID keeps its sign-in and shows no code to enter.
 * A device reinstalled under this screen's own ID pairs again in place.
 */
import { useState } from "preact/hooks";
import {
  SCREEN_ID_IN_USE_CODE,
  SCREEN_ID_TAKEN_CODE,
  screenDeviceReplacementSchema,
  type ScreenRecord,
} from "../../../../../../../shared/schemas/event-screens";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { ApiClientError } from "../../../../../../shared/api-client";
import { normalizeValidation } from "../../../../../../shared/form/validation-map";
import { Alert } from "../../../../../../ui/Alert";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Dialog } from "../../../../../../ui/Dialog";
import { ScreenCodeFields } from "./ScreenCodeFields";
import { isScreenRevisionConflict, readScreenRecord, replaceScreenDevice } from "./screen-requests";

const CONFLICT_NOTICE =
  "Someone changed this screen while this was open. Its latest details are shown; replace again to go ahead.";

export function ScreenReplaceDialog({
  screen: initial,
  online,
  onReplaced,
  onChanged,
  onClose,
}: {
  screen: ScreenRecord;
  /** The current device shows the screen now. */
  online: boolean;
  onReplaced: (screen: ScreenRecord) => void | Promise<void>;
  /** The screen changed since the list showed it; the list reads it again. */
  onChanged: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [screen, setScreen] = useState(initial);
  const [conflict, setConflict] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [newScreenId, setNewScreenId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** The screen ID the server said another screen has, so replacing it is offered for that ID only. */
  const [taken, setTaken] = useState<{ screenId: string; signedIn: boolean } | null>(null);
  const [replace, setReplace] = useState(false);
  const takenHere = taken !== null && taken.screenId === newScreenId ? taken : null;
  const form = useContractForm(screenDeviceReplacementSchema, {
    expectedRevision: screen.revision,
    newScreenId,
    pairingCode: pairingCode || undefined,
    replace: replace && takenHere ? true : undefined,
  });

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
      const replaced = await replaceScreenDevice(screen.id, checked.data);
      onClose();
      await onReplaced(replaced);
    } catch (cause) {
      if (!isScreenRevisionConflict(cause)) {
        const message = form.refuse(cause);
        if (
          cause instanceof ApiClientError &&
          (cause.code === SCREEN_ID_TAKEN_CODE || cause.code === SCREEN_ID_IN_USE_CODE)
        ) {
          // The screen ID field names the screen, and the choice to replace it opens below.
          setTaken({ screenId: newScreenId, signedIn: cause.code === SCREEN_ID_IN_USE_CODE });
        } else if (Object.keys(normalizeValidation(cause).fields).length === 0) {
          // A field's own message already says why; the alert is for the rest.
          setError(message);
        }
      } else {
        // The next attempt starts from the screen as it stands now, so it can succeed.
        void onChanged();
        try {
          setScreen(await readScreenRecord(screen.id));
          setConflict(true);
        } catch (reload) {
          setError(form.refuse(reload));
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={`Replace device for “${screen.name}”`}
      meta={`Screen ID ${screen.id}`}
      description={
        screen.session.state === "active"
          ? "Use the code on the new device. This screen's name and assignment move to it, and the current device is signed out."
          : "Use the code on the new device. This screen's name and assignment move to it."
      }
      closeLabel="Close replace device"
      confirmLabel={busy ? "Replacing…" : "Replace device"}
      confirmDisabled={busy}
      onConfirm={() => void submit()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      {conflict && <Alert tone="warn">{CONFLICT_NOTICE}</Alert>}
      {online && <Alert tone="warn">The current device is online. It stops showing this screen within a minute.</Alert>}
      <form
        noValidate
        class="pk-stack"
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ScreenCodeFields
          pairingCode={pairingCode}
          screenId={newScreenId}
          idName="newScreenId"
          fields={form.of}
          onPairingCode={setPairingCode}
          onScreenId={(value) => {
            setNewScreenId(value);
            setReplace(false);
          }}
          codeRequired={!(takenHere?.signedIn && replace)}
        >
          {takenHere && (
            <Checkbox
              label="Replace the screen with this ID"
              hint={
                takenHere.signedIn
                  ? "This screen's name and assignment take its place. Its device stays signed in."
                  : "This screen's name and assignment take its place."
              }
              checked={replace}
              onChange={(event) => setReplace(event.currentTarget.checked)}
            />
          )}
        </ScreenCodeFields>
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
    </Dialog>
  );
}
