/** The existing own-identity form, hosted outside any surrounding registration form. */
import { createPortal } from "preact/compat";
import { useRef, useState } from "preact/hooks";
import { ButtonLink } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { addEmailAddressPath } from "../../shared/email-address-paths";
import { SelfIdentityCreateForm } from "./SelfIdentityCreateForm";

export function IdentityCreateDialog({
  open,
  userId,
  onCreated,
  onClose,
}: {
  open: boolean;
  userId: string;
  onCreated: (identityId: string) => Promise<void>;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  return createPortal(
    <Dialog
      open={open}
      title="Add identity"
      closeLabel="Close add identity"
      confirmLabel="Create"
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
            onCreated={async (result) => {
              await onCreated(result.identityId);
              onClose();
            }}
            emailAddressAction={
              <ButtonLink variant="link" external href={`/portal/#${addEmailAddressPath(userId)}`}>
                Add or verify an address
              </ButtonLink>
            }
          />
        )}
      </div>
    </Dialog>,
    document.body,
  );
}
