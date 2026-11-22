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
    <Field label="Permission to collect information" labelHidden {...field} required group>
      {(control) => (
        <Checkbox
          {...control}
          name="consentConfirmed"
          checked={confirmed}
          onChange={(event) => onChange(event.currentTarget.checked)}
          label="I will ask each person for permission to collect their contact information before scanning their badge."
        />
      )}
    </Field>
  );
}
