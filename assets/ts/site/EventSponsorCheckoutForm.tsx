import { Field } from "../ui/Field";
import { TextInput, Select } from "../ui/TextControl";
import { Button } from "../ui/Button";

/** Published controls enhanced by the canonical event sponsorship checkout controller. */
export function EventSponsorCheckoutForm({ slug }: { slug: string }) {
  return (
    <div
      class="pk"
      data-event-sponsor-checkout
      data-module="member-flows/event-sponsor-page"
      data-api-base="/api/v1"
      data-event-slug={slug}
    >
      <div data-flow-status class="pk-alert pk-sr-only" role="alert" aria-live="polite" />
      <form id="sponsorCheckoutForm" class="pk-form needs-validation" noValidate>
        <Field id="sponsorTier" label="Sponsorship tier" errorSlot="tier" required>
          {(control) => (
            <Select {...control} name="tier" required disabled>
              <option value="" selected disabled>
                Loading sponsorship options…
              </option>
            </Select>
          )}
        </Field>
        <div class="pk-grid">
          <Field id="sponsorFirstName" label="First Name" errorSlot="firstName" required>
            {(control) => <TextInput {...control} name="firstName" autoComplete="given-name" required />}
          </Field>
          <Field id="sponsorLastName" label="Last Name" errorSlot="contactName" required>
            {(control) => <TextInput {...control} name="lastName" autoComplete="family-name" required />}
          </Field>
        </div>
        <Field id="sponsorEmail" label="Email" errorSlot="contactEmail" required>
          {(control) => <TextInput {...control} name="email" type="email" autoComplete="email" required />}
        </Field>
        <Field id="sponsorOrganizationName" label="Organization Name" errorSlot="organizationName">
          {(control) => <TextInput {...control} name="organizationName" autoComplete="organization" />}
        </Field>
        <div class="pk-stack pk-stack--snug">
          <div class="pk-cluster">
            <Button type="submit" disabled>
              Sponsor Now →
            </Button>
          </div>
          <p class="pk-small">
            You’ll be redirected to Stripe to complete payment securely. Access is granted once our team confirms your
            sponsorship.
          </p>
        </div>
      </form>
    </div>
  );
}
