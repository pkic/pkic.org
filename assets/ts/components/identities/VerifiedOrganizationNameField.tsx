/** The same verified-domain organization field in the direct form and the add dialog. */
import type { FieldPresentation } from "../../hooks/useContractForm";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextControl";

export function VerifiedOrganizationNameField({
  domain,
  value,
  disabled,
  onChange,
  validation,
}: {
  domain: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  validation: FieldPresentation;
}) {
  return (
    <Field
      label="Organization name"
      required
      help={domain ? `This organization will be associated with your verified email domain ${domain}.` : undefined}
      {...validation}
    >
      {(control) => (
        <TextInput
          {...control}
          name="organizationName"
          autoComplete="organization"
          value={value}
          disabled={disabled}
          onInput={(event) => onChange(event.currentTarget.value)}
        />
      )}
    </Field>
  );
}
