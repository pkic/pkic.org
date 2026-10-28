/** The same verified-domain organization field in the direct form and the add dialog. */
import { REGISTRATION_ORGANIZATION_COPY } from "../../../shared/email-first-copy";
import type { FieldPresentation } from "../../hooks/useContractForm";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextControl";

export function VerifiedOrganizationNameField({
  domain,
  reviewRequired,
  value,
  disabled,
  onChange,
  validation,
}: {
  domain: string;
  reviewRequired?: boolean;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  validation: FieldPresentation;
}) {
  return (
    <Field
      label="Organization name"
      required
      help={
        reviewRequired
          ? REGISTRATION_ORGANIZATION_COPY.pendingReviewHelp
          : domain
            ? `This organization will be associated with your verified email domain ${domain}.`
            : undefined
      }
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
