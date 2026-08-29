/**
 * Barrel re-exporting the full public surface of the voting system,
 * split across shared.ts/tally.ts/lifecycle.ts/ballots.ts/
 * closing.ts/public.ts/member-read-model.ts/proposals.ts. Every route
 * file imports from "../../_lib/services/votes" (this directory) exactly as
 * it did when votes.ts was one file — no call-site changes required.
 */

export * from "./shared";
export * from "./tally";
export * from "./lifecycle";
export * from "./ballots";
export * from "./representative-notification-intents";
export * from "./closing";
export * from "./public";
export * from "./member-read-model";
export * from "./group-read-model";
export * from "./group-proposal-read-model";
export * from "./group-proposal-participation";
export * from "./group-proposal-decisions";
export * from "./manual-transitions";
export * from "./proposals";
export * from "./statistics";
