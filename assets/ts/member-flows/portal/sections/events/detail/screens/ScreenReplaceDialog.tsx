/**
 * Replacing a screen's device, as after a reinstall that gave the device a
 * new screen ID: staff read the pairing code and screen ID off the new
 * device, and the screen keeps its name and assignment there. The current
 * device is signed out; while it is online it stops showing the screen.
 */
import { useState } from "preact/hooks";
import { screenDeviceReplacementSchema, type ScreenRecord } from "../../../../../../../shared/schemas/event-screens";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../ui/Alert";
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
  const form = useContractForm(screenDeviceReplacementSchema, {
    expectedRevision: screen.revision,
    newScreenId,
    pairingCode,
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
      if (!isScreenRevisionConflict(cause)) setError(form.refuse(cause));
      else {
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
          onScreenId={setNewScreenId}
        />
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
    </Dialog>
  );
}
