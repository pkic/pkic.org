import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { IconPlus } from "../../../../../../../components/icons";
import { Button } from "../../../../../../../ui/Button";

/**
 * A panel's create action, in its header at the end: the system's icon-only
 * "+" (as on a collection toolbar), named and with a tooltip, which opens
 * what creates the item.
 */
export function StudioCreateAction({
  label,
  disabled = false,
  children,
}: {
  /** What it creates, as an action: "Add person", "Add timer". */
  label: string;
  disabled?: boolean;
  /** The dialog or form it opens; `close` closes it again. */
  children: (close: () => void) => ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="primary"
        icon
        aria-label={label}
        title={label}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <IconPlus />
      </Button>
      {open ? children(() => setOpen(false)) : null}
    </>
  );
}
