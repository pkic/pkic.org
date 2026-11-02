/** The existing own-identity form, hosted outside any surrounding registration form. */
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import { Dialog } from "../../ui/Dialog";
import { ManagedIdentityCreateForm } from "./ManagedIdentityCreateForm";
import { SelfIdentityCreateForm } from "./SelfIdentityCreateForm";

export function IdentityCreateDialog({
  open,
  onCreated,
  onClose,
  targetUserId,
  canActivate = false,
  preferImmediateActivation = false,
  onBusy,
}: {
  open: boolean;
  targetUserId?: string;
  canActivate?: boolean;
  preferImmediateActivation?: boolean;
  onBusy?: (busy: boolean) => void;
  onCreated: (identityId: string) => Promise<void>;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [actionLabel, setActionLabel] = useState("Continue");
  useEffect(() => onBusy?.(busy), [busy, onBusy]);
  const created = async (result: { identityId: string }) => {
    await onCreated(result.identityId);
    onClose();
  };
  return createPortal(
    <Dialog
      open={open}
      title="Add identity"
      closeLabel="Close add identity"
      confirmLabel={targetUserId ? "Add identity" : actionLabel}
      confirmDisabled={busy}
      onConfirm={() => root.current?.querySelector("form")?.requestSubmit()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      <div ref={root} onSubmit={(event) => event.stopPropagation()}>
        {open &&
          (targetUserId ? (
            <ManagedIdentityCreateForm
              userId={targetUserId}
              canActivate={canActivate}
              preferImmediateActivation={preferImmediateActivation}
              onBusy={setBusy}
              onCreated={created}
            />
          ) : (
            <SelfIdentityCreateForm onBusy={setBusy} onActionLabel={setActionLabel} onCreated={created} />
          ))}
      </div>
    </Dialog>,
    document.body,
  );
}
