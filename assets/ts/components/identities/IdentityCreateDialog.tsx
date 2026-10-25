/** The existing own-identity form, hosted outside any surrounding registration form. */
import { createPortal } from "preact/compat";
import { useRef, useState } from "preact/hooks";
import { Dialog } from "../../ui/Dialog";
import { SelfIdentityCreateForm } from "./SelfIdentityCreateForm";

export function IdentityCreateDialog({
  open,
  onCreated,
  onClose,
}: {
  open: boolean;
  onCreated: (identityId: string) => Promise<void>;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [actionLabel, setActionLabel] = useState("Continue");
  return createPortal(
    <Dialog
      open={open}
      title="Add identity"
      closeLabel="Close add identity"
      confirmLabel={actionLabel}
      confirmDisabled={busy}
      onConfirm={() => root.current?.querySelector("form")?.requestSubmit()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      <div ref={root} onSubmit={(event) => event.stopPropagation()}>
        {open && (
          <SelfIdentityCreateForm
            onBusy={setBusy}
            onActionLabel={setActionLabel}
            onCreated={async (result) => {
              await onCreated(result.identityId);
              onClose();
            }}
          />
        )}
      </div>
    </Dialog>,
    document.body,
  );
}
