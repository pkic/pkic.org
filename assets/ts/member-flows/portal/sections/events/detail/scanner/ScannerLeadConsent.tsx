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
    <Field label="Attendee permission" labelHidden {...field} required group>
      {(control) => (
        <Checkbox
          {...control}
          name="consentConfirmed"
          checked={confirmed}
          onChange={(event) => onChange(event.currentTarget.checked)}
          label="I will ask permission before scanning each attendee’s badge."
        />
      )}
    </Field>
  );
}
