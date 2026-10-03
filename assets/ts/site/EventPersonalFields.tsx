import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";

/** The same personal-detail controls across event management forms. */
export function EventPersonalFields({ prefix }: { prefix: string }) {
  return (
    <div class="pk-stack pk-stack--snug">
      <div class="pk-grid">
        <Field id={`${prefix}-first-name`} label="First name" errorSlot="firstName">
          {(control) => <TextInput {...control} name="firstName" autoComplete="given-name" />}
        </Field>
        <Field id={`${prefix}-last-name`} label="Last name" errorSlot="lastName">
          {(control) => <TextInput {...control} name="lastName" autoComplete="family-name" />}
        </Field>
      </div>
      <Field id={`${prefix}-org`} label="Organization (optional)" errorSlot="organizationName">
        {(control) => <TextInput {...control} name="organizationName" autoComplete="organization" />}
      </Field>
      <Field id={`${prefix}-job`} label="Job title (optional)" errorSlot="jobTitle">
        {(control) => <TextInput {...control} name="jobTitle" autoComplete="organization-title" />}
      </Field>
    </div>
  );
}
