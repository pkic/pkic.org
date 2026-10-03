import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Routine CI exercises cross-system boundaries; the full suite remains opt-in. */
const criticalJourneys = [
  "covers unified user sign-in via magic link",
  "covers proposal submission, speaker invitation, confirmation, and profile updates",
  "event confirmation joins nobody; explicit organization consent joins once and an identity can then be selected for the event",
  "a member uploads a headshot through the disclaimer and crop flow",
  "public search accepts focus and closes with Escape",
  "mobile navigation opens and closes with Escape",
  "the drawer opens, closes on Escape, and returns focus to its toggle",
  "the backdrop closes the drawer",
  "the toggle is reachable and operable from the keyboard alone",
  "the narrow drawer exposes the same authorized destinations as the desktop sidebar",
  "a read-only staff persona reads applications and cannot change one",
];
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default defineConfig({
  ...base,
  testMatch: [
    "browser-rendering.spec.ts",
    "registration-consent-identity.spec.ts",
    "portal-profile.spec.ts",
    "public-navigation-smoke.spec.ts",
    "portal-mobile-navigation.spec.ts",
    "persona-authority.spec.ts",
  ],
  grep: new RegExp(`(?:^| )(${criticalJourneys.map(escapePattern).join("|")})$`),
});
