/**
 * Barrel re-exporting the full public surface of the meeting calendar
 * system, split across shared.ts/admin-series.ts/
 * admin-ics-files.ts/resend.ts/public.ts/portal.ts/triggers.ts.
 * Every route file imports from "../../_lib/services/meeting-
 * calendar" (this directory) exactly as it did when meeting-calendar.ts was
 * one file — no call-site changes required.
 */

export * from "./shared";
export * from "./admin-series";
export * from "./admin-ics-files";
export * from "./resend";
export * from "./public";
export * from "./portal";
export * from "./triggers";
