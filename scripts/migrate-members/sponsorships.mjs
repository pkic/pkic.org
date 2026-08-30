import { EVENT_NAME_ALIASES } from "./constants.mjs";

/** Normalize the legacy YAML tier vocabulary without creating fake sponsors. */
export function normalizeImportedSponsorTier(value) {
  const tier = String(value ?? "").trim();
  return !tier || tier.toLowerCase() === "none" ? null : tier;
}

/** Resolve configured per-event sponsorships and report unknown event names. */
export function forEachResolvedEventSponsorship(sponsoring, { onResolved, onUnmatched }) {
  if (!sponsoring || typeof sponsoring !== "object") return;

  for (const [eventName, eventSponsor] of Object.entries(sponsoring)) {
    const tier = normalizeImportedSponsorTier(eventSponsor?.level);
    if (!tier) continue;
    const alias = EVENT_NAME_ALIASES[eventName];
    if (!alias) {
      onUnmatched({ eventName, tier });
      continue;
    }
    onResolved({ alias, tier });
  }
}
