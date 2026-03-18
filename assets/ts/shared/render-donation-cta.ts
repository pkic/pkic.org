/**
 * Renders an embedded donation form in event flow success panels.
 *
 * Instead of linking away to /donate/, we embed a compact version of the
 * donation form directly in the confirmation panel. The form is pre-filled
 * with the attendee's identity data so the experience is frictionless —
 * no navigation, no re-entering details.
 *
 * Psychological framing: the confirmation moment is the highest-engagement
 * point in the flow (peak-end rule). The cost anchor ($150–$300/attendee/day)
 * makes a €50–€250 donation feel proportionate. Pre-filled identity fields
 * remove the main source of drop-off for people who are already willing.
 */
import { initDonationForm } from "./donation-form";

export interface DonationCtaOptions {
  /** Donor's full name — used to pre-fill the name field. */
  name?: string | null;
  /** Donor's email — used to pre-fill Stripe Checkout. */
  email?: string | null;
  /** Donor's organisation — used to pre-fill the org field. */
  organizationName?: string | null;
  /** URL path or label indicating where the donation is being initiated. */
  source?: string | null;
}

export function renderDonationCta(container: HTMLElement, options: DonationCtaOptions): void {
  const section = document.createElement("div");
  section.className = "event-flow-donation-cta";

  // Build data-attribute string for identity pre-fill (values are already
  // trusted internal strings, but we escape for safe HTML attribute embedding).
  const nameAttr = options.name ? ` data-donation-name="${escapeAttr(options.name)}"` : "";
  const emailAttr = options.email ? ` data-donation-email="${escapeAttr(options.email)}"` : "";
  const orgAttr = options.organizationName
    ? ` data-donation-organization="${escapeAttr(options.organizationName)}"`
    : "";
  const sourceAttr = options.source ? ` data-donation-source="${escapeAttr(options.source)}"` : "";

  section.innerHTML = `
    <div class="event-flow-donation-cta-inner">
      <p class="event-flow-donation-cta-heading">Help welcome more attendees</p>
      <p class="event-flow-donation-cta-body">
        Our events — and membership — are completely free. We run on sponsors and voluntary donations.
        Hosting you at this event costs us roughly <strong>$300–$500 per attendee</strong>.
        A donation of any size helps us keep the doors open to everyone.
      </p>

      <div
        class="donation-form donation-form--compact"
        data-donation-form
        data-donation-success-path="/donate/thank-you/"
        ${nameAttr}${emailAttr}${orgAttr}${sourceAttr}
      >
        <!--
          Hidden identity inputs — pre-filled by initDonationForm() from the
          data-donation-* attributes above. Keeping them hidden means the
          attendee sees only the amount selector, which is the only decision
          they actually need to make at this point.
        -->
        <input type="hidden" data-donation-name-input />
        <input type="hidden" data-donation-email-input />
        <input type="hidden" data-donation-org-input />

        <!--
          Currency selector — required by initDonationForm() to proceed past
          its early-return guard. Hidden here; geo-detection still runs and
          updates the preset labels to the visitor's local currency.
        -->
        <select data-donation-currency style="display:none">
          <option value="usd">USD</option>
        </select>

        <!-- Preset amount buttons — rendered and replaced by initDonationForm() -->
        <div data-donation-presets class="donation-form-presets">
          <button type="button" class="btn btn-outline-secondary donation-preset-btn" data-preset-amount="50">$50</button>
          <button type="button" class="btn btn-outline-secondary donation-preset-btn" data-preset-amount="100">$100</button>
          <button type="button" class="btn btn-outline-secondary donation-preset-btn" data-preset-amount="250">$250</button>
          <button type="button" class="btn btn-outline-secondary donation-preset-btn" data-preset-amount="500">$500</button>
          <button type="button" class="btn btn-outline-secondary donation-preset-btn" data-preset-amount="1000">$1,000</button>
        </div>

        <!-- Custom amount -->
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
      </div>

      <p class="event-flow-donation-cta-disclaimer">
        The PKI Consortium is a 501(c)(6) non-profit. No goods or services are provided in exchange.
      </p>
    </div>
  `;

  container.appendChild(section);

  // Initialise the embedded form after it is in the DOM so all selectors resolve.
  const formRoot = section.querySelector<HTMLElement>("[data-donation-form]");
  if (formRoot) {
    initDonationForm(formRoot);
  }
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

