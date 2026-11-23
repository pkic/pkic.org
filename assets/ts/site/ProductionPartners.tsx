import type { EventProductionPartnerCredit } from "../../shared/schemas/event-production-partners";
import { ExternalLink } from "../ui/ExternalLink";
import { SiteImage } from "./SiteImage";
import "./ProductionPartners.css";

/**
 * The event's production partners as one quiet line of credits: what each provides, then its logo, drawn
 * smaller than any sponsor's. They stand apart from the sponsors and never take a turn in the sponsors' line.
 * The virtual room and the public agenda credit them the same way.
 */
export function ProductionPartners({ partners }: { partners: readonly EventProductionPartnerCredit[] }) {
  if (!partners.length) return null;
  return (
    <section aria-label="Production partners">
      <ul class="pk-production-partners">
        {partners.map((partner) => {
          const mark = partner.logoUrl ? (
            <SiteImage src={partner.logoUrl} alt={partner.name} loading="lazy" />
          ) : (
            <span class="pk-strong">{partner.name}</span>
          );
          return (
            <li key={partner.organizationId} class="pk-production-partners__item">
              <span>{partner.role}</span>
              {partner.website ? (
                <ExternalLink href={partner.website} external title={partner.name}>
                  {mark}
                </ExternalLink>
              ) : (
                mark
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
