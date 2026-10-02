/** Shared static and client-rendered donation controls. */
import { useId } from "preact/hooks";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Select, TextInput } from "../ui/TextControl";

export interface DonationWidgetOptions {
  extraClasses?: string;
  successPath?: string;
  cancelPath?: string;
  name?: string | null;
  email?: string | null;
  organizationName?: string | null;
  source?: string | null;
  hideIdentityFields?: boolean;
}

function IdentityFields() {
  return (
    <div class="pk-stack pk-stack--snug">
      <Field label="Full name" required>
        {(control) => (
          <TextInput {...control} data-donation-name-input placeholder="Your full name" autocomplete="name" />
        )}
      </Field>
      <Field label="Email">
        {(control) => (
          <TextInput
            {...control}
            type="email"
            data-donation-email-input
            placeholder="your@email.com"
            autocomplete="email"
          />
        )}
      </Field>
      <Field label="Organization (optional)">
        {(control) => (
          <TextInput
            {...control}
            data-donation-org-input
            placeholder="Your company or organization"
            autocomplete="organization"
          />
        )}
      </Field>
    </div>
  );
}

function CurrencyRow() {
  return (
    <Field label="Currency">
      {(control) => (
        <Select {...control} data-donation-currency>
          <option value="usd">USD ($) — US Dollar</option>
        </Select>
      )}
    </Field>
  );
}

function CompactCurrencySelect() {
  return (
    <Select data-donation-currency aria-label="Currency">
      <option value="usd">USD ($) — US Dollar</option>
    </Select>
  );
}

function SharedControls() {
  const prefixId = useId();

  return (
    <>
      {/* Empty by design: `initDonationForm` renders the preset buttons here
          with amounts converted into the selected currency. A second, static
          set of USD amounts in this file was both duplication and wrong the
          moment a donor picked another currency. */}
      <div class="pk-cluster" data-donation-presets />

      {/*
        The currency symbol is live: `initDonationForm` rewrites it whenever
        the donor picks another currency, and `Field` takes its label as a
        string, so the symbol cannot ride in the label. It sits in the control
        box in front of the amount instead, and the control describes itself
        by it, so a reader hears the field's name and then the currency it is
        in. The inner span is the one the behaviour rewrites; the space that
        keeps the symbol off the box stays outside it.
      */}
      <Field label="Or enter a custom amount">
        {(control) => (
          <>
            <span id={prefixId} class="pk-muted">
              <span data-donation-currency-prefix>$</span>&nbsp;
            </span>
            <TextInput
              {...control}
              type="number"
              data-donation-custom-input
              placeholder="Other amount"
              min={1}
              step={1}
              aria-describedby={prefixId}
            />
          </>
        )}
      </Field>

      <Button variant="primary" block data-donation-submit>
        Donate
      </Button>

      {/* `initDonationForm` writes the outcome here. The role is on the
          element rather than added with the message, so the region exists
          before there is anything to announce. */}
      <p class="pk-small" role="status" data-donation-status hidden />
    </>
  );
}

function CheckoutOverlay() {
  return (
    <div class="pk-stack pk-stack--snug" data-donation-checkout hidden>
      <div class="pk-cluster">
        <Button size="sm" data-donation-back>
          <span aria-hidden="true">←</span> Back
        </Button>
      </div>
      <div data-donation-checkout-mount />
    </div>
  );
}

export function DonationWidget({ opts = {} }: { opts?: DonationWidgetOptions }) {
  const {
    extraClasses = "",
    successPath = "/donate/complete/",
    cancelPath = "",
    name = null,
    email = null,
    organizationName = null,
    source = null,
    hideIdentityFields = false,
  } = opts;

  return (
    <div class="pk pk-start">
      <div
        class={["pk-stack", "pk-stack--snug", extraClasses].filter(Boolean).join(" ")}
        data-donation-form=""
        data-donation-success-path={successPath || undefined}
        data-donation-cancel-path={cancelPath || undefined}
        data-donation-name={name || undefined}
        data-donation-email={email || undefined}
        data-donation-organization={organizationName || undefined}
        data-donation-source={source || undefined}
      >
        {hideIdentityFields ? (
          <>
            <input type="hidden" data-donation-name-input />
            <input type="hidden" data-donation-email-input />
            <input type="hidden" data-donation-org-input />
            <CompactCurrencySelect />
          </>
        ) : (
          <>
            <IdentityFields />
            <CurrencyRow />
          </>
        )}
        <SharedControls />
      </div>
      <CheckoutOverlay />
    </div>
  );
}
