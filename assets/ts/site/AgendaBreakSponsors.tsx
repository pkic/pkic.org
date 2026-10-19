import type { AgendaBreakSponsorDisplay } from "../../shared/schemas/event-agenda-sponsors";
import { SiteImage } from "./SiteImage";
import "./AgendaBreakSponsors.css";

/** Event-approved public branding supplied by the canonical agenda projection. */
export function AgendaBreakSponsors({ sponsors }: { sponsors: readonly AgendaBreakSponsorDisplay[] }) {
  return (
    <ul class="pk-agenda-break-sponsors" aria-label="Break sponsors">
      {sponsors.map((sponsor) => {
        const branding = (
          <>
            {sponsor.logoUrl ? <SiteImage src={sponsor.logoUrl} alt="" loading="lazy" /> : null}
            <span>{sponsor.name}</span>
          </>
        );
        return (
          <li key={sponsor.id}>
            {sponsor.website ? <a href={sponsor.website}>{branding}</a> : <span>{branding}</span>}
          </li>
        );
      })}
    </ul>
  );
}
