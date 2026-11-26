import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { ContractForm } from "../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../ui/Alert";
import { Dialog } from "../../../../../../ui/Dialog";
import { LIVE_SETTINGS_FOR_EVENT, useStillOpen } from "./live-graphic-settings";

/**
 * A graphic's settings dialog from its row: the fields, checked by the
 * graphic's contract, then saved for the event where the operator sets up
 * the studio and applied to every output that shows the graphic. A save the
 * studio or room refused keeps the dialog open with the reason. A save that
 * finishes after this dialog closed neither reports nor closes a newer one.
 */
export function LiveGraphicSettingsDialog<Settings>({
  title,
  saves,
  size,
  confirmLabel = "Save",
  formClass = "pk-stack",
  form,
  save,
  onClose,
  children,
}: {
  title: string;
  /** Whether saving also sets up every room of the event. */
  saves: boolean;
  size?: "wide";
  confirmLabel?: string;
  formClass?: string;
  form: ContractForm<Settings>;
  /** Saves the checked settings; the problem to show, or null once done. */
  save: (settings: Settings) => Promise<string | null>;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const [error, setError] = useState<string | null>(null);
  const open = useStillOpen();
  return (
    <Dialog
      open
      size={size}
      title={title}
      description={saves ? LIVE_SETTINGS_FOR_EVENT : undefined}
      confirmLabel={confirmLabel}
      onConfirm={() => {
        const checked = form.submit();
        if (!checked.data) return setError(checked.formMessage);
        void save(checked.data).then((problem) => {
          if (!open.current) return;
          if (problem) setError(problem);
          else onClose();
        });
      }}
      onCancel={onClose}
    >
      <form noValidate {...form.handlers} class={formClass} onSubmit={(event) => event.preventDefault()}>
        {children}
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </form>
    </Dialog>
  );
}
