/**
 * Programmatic builder for the donation widget DOM structure.
 *
 * Single source of truth for the `[data-donation-form]` +
 * `[data-donation-checkout]` markup. Dynamic placements that inject the
 * widget at runtime (e.g. the post-registration donation CTA) use this
 * instead of duplicating the markup.
 */
import { render } from "preact";

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
    <div class="donation-form-identity">
      <div class="mb-2">
        <label for="donation-donor-name" class="form-label donation-form-label">
          Full name{" "}
          <span class="text-danger" aria-hidden="true">
            *
          </span>
        </label>
        <input
          type="text"
          id="donation-donor-name"
          class="form-control form-control-sm"
          data-donation-name-input
          placeholder="Your full name"
          required
          autocomplete="name"
          aria-required="true"
        />
      </div>
      <div class="mb-2">
        <label for="donation-donor-email" class="form-label donation-form-label">
          Email
        </label>
        <input
          type="email"
          id="donation-donor-email"
          class="form-control form-control-sm"
          data-donation-email-input
          placeholder="your@email.com"
          autocomplete="email"
        />
      </div>
      <div class="mb-3">
        <label for="donation-donor-org" class="form-label donation-form-label">
          Organisation <span class="text-muted small">(optional)</span>
        </label>
        <input
          type="text"
          id="donation-donor-org"
          class="form-control form-control-sm"
          data-donation-org-input
          placeholder="Your company or organisation"
          autocomplete="organization"
        />
      </div>
    </div>
  );
}

function CurrencyRow({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div class="donation-form-currency-row">
      <label for="donation-currency" class="form-label donation-form-currency-label">
        Currency
      </label>
      <select
        id="donation-currency"
        class="form-select form-select-sm donation-form-currency-select"
        data-donation-currency
      >
        <option value="usd">USD ($) — US Dollar</option>
      </select>
    </div>
  );
}

function CompactCurrencySelect() {
  return (
    <div class="event-flow-donation-cta-currency">
      <select data-donation-currency class="form-select form-select-sm" aria-label="Select currency">
        <option value="usd">USD ($) — US Dollar</option>
      </select>
    </div>
  );
}

function SharedControls() {
  return (
    <>
      <div data-donation-presets class="donation-form-presets">
        <button type="button" class="btn btn-outline-secondary donation-preset-btn" data-preset-amount="50">
          $50
        </button>
        <button type="button" class="btn btn-outline-secondary donation-preset-btn" data-preset-amount="100">
          $100
        </button>
        <button type="button" class="btn btn-outline-secondary donation-preset-btn" data-preset-amount="250">
          $250
        </button>
        <button type="button" class="btn btn-outline-secondary donation-preset-btn" data-preset-amount="500">
          $500
        </button>
        <button type="button" class="btn btn-outline-secondary donation-preset-btn" data-preset-amount="1000">
          $1,000
        </button>
      </div>
      <div class="donation-form-custom mt-2">
        <div class="input-group input-group-sm">
          <span class="input-group-text" data-donation-currency-prefix>
            $
          </span>
          <input
            type="number"
            class="form-control"
            data-donation-custom-input
            placeholder="Or other amount"
            min={1}
            step={1}
            aria-label="Custom donation amount"
          />
        </div>
      </div>
      <button type="button" class="btn btn-page-accent w-100 mt-3" data-donation-submit>
        Donate
      </button>
      <p class="donation-form-status small mt-2" data-donation-status hidden />
    </>
  );
}

function CheckoutOverlay() {
  return (
    <div class="donation-checkout-overlay" data-donation-checkout hidden>
      <button type="button" class="btn btn-sm btn-outline-secondary donation-checkout-back mb-3" data-donation-back>
        ← Back
      </button>
      <div data-donation-checkout-mount />
    </div>
  );
}

function DonationWidgetInner({
  opts,
}: {
  opts: Required<Pick<DonationWidgetOptions, "hideIdentityFields">> & DonationWidgetOptions;
}) {
  const {
    extraClasses = "",
    successPath = "/donate/complete/",
    cancelPath = "",
    name = null,
    email = null,
    organizationName = null,
    source = null,
    hideIdentityFields,
  } = opts;

  const formData: Record<string, string> = {};
  formData.donationForm = "";
  if (successPath) formData.donationSuccessPath = successPath;
  if (cancelPath) formData.donationCancelPath = cancelPath;
  if (name) formData.donationName = name;
  if (email) formData.donationEmail = email;
  if (organizationName) formData.donationOrganization = organizationName;
  if (source) formData.donationSource = source;

  return (
    <div class="donation-widget">
      <div
        class={["donation-form", extraClasses].filter(Boolean).join(" ")}
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
            <CurrencyRow visible />
          </>
        )}
        <SharedControls />
      </div>
      <CheckoutOverlay />
    </div>
  );
}

/**
 * Builds and returns a `.donation-widget` element containing the form and
 * checkout overlay. Call `initDonationForm()` after appending to the DOM.
 */
export function buildDonationWidget(opts: DonationWidgetOptions = {}): HTMLElement {
  const wrapper = document.createElement("div");
  render(<DonationWidgetInner opts={{ hideIdentityFields: false, ...opts }} />, wrapper);
  // Return the rendered widget element (first child of the wrapper)
  const widget = wrapper.firstElementChild as HTMLElement;
  if (widget) {
    wrapper.removeChild(widget);
    return widget;
  }
  return wrapper;
}
