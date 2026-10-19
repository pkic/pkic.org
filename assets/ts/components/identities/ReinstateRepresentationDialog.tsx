/**
 * Undoes an end made by mistake: the quick action behind "Reinstate
 * representation…" on a past identity.
 *
 * Reinstating removes the end date from the same identity, so what the end
 * closed comes back. A manager does it directly. The owner first proves
 * their address at the organization is still theirs: the action sends a
 * link to it, and following the link reinstates, so this dialog only sends it.
 */
import { useState } from "preact/hooks";

import { Alert } from "../../ui/Alert";
import { Dialog } from "../../ui/Dialog";

function reinstateRepresentationCopy(organizationName: string, subjectName: string | null, emailAddress: string) {
  const own = subjectName === null;
  const their = own ? "Your" : "Their";
  return {
    title: own
      ? `Reinstate your representation of ${organizationName}?`
      : `Reinstate ${subjectName}'s representation of ${organizationName}?`,
    description: own
      ? `To confirm you still work there, we'll email a link to ${emailAddress}. Following it removes the end date.`
      : "The end date is removed, as if the representation never ended.",
    consequences: [
      `${their} permissions and roles through ${organizationName} return`,
      `${their} group seats for ${organizationName} reopen`,
    ],
    confirmLabel: own ? "Send link" : "Reinstate",
    busyLabel: own ? "Sending…" : "Reinstating…",
  };
}

export function ReinstateRepresentationDialog({
  organizationName,
  subjectName,
  emailAddress,
  onReinstate,
  onClose,
}: {
  organizationName: string;
  /** The person whose representation returns; null when it is the viewer's own. */
  subjectName: string | null;
  /** The identity's address, where the owner's confirmation link goes. */
  emailAddress: string;
  /** Reinstates it, or for the owner sends the link; a refusal is thrown and shown here. */
  onReinstate: () => Promise<void>;
  onClose: () => void;
}) {
  const copy = reinstateRepresentationCopy(organizationName, subjectName, emailAddress);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function reinstate(): Promise<void> {
    setSaving(true);
    setError("");
    try {
      await onReinstate();
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title={copy.title}
      description={copy.description}
      consequences={copy.consequences}
      closeLabel="Close reinstate representation"
      confirmLabel={saving ? copy.busyLabel : copy.confirmLabel}
      confirmDisabled={saving}
      onConfirm={() => void reinstate()}
      onCancel={() => {
        if (!saving) onClose();
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
    </Dialog>
  );
}
