/**
 * build-donation-widget.ts — Programmatic client-side builder for the
 * donation widget DOM structure.
 *
 * This is the single client-side source of truth for the `[data-donation-form]`
 * + `[data-donation-checkout]` markup. It mirrors `layouts/partials/donations/
 * form-widget.html`, which is the server-side (Hugo) equivalent used for
 * statically-rendered placements (e.g. /donate/).
 *
 * Dynamic placements that inject the widget at runtime (e.g. the post-
 * registration donation CTA) import this and call `buildDonationWidget()`
 * instead of duplicating the markup inline.
 */

export interface DonationWidgetOptions {
  /** Extra CSS class(es) to add to the `[data-donation-form]` element. */
  extraClasses?: string;
  /** Redirect path after a successful donation. Defaults to /donate/complete/. */
  successPath?: string;
  /** Redirect path if the donor cancels. */
  cancelPath?: string;
  /** Pre-fill donor name. */
  name?: string | null;
  /** Pre-fill donor email. */
  email?: string | null;
  /** Pre-fill donor organisation. */
  organizationName?: string | null;
  /** Attribution source label passed to the API as metadata. */
  source?: string | null;
  /**
   * When true the name/email/org inputs are rendered as `type="hidden"` so
   * they are pre-filled but not shown to the user. Useful when identity is
   * already known (e.g. after registration).
   */
  hideIdentityFields?: boolean;
}

/**
 * Builds and returns a `.donation-widget` element containing:
 *  - `[data-donation-form]`   — the form fields (currency, presets, submit…)
 *  - `[data-donation-checkout]` — the Stripe embedded-checkout overlay
 *
 * Call `initDonationForm(widget.querySelector('[data-donation-form]'))` after
 * appending the element to the document.
 */
export function buildDonationWidget(opts: DonationWidgetOptions = {}): HTMLElement {
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

  const widget = document.createElement("div");
  widget.className = "donation-widget";

  // ── [data-donation-form] ────────────────────────────────────────────────
  const form = document.createElement("div");
  form.className = ["donation-form", extraClasses].filter(Boolean).join(" ");
  form.dataset.donationForm = "";
  if (successPath)      form.dataset.donationSuccessPath = successPath;
  if (cancelPath)       form.dataset.donationCancelPath  = cancelPath;
  if (name)             form.dataset.donationName         = name;
  if (email)            form.dataset.donationEmail        = email;
  if (organizationName) form.dataset.donationOrganization = organizationName;
  if (source)           form.dataset.donationSource       = source;

  if (hideIdentityFields) {
    // Compact mode: hidden inputs pre-filled by initDonationForm via data-attrs
    form.innerHTML = `
      <input type="hidden" data-donation-name-input />
      <input type="hidden" data-donation-email-input />
      <input type="hidden" data-donation-org-input />
    `;
  } else {
    // Full mode: visible identity fields (mirrors form-widget.html)
    form.innerHTML = `
      <div class="donation-form-identity">
        <div class="mb-2">
          <label for="donation-donor-name" class="form-label donation-form-label">Full name <span class="text-danger" aria-hidden="true">*</span></label>
          <input type="text" id="donation-donor-name" class="form-control form-control-sm" data-donation-name-input placeholder="Your full name" required autocomplete="name" aria-required="true" />
        </div>
        <div class="mb-2">
          <label for="donation-donor-email" class="form-label donation-form-label">Email</label>
          <input type="email" id="donation-donor-email" class="form-control form-control-sm" data-donation-email-input placeholder="your@email.com" autocomplete="email" />
        </div>
        <div class="mb-3">
          <label for="donation-donor-org" class="form-label donation-form-label">Organisation <span class="text-muted small">(optional)</span></label>
          <input type="text" id="donation-donor-org" class="form-control form-control-sm" data-donation-org-input placeholder="Your company or organisation" autocomplete="organization" />
        </div>
      </div>
      <div class="donation-form-currency-row">
        <label for="donation-currency" class="form-label donation-form-currency-label">Currency</label>
        <select id="donation-currency" class="form-select form-select-sm donation-form-currency-select" data-donation-currency>
          <option value="usd">USD ($) — US Dollar</option>
        </select>
      </div>
    `;
  }

  if (hideIdentityFields) {
    // Compact layout: currency select without label (space is tight)
    form.insertAdjacentHTML("beforeend", `
      <div class="event-flow-donation-cta-currency">
        <select data-donation-currency class="form-select form-select-sm" aria-label="Select currency">
          <option value="usd">USD ($) — US Dollar</option>
        </select>
      </div>
    `);
  }

  // Preset buttons, custom amount, submit and status — shared by both modes
  form.insertAdjacentHTML("beforeend", `
    <div data-donation-presets class="donation-form-presets">
      <button type="button" class="btn btn-outline-secondary donation-preset-btn" data-preset-amount="50">$50</button>
      <button type="button" class="btn btn-outline-secondary donation-preset-btn" data-preset-amount="100">$100</button>
      <button type="button" class="btn btn-outline-secondary donation-preset-btn" data-preset-amount="250">$250</button>
      <button type="button" class="btn btn-outline-secondary donation-preset-btn" data-preset-amount="500">$500</button>
      <button type="button" class="btn btn-outline-secondary donation-preset-btn" data-preset-amount="1000">$1,000</button>
    </div>
    <div class="donation-form-custom mt-2">
      <div class="input-group input-group-sm">
        <span class="input-group-text" data-donation-currency-prefix>$</span>
        <input
          type="number"
          class="form-control"
          data-donation-custom-input
          placeholder="Or other amount"
          min="1"
          step="1"
          aria-label="Custom donation amount"
        />
      </div>
    </div>
    <button type="button" class="btn btn-page-accent w-100 mt-3" data-donation-submit>
      Donate
    </button>
    <p class="donation-form-status small mt-2" data-donation-status hidden></p>
  `);

  // ── [data-donation-checkout] overlay ────────────────────────────────────
  const checkout = document.createElement("div");
  checkout.className = "donation-checkout-overlay";
  checkout.dataset.donationCheckout = "";
  checkout.hidden = true;
  checkout.innerHTML = `
    <button type="button" class="btn btn-sm btn-outline-secondary donation-checkout-back mb-3" data-donation-back>
      ← Back
    </button>
    <div data-donation-checkout-mount></div>
  `;

  widget.appendChild(form);
  widget.appendChild(checkout);

  return widget;
}
