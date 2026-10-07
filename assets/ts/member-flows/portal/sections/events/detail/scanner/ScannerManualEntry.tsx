import { useEffect, useRef } from "preact/hooks";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { scannerActionLabel } from "./ScannerModeSelect";

/** Uses the scanner's existing canonical form; no separate manual protocol. */
export function ScannerManualEntry({
  open,
  onOpen,
  badgeId,
  onBadge,
  field,
  action,
  busy,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  badgeId: string;
  onBadge: (code: string) => void;
  field: FieldPresentation;
  action: EventScanRequest["action"];
  busy: boolean;
}) {
  const manual = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (open) manual.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [open]);
  return (
    <details ref={manual} open={open} onToggle={(event) => onOpen(event.currentTarget.open)}>
      <summary>Enter or paste badge code</summary>
      <p>
        Paste the full code from a PKI Consortium badge, or use a connected badge reader. Short codes are not available
        yet.
      </p>
      <Field label="Badge code" {...field}>
        {(control) => (
          <TextInput
            {...control}
            name="badgeId"
            value={badgeId}
            onInput={(event) => onBadge(event.currentTarget.value)}
            autoComplete="off"
          />
        )}
      </Field>
      <Button type="submit" loading={busy}>
        {scannerActionLabel(action)}
      </Button>
    </details>
  );
}
