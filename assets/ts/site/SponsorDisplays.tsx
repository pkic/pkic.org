import { useState } from "preact/hooks";
import type { MemberWallEntry } from "../../shared/schemas/members-directory";
import type { PublicSponsor, SponsorsDisplayResponse } from "../../shared/schemas/public-sponsors";
import "./sponsors-wall.css";
export function sponsorWeightsDescending(sponsors: PublicSponsor[]): number[] {
  return [...new Set(sponsors.map(({ weight }) => weight))].sort((a, b) => b - a);
}

/** Keep arbitrary data-backed weights ordered while bounding their visual scale. */
export function sponsorWeightClass(weight: number): string {
  return `sponsor-weight-${Math.min(8, Math.max(1, Math.trunc(weight)))}`;
}

function titleFor(s: PublicSponsor, level: string | null, eventName?: string): string {
  const context = eventName ?? "the PKI Consortium";
  return `${s.name} is a ${level ?? "sponsor"} sponsor for ${context}`;
}

function SponsorLogo({
  s,
  level,
  eventName,
  logoClass,
  sizeClass,
}: {
  s: PublicSponsor;
  level: string | null;
  eventName?: string;
  logoClass?: string;
  sizeClass?: string;
}) {
  // A wall of logos has nowhere to put a broken one: there is no monogram to
  // fall back to and the alt text would sit among the marks at whatever size
  // the row gives it, so a logo that fails to load takes its tile with it.
  const [failed, setFailed] = useState(false);
  if (!s.logoUrl || failed) return null;
  const title = titleFor(s, level, eventName);
  return (
    <a href={s.website ?? "#"} title={title} target="_blank" rel="noopener noreferrer" class="sponsor-link">
      <img
        src={s.logoUrl}
        alt={title}
        title={title}
        class={[logoClass ?? "sponsor-logo", sizeClass].filter(Boolean).join(" ")}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </a>
  );
}

export function SponsorGridView({
  display,
  eventName,
  height,
  maxHeight,
  maxWidth,
  rows,
  logoClass,
}: {
  display: Pick<SponsorsDisplayResponse, "groups">;
  eventName?: string;
  height?: number;
  maxHeight?: number;
  maxWidth?: number;
  rows: boolean;
  logoClass?: string;
}) {
  const items = display.groups.map(({ weight: w, sponsors }) => (
    <>
      {sponsors.map((s) => {
        const sizeClasses = [
          sponsorWeightClass(w),
          height === 20 ? "sponsor-grid-height-20" : "",
          maxHeight === 20 ? "sponsor-grid-max-height-20" : "",
          maxWidth === 60 ? "sponsor-grid-max-width-60" : "",
        ];
        return (
          <SponsorLogo
            key={s.id}
            s={s}
            level={s.effectiveTier}
            eventName={eventName}
            logoClass={logoClass ? `sponsor-logo ${logoClass}` : "sponsor-logo"}
            sizeClass={sizeClasses.filter(Boolean).join(" ")}
          />
        );
      })}
    </>
  ));

  return (
    <div class="pk-stack">
      <div class="sponsors-list">{rows ? items.map((row, i) => <div key={i}>{row}</div>) : items}</div>
    </div>
  );
}

export function SponsorLevelView({
  display,
  eventName,
}: {
  display: Pick<SponsorsDisplayResponse, "groups">;
  eventName?: string;
}) {
  /*
   * The tier band — a captioned rule with the tier's logos beneath it — was
   * built out of Bootstrap's grid and position utilities in the markup. It is
   * now a few class names whose rules live in `assets/scss/sponsors.scss`,
   * beside the rest of this surface's appearance: the surface is still styled
   * from the legacy sheet, so moving the layout there keeps one owner rather
   * than splitting it between a stylesheet and a row of utility classes. The
   * wrapper the logos each sat in is gone with the grid — the row is a flex
   * container now, so a logo needs nothing around it to be centered.
   *
   * The weight class sits on the band rather than on each image: a tier's rank
   * sets one logo box that every sponsor in the tier is contained by, which is
   * a property of the band and not of the images inside it.
   */
  return (
    <div class="sponsors pk-stack pk-center">
      {display.groups.map((group) => (
        <div key={group.weight} data-weight={group.weight} class={`sponsors-tier ${sponsorWeightClass(group.weight)}`}>
          <span class="sponsor-level">{group.tierName}</span>
          <div class="sponsors-tier-logos">
            {group.sponsors.map((s) => (
              <SponsorLogo key={s.id} s={s} level={group.tierName} eventName={eventName} logoClass="sponsor-logo" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SponsorStripView({
  sponsors,
  eventName,
  containerClass,
  linkClass,
  logoClass,
  label,
  labelClass,
}: {
  sponsors: PublicSponsor[];
  eventName?: string;
  containerClass: string;
  linkClass: string;
  logoClass: string;
  label?: string;
  labelClass?: string;
}) {
  const sorted = sponsors?.map((s) => ({ s, weight: s.weight })) ?? null;

  if (!sorted || sorted.length === 0) return null;
  const centered = sorted
    .map((entry, index) => ({
      ...entry,
      order: index % 2 === 0 ? -Math.floor(index / 2) : Math.floor((index + 1) / 2),
    }))
    .sort((left, right) => left.order - right.order);

  return (
    <>
      {label && <div class={labelClass ?? "sponsor-strip-default-label"}>{label}</div>}
      <div class={containerClass}>
        {centered.map(({ s, weight }) => {
          const tier = s.effectiveTier;
          const title = titleFor(s, tier, eventName);
          if (!s.logoUrl) return null;
          return (
            <a
              key={s.id}
              href={s.website ?? "#"}
              title={title}
              target="_blank"
              rel="noopener noreferrer"
              class={`${linkClass} ${sponsorWeightClass(weight)}`}
            >
              <img class={`${logoClass} sponsor-strip-default-logo`} alt={title} src={s.logoUrl} loading="lazy" />
            </a>
          );
        })}
      </div>
    </>
  );
}

export function MemberWallView({ entries }: { entries: MemberWallEntry[] }) {
  return (
    <>
      {entries.map((entry) => (
        <MemberWallLogo entry={entry} key={entry.key} />
      ))}
    </>
  );
}

/**
 * One tile on the wall.
 *
 * The tile owns whether its logo loaded: a wall has no monogram to fall back
 * to, so a mark that fails leaves the row rather than standing in it as a
 * broken-image glyph with the member's name beside it.
 */
function MemberWallLogo({ entry }: { entry: MemberWallEntry }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <a
      href={entry.href}
      target="_blank"
      rel="noopener"
      data-sponsor-level={entry.sponsorLevel}
      data-member-name={entry.name}
      data-member-slogan={entry.slogan ?? undefined}
      data-sponsor-level-name={entry.sponsorLevel > 0 ? (entry.sponsorLevelName ?? undefined) : undefined}
    >
      <img
        class={`member-logo${entry.sponsorLevel > 0 ? ` member-logo-sponsor sponsor-lvl-${entry.sponsorLevel}` : ""}`}
        alt={entry.name}
        src={entry.logoUrl}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </a>
  );
}
