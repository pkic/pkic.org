import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Field } from "../../../../../../ui/Field";

export interface ScannerLeadConsentProps {
  confirmed: boolean;
  field: FieldPresentation;
  onChange: (confirmed: boolean) => void;
}

/** One operator acknowledgement gates this lead scanner run. */
export function ScannerLeadConsent({ confirmed, field, onChange }: ScannerLeadConsentProps) {
  return (
    <Field label="Before you start" {...field} required group>
      {(control) => (
        <Checkbox
          {...control}
          name="consentConfirmed"
          checked={confirmed}
          onChange={(event) => onChange(event.currentTarget.checked)}
          label="I will ask each attendee for permission before scanning."
        />
      )}
    </Field>
  );
}
