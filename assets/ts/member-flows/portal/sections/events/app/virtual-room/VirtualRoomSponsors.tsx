import { useEffect, useMemo, useState } from "preact/hooks";
import type { SponsorsDisplayResponse } from "../../../../../../../shared/schemas/public-sponsors";
import { useMediaQuery } from "../../../../../../hooks/useMediaQuery";
import { ExternalLink } from "../../../../../../ui/ExternalLink";
import { roomSponsorTurns } from "./virtual-room-sponsors";

/** How long one turn of sponsors stays before the next takes its place. */
const TURN_MS = 8000;
/** Logos in view at once: a row a phone can hold, and the width beside the stream on a desk. */
const PLACES = { narrow: 3, wide: 6 } as const;

/**
 * The event's sponsors under the stream, always in view: a few logos at a
 * time, changing by themselves so every sponsor is seen. The highest tiers
 * are larger and return more often. The change waits while the pointer or
 * the keyboard is on a logo, so nobody loses the one they were reaching for.
 */
export function VirtualRoomSponsors({ sponsors }: { sponsors: SponsorsDisplayResponse | null }) {
  const wide = useMediaQuery("(min-width: 64rem)");
  const turns = useMemo(
    () => (sponsors ? roomSponsorTurns(sponsors, wide ? PLACES.wide : PLACES.narrow) : []),
    [sponsors, wide],
  );
  const [turn, setTurn] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (turns.length < 2 || held) return;
    const next = window.setInterval(() => setTurn((current) => current + 1), TURN_MS);
    return () => window.clearInterval(next);
  }, [turns.length, held]);
  if (!turns.length) return null;
  const shown = turns[turn % turns.length]!;
  return (
    <section
      class="pk-virtual-room__sponsors"
      aria-label="Sponsors"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocusIn={() => setHeld(true)}
      onFocusOut={() => setHeld(false)}
    >
      <span class="pk-virtual-room__sponsors-label">Sponsors</span>
      <ul class="pk-virtual-room__sponsor-list">
        {shown.map(({ sponsor, top }) => (
          <li key={sponsor.id} class="pk-virtual-room__sponsor" data-top={top ? "" : undefined}>
            {sponsor.website ? (
              <ExternalLink href={sponsor.website} external title={sponsor.name}>
                <img src={sponsor.logoUrl!} alt={sponsor.name} loading="lazy" />
              </ExternalLink>
            ) : (
              <img src={sponsor.logoUrl!} alt={sponsor.name} loading="lazy" />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
