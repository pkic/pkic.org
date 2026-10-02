import { Field } from "../ui/Field";
import { TextInput, Textarea, Select } from "../ui/TextControl";
import { Button } from "../ui/Button";

/** Published controls enhanced by the canonical sponsorship inquiry controller. */
export function SponsorshipInquiryForm() {
  return (
    <div class="pk" data-sponsor-inquiry data-module="member-flows/sponsor-form">
      <div data-flow-status class="pk-alert pk-sr-only" role="alert" aria-live="polite" />
      <form id="inputForm" class="pk-form needs-validation" noValidate>
        <div class="pk-grid">
          <Field id="firstName" label="First Name" errorSlot="firstName" required>
            {(control) => <TextInput {...control} name="firstName" autoComplete="given-name" required />}
          </Field>
          <Field id="lastName" label="Last Name" errorSlot="contactName" required>
            {(control) => <TextInput {...control} name="lastName" autoComplete="family-name" required />}
          </Field>
        </div>
        <Field id="email" label="Email" errorSlot="contactEmail" required>
          {(control) => <TextInput {...control} name="email" type="email" autoComplete="email" required />}
        </Field>
        <Field id="organizationName" label="Organization Name" errorSlot="organizationName" required>
          {(control) => <TextInput {...control} name="organizationName" autoComplete="organization" required />}
        </Field>
        <Field id="organizationWebsite" label="Website" errorSlot="organizationWebsite">
          {(control) => (
            <TextInput {...control} name="organizationWebsite" type="url" autoComplete="url" placeholder="https://" />
          )}
        </Field>
        <Field
          id="tier"
          label="How would you like to sponsor?"
          errorSlot="tier"
          help="Not sure which option is right for you? Choose the contact option and we will help."
          required
        >
          {(control) => (
            <Select {...control} name="tier" required disabled>
              <option value="" selected disabled>
                Loading sponsorship options…
              </option>
            </Select>
          )}
        </Field>
        <Field id="comments" label="Comments" errorSlot="comments">
          {(control) => <Textarea {...control} name="comments" rows={3} />}
        </Field>
        <div class="pk-cluster">
          <Button type="submit">Submit your interest to sponsor the PKI Consortium</Button>
        </div>
      </form>
    </div>
  );
}
