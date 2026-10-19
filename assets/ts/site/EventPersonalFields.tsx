import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";

/** The same personal-detail controls across event management forms; organization and title come from identities. */
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
    </div>
  );
}
