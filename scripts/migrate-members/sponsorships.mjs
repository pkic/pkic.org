import { EVENT_NAME_ALIASES } from "./constants.mjs";

/** Resolve configured per-event sponsorships and report unknown event names. */
export function forEachResolvedEventSponsorship(sponsoring, { onResolved, onUnmatched }) {
  if (!sponsoring || typeof sponsoring !== "object") return;

  for (const [eventName, eventSponsor] of Object.entries(sponsoring)) {
    const tier = String(eventSponsor?.level ?? "").trim();
    if (!tier) continue;
    const alias = EVENT_NAME_ALIASES[eventName];
    if (!alias) {
      onUnmatched({ eventName, tier });
      continue;
    }
    onResolved({ alias, tier });
  }
}
