import { dateTimeLocalToIso } from "../../assets/shared/timezone.ts";

/**
 * Static lookup tables shared across the importer's data-processing
 * modules (organizations.mjs, non-member-sponsors.mjs, build-migration.mjs).
 * Kept separate so those modules don't need to import from each other or
 * from the orchestrator, avoiding a circular-import risk.
 */

export const GROUP_ROSTER_CSVS = {
  ca: { filename: "ca.csv", type: "working_group" },
  cbom: { filename: "cbom.csv", type: "working_group" },
  cm: { filename: "cm.csv", type: "working_group" },
  pkimm: { filename: "pkimm.csv", type: "working_group" },
  pqc: { filename: "pqc.csv", type: "working_group" },
  tcwg: { filename: "tcwg.csv", type: "working_group" },
  board: { filename: "board.csv", type: "board", optional: true },
  "executive-council": { filename: "ec.csv", type: "board", optional: true },
};

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
    // Authored registration opens at 08:30; final networking has no stated end.
    // content/events/2023/pqc-conference-amsterdam-nl/index.md
    startsAt: dateTimeLocalToIso("2023-11-07T08:30", "Europe/Amsterdam"),
    endsAt: null,
  },
  "Post-Quantum Cryptography Conference Austin 2025": {
    slug: "pqc-conference-austin-us-2025",
    name: "Post-Quantum Cryptography Conference - Austin 2025",
    timezone: "America/Chicago",
    // Authored registration and explicit End of Day Two marker.
    // content/events/2025/pqc-conference-austin-us/index.md
    startsAt: dateTimeLocalToIso("2025-01-15T08:30", "America/Chicago"),
    endsAt: dateTimeLocalToIso("2025-01-16T18:00", "America/Chicago"),
  },
  "Post-Quantum Cryptography Conference Kuala Lumpur 2025": {
    slug: "pqc-conference-kuala-lumpur-my-2025",
    name: "Post-Quantum Cryptography Conference - Kuala Lumpur 2025",
    timezone: "Asia/Kuala_Lumpur",
    // Authored registration and explicit End of Day Three marker.
    // content/events/2025/pqc-conference-kuala-lumpur-my/_index.md
    startsAt: dateTimeLocalToIso("2025-10-28T08:30", "Asia/Kuala_Lumpur"),
    endsAt: dateTimeLocalToIso("2025-10-30T17:00", "Asia/Kuala_Lumpur"),
  },
};
