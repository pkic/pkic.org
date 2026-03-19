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
  /** Number of event days — used to compute the per-event cost anchor shown to donors. */
  days?: number | null;
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

  // Cost anchor — per-day framing by default; total shown when days are known.
  const days = options.days && options.days > 0 ? options.days : null;
  const costAnchor = days
    ? `roughly <strong>$${150 * days}–$${300 * days} per attendee</strong> for this ${days}-day event`
    : `roughly <strong>$150–$300 per attendee per day</strong>`;

  section.innerHTML = `
    <div class="event-flow-donation-cta-inner">
      <p class="event-flow-donation-cta-heading">Help welcome more attendees</p>
      <p class="event-flow-donation-cta-body">
        Our events — and membership — are completely free. We run on sponsors and voluntary donations.
        Hosting you at this event costs us ${costAnchor}.
        A donation of any size helps us keep the doors open to everyone.
      </p>

      <div
        class="donation-form donation-form--compact"
        data-donation-form
        data-donation-success-path="/donate/complete/"
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
          Currency selector — geo-detection sets the default; the select lets
          visitors switch between currencies without leaving the panel.
          Populated with all supported currencies by initDonationForm().
        -->
        <div class="event-flow-donation-cta-currency">
          <select data-donation-currency class="form-select form-select-sm" aria-label="Select currency">
            <option value="usd">USD ($) — US Dollar</option>
          </select>
        </div>

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
        PKI Consortium is a section 501(c)(6) nonprofit business league. Contributions or gifts to PKI Consortium are not deductible as charitable contributions for federal income tax purposes in the United States. This payment is voluntary and is not a ticket, fee, or payment for goods or services. Please consult your tax advisor regarding any possible business-expense treatment or other tax consequences.
      </p>
      <p class="event-flow-donation-cta-sponsor">
        Interested in sponsoring our events? <a href="/sponsors/sponsor/">Enquire about sponsor options &rarr;</a>
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

