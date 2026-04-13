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
import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { initDonationForm } from "./form";
import { buildDonationWidget } from "./widget";

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

function CostAnchor({ days }: { days: number | null }) {
  if (days) {
    return (
      <span>
        roughly <strong>${150 * days}–${300 * days} per attendee</strong> for this {days}-day event
      </span>
    );
  }
  return (
    <span>
      roughly <strong>$150–$300 per attendee per day</strong>
    </span>
  );
}

function DonationCtaInner({ options }: { options: DonationCtaOptions }) {
  const widgetRef = useRef<HTMLDivElement>(null);

  const days = options.days && options.days > 0 ? options.days : null;

  useEffect(() => {
    if (!widgetRef.current) return;
    const widget = buildDonationWidget({
      extraClasses: "donation-form--compact",
      successPath: "/donate/complete/",
      name: options.name,
      email: options.email,
      organizationName: options.organizationName,
      source: options.source,
      hideIdentityFields: true,
    });
    widgetRef.current.appendChild(widget);

    const formRoot = widget.querySelector<HTMLElement>("[data-donation-form]");
    if (formRoot) {
      initDonationForm(formRoot);
    }
  }, [options.name, options.email, options.organizationName, options.source]);

  return (
    <div class="event-flow-donation-cta">
      <div class="event-flow-donation-cta-inner">
        <p class="event-flow-donation-cta-heading">Help welcome more attendees</p>
        <p class="event-flow-donation-cta-body">
          Our events — and membership — are completely free. We run on sponsors and voluntary donations.
          Hosting you at this event costs us <CostAnchor days={days} />.
          A donation of any size helps us keep the doors open to everyone.
        </p>
        <div ref={widgetRef} />
        <p class="event-flow-donation-cta-disclaimer">
          PKI Consortium is a section 501(c)(6) nonprofit business league. Contributions or gifts to PKI Consortium are not deductible as charitable contributions for federal income tax purposes in the United States. This payment is voluntary and is not a ticket, fee, or payment for goods or services. Please consult your tax advisor regarding any possible business-expense treatment or other tax consequences.
        </p>
        <p class="event-flow-donation-cta-sponsor">
          Interested in sponsoring our events?{" "}
          <a href="/sponsors/sponsor/">Enquire about sponsor options &rarr;</a>
        </p>
      </div>
    </div>
  );
}

export function renderDonationCta(container: HTMLElement, options: DonationCtaOptions): void {
  render(<DonationCtaInner options={options} />, container);
}
