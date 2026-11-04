import { ScannerAttendeeSearch } from "./ScannerAttendeeSearch";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { SectionHeading } from "../../../../../../ui/SectionHeading";

/** Uses the scanner's existing canonical form; no separate manual protocol. */
export function ScannerManualEntry({
  focusRequested,
  onFocusHandled,
  badgeId,
  onBadge,
  field,
  children,
  lookup,
}: {
  focusRequested: boolean;
  onFocusHandled: () => void;
  badgeId: string;
  onBadge: (code: string) => void;
  field: FieldPresentation;
  children?: ComponentChildren;
  lookup?: { slug: string; online: boolean; disabled: boolean };
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
      <SectionHeading level={3}>{lookup?.online ? "Find an attendee" : "Enter badge code"}</SectionHeading>
      <div class="pk-form">
        <p>
          {lookup?.online
            ? "Search for an attendee or enter the code printed on their badge."
            : "Type or paste the badge code printed below the QR. Spaces and hyphens are optional."}
        </p>
        {lookup && !lookup.online && (
          <p role="status">Offline: use a badge code. Name, email, and organization search needs a connection.</p>
        )}
        <Field label={lookup?.online ? "Badge code or attendee" : "Badge code"} {...field}>
          {(control) =>
            lookup?.online ? (
              <ScannerAttendeeSearch
                slug={lookup.slug}
                control={control}
                onBadge={onBadge}
                disabled={lookup.disabled}
              />
            ) : (
              <TextInput
                {...control}
                name="badgeId"
                value={badgeId}
                onInput={(event) => onBadge(event.currentTarget.value)}
                autoComplete="off"
              />
            )
          }
        </Field>
        {children}
      </div>
    </section>
  );
}
