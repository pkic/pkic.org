import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";

/** Uses the scanner's existing canonical form; no separate manual protocol. */
export function ScannerManualEntry({
  focusRequested,
  onFocusHandled,
  badgeId,
  onBadge,
  field,
  children,
}: {
  focusRequested: boolean;
  onFocusHandled: () => void;
  badgeId: string;
  onBadge: (code: string) => void;
  field: FieldPresentation;
  children?: ComponentChildren;
}) {
  const manual = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusRequested) {
      manual.current?.querySelector<HTMLInputElement>("input")?.focus();
      onFocusHandled();
    }
  }, [focusRequested, onFocusHandled]);
  return (
    <section ref={manual}>
      <h3>Enter or paste badge code</h3>
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
        {children}
      </div>
    </section>
  );
}
