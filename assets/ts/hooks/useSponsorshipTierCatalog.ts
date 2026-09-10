/**
 * The active sponsorship tiers for one sponsor type, as names.
 *
 * A tier is reference data — a row in `sponsorship_tier_catalog` with a price
 * beside it — not something a person should have to spell. Staff surfaces used
 * to take it as free text, so "Platinum " or "gold" became a tier nothing else
 * in the system recognized. The public inquiry form has always read this
 * endpoint; the pipeline reads the same one.
 *
 * Cached per sponsor type, because the two forms that need it mount and
 * unmount as staff move around the pipeline.
 */
import { useEffect, useState } from "preact/hooks";
import { publicSponsorTiersResponseSchema } from "../../shared/schemas/sponsors";
import type { SponsorshipType } from "../../shared/schemas/sponsorship";
import { getJson } from "../shared/api-client";

const cached = new Map<SponsorshipType, readonly string[]>();
const pending = new Map<SponsorshipType, Promise<readonly string[]>>();

function load(sponsorType: SponsorshipType): Promise<readonly string[]> {
  const existing = pending.get(sponsorType);
  if (existing) return existing;
  const request = getJson(
    `/api/v1/sponsors/tiers?sponsorType=${encodeURIComponent(sponsorType)}`,
    publicSponsorTiersResponseSchema,
  ).then(
    (response) => {
      const tiers = response.tiers.map((entry) => entry.tier);
      cached.set(sponsorType, tiers);
      return tiers;
    },
    () => {
      // A failed catalog fetch must not fail the page; the next mount retries.
      pending.delete(sponsorType);
      return [];
    },
  );
  pending.set(sponsorType, request);
  return request;
}

/** The tiers on offer, or an empty list until they arrive. */
export function useSponsorshipTierCatalog(sponsorType: SponsorshipType): readonly string[] {
  const [tiers, setTiers] = useState<readonly string[]>(cached.get(sponsorType) ?? []);

  useEffect(() => {
    const alreadyLoaded = cached.get(sponsorType);
    if (alreadyLoaded) {
      setTiers(alreadyLoaded);
      return;
    }
    let cancelled = false;
    void load(sponsorType).then((result) => {
      if (!cancelled && result.length > 0) setTiers(result);
    });
    return () => {
      cancelled = true;
    };
  }, [sponsorType]);

  return tiers;
}
