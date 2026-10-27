import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Routine CI exercises cross-system boundaries; the full suite remains opt-in. */
const criticalJourneys = [
  "covers unified user sign-in via magic link",
  "an organization contact adds a colleague and can take the access away again",
  "covers proposal submission, speaker invitation, confirmation, and profile updates",
  "verified approved-domain registration affiliates once and an organization identity can be selected for the event",
  "a proved work address requires organization confirmation and an incorrect shared-domain representation can be removed",
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
    "member-colleague-self-service.spec.ts",
    "registration-consent-identity.spec.ts",
    "portal-profile.spec.ts",
    "public-navigation-smoke.spec.ts",
    "portal-mobile-navigation.spec.ts",
    "persona-authority.spec.ts",
  ],
  grep: new RegExp(`(?:^| )(${criticalJourneys.map(escapePattern).join("|")})$`),
});
