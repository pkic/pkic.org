import { useEffect, useMemo, useState } from "preact/hooks";
import type { PublicSponsor, SponsorsDisplayResponse } from "../../../../../../../shared/schemas/public-sponsors";
import { useMediaQuery } from "../../../../../../hooks/useMediaQuery";
import { ExternalLink } from "../../../../../../ui/ExternalLink";
import { roomSponsorLine, type RoomSponsorTurn } from "./virtual-room-sponsors";

/** How long one turn of sponsors stays before the next takes its place. */
const TURN_MS = 8000;
/**
 * The room a logo is given, as a multiple of a square of the tier's height. Every logo of a tier gets the
 * same area, so a long wordmark is drawn lower than a compact mark and neither outweighs the other.
 */
const LOGO_AREA = 2.8;
/** The lowest a long wordmark is drawn, in tenths of its tier's height; the stylesheet has a step for each. */
const LOWEST_STEP = 5;

/** A sponsor's logo at its tier's size; its tier is the tooltip, since the line has no room to name it. */
function SponsorLogo({ sponsor, tier }: { sponsor: PublicSponsor; tier: string }) {
  // How tall the logo stands, in tenths of its tier's height, once its shape is known.
  const [step, setStep] = useState<number | null>(null);
  const logo = (
    <img
      src={sponsor.logoUrl!}
      alt={sponsor.name}
      data-step={step ?? undefined}
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (!naturalWidth || !naturalHeight) return;
        const height = Math.sqrt((LOGO_AREA * naturalHeight) / naturalWidth);
        setStep(Math.min(10, Math.max(LOWEST_STEP, Math.round(height * 10))));
      }}
    />
  );
  const title = `${sponsor.name}, ${tier} sponsor`;
  return (
    <li class="pk-virtual-room__sponsor" title={sponsor.website ? undefined : title}>
      {sponsor.website ? (
        <ExternalLink href={sponsor.website} external title={title}>
          {logo}
        </ExternalLink>
      ) : (
        logo
      )}
    </li>
  );
}

function SponsorTurn({ turn, pinned = false }: { turn: RoomSponsorTurn; pinned?: boolean }) {
  return (
    <ul
      class={`pk-virtual-room__sponsor-list${pinned ? " pk-virtual-room__sponsor-list--pinned" : ""}`}
      data-rank={turn.rank}
      aria-label={`${turn.tier} sponsors`}
    >
      {turn.sponsors.map((sponsor) => (
        <SponsorLogo key={sponsor.id} sponsor={sponsor} tier={turn.tier} />
      ))}
    </ul>
  );
}

/**
 * The event's sponsors under the stream, always in view on one line of a fixed height: one tier at a time,
 * each at its own size, changing by itself so every sponsor is seen. On a desktop the highest tier stays at
 * the start of the line. The change waits while the pointer or the keyboard is on a logo, so nobody loses
 * the one they were reaching for.
 */
export function VirtualRoomSponsors({ sponsors }: { sponsors: SponsorsDisplayResponse | null }) {
  const wide = useMediaQuery("(min-width: 64rem)");
  const line = useMemo(() => (sponsors ? roomSponsorLine(sponsors, wide ? "wide" : "narrow") : null), [sponsors, wide]);
  const [turn, setTurn] = useState(0);
  const [held, setHeld] = useState(false);
  const turns = line?.turns.length ?? 0;
  useEffect(() => {
    if (turns < 2 || held) return;
    const next = window.setInterval(() => setTurn((current) => current + 1), TURN_MS);
    return () => window.clearInterval(next);
  }, [turns, held]);
  if (!line || !turns) return null;
  return (
    <section
      class="pk-virtual-room__sponsors"
      aria-label="Sponsors"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocusIn={() => setHeld(true)}
      onFocusOut={() => setHeld(false)}
    >
      {line.pinned && <SponsorTurn turn={line.pinned} pinned />}
      <SponsorTurn turn={line.turns[turn % turns]!} />
    </section>
  );
}
