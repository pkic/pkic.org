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
      <div class="pk-form">
        <p>Type or paste the badge code printed below the QR. Spaces and hyphens are optional.</p>
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
        <div class="pk-cluster">
          <Button type="submit" loading={busy}>
            {scannerActionLabel(action)}
          </Button>
        </div>
      </div>
    </details>
  );
}
