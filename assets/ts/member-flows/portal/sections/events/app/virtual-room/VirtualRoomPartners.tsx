import type { EventProductionPartnerCredit } from "../../../../../../../shared/schemas/event-production-partners";
import { ExternalLink } from "../../../../../../ui/ExternalLink";

/**
 * The event's production partners as one quiet line of credits: what each provides, then its logo, drawn
 * smaller than any sponsor's. They stand apart from the sponsors and never take a turn in the sponsors' line.
 */
export function VirtualRoomPartners({ partners }: { partners: readonly EventProductionPartnerCredit[] }) {
  if (!partners.length) return null;
  return (
    <section aria-label="Production partners">
      <ul class="pk-virtual-room__partner-list">
        {partners.map((partner) => {
          const mark = partner.logoUrl ? (
            <img src={partner.logoUrl} alt={partner.name} loading="lazy" />
          ) : (
            <span class="pk-strong">{partner.name}</span>
          );
          return (
            <li key={partner.organizationId} class="pk-virtual-room__partner">
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
