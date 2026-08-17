/**
 * Static lookup tables shared across the importer's data-processing
 * modules (organizations.mjs, non-member-sponsors.mjs, build-migration.mjs).
 * Kept separate so those modules don't need to import from each other or
 * from the orchestrator, avoiding a circular-import risk.
 */

export const WORKING_GROUP_CSVS = {
  ca: "ca.csv",
  cbom: "cbom.csv",
  cm: "cm.csv",
  pkimm: "pkimm.csv",
  pqc: "pqc.csv",
  tcwg: "tcwg.csv",
};
// csv/ec.csv (Executive Council roster) is intentionally excluded — EC
// membership is scope (users.is_ec_member), not this migration.

// (sponsorship reconciliation): maps a YAML `sponsor.sponsoring.<key>`
// event name to the `events` row it should attribute to. Only 3 distinct
// event names exist across all of data/members/*.yaml (checked 2026-07-29),
// small enough to hand-map from content/events/*/index.md front matter
// rather than fuzzy-match against event names — the single generic
// "Post-Quantum Cryptography Conference" row already seeded in D1 doesn't
// distinguish by city/year, so each of these becomes (or reuses, if already
// present by slug) its own `events` row.
export const EVENT_NAME_ALIASES = {
  "Post-Quantum Cryptography Conference Amsterdam 2023": {
    slug: "pqc-conference-amsterdam-nl-2023",
    name: "Post-Quantum Cryptography Conference - Amsterdam 2023",
    timezone: "Europe/Amsterdam",
    startsAt: "2023-11-07",
    endsAt: "2023-11-08",
  },
  "Post-Quantum Cryptography Conference Austin 2025": {
    slug: "pqc-conference-austin-us-2025",
    name: "Post-Quantum Cryptography Conference - Austin 2025",
    timezone: "America/Chicago",
    startsAt: "2025-01-15",
    endsAt: "2025-01-16",
  },
  "Post-Quantum Cryptography Conference Kuala Lumpur 2025": {
    slug: "pqc-conference-kuala-lumpur-my-2025",
    name: "Post-Quantum Cryptography Conference - Kuala Lumpur 2025",
    timezone: "Asia/Kuala_Lumpur",
    startsAt: "2025-10-28",
    endsAt: "2025-10-30",
  },
};
