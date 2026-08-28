/**
 * Barrel re-exporting the full public surface of the sponsorship system,
 * split across tier-catalog.ts/tier-config.ts/checkout.ts/event-tiers.ts/
 * pipeline.ts/portal.ts. Every route file imports from
 * "../../_lib/services/sponsorship" (this directory) exactly as it did when
 * sponsorship.ts was one file — no call-site changes required.
 */

export * from "./tier-config";
export * from "./tier-catalog";
export * from "./checkout";
export * from "./event-tiers";
export * from "./read-model";
export * from "./authorization";
export * from "./event-history";
export * from "./logo";
export * from "./pipeline";
export * from "./portal";
