import { describe, it, expect } from "vitest";
import { D1DatabaseShim } from "./helpers/d1-shim";
import { createContext, createEnv, seedEventAndAdmin } from "./helpers/context";
import { createReferralCode } from "../functions/_lib/services/referrals";
import { resolveEventFrontendRoutes } from "../functions/_lib/services/events";
import { onRequestGet as referralRedirect } from "../functions/r/[code]";
import { onRequestGet as getForms } from "../functions/api/v1/events/[eventSlug]/forms";

describe("event frontend routes and hydration contracts", () => {
  it("resolves configured frontend routes and fallback defaults", () => {
    const configured = resolveEventFrontendRoutes({
      slug: "pqc-2026",
      base_path: null,
      starts_at: null,
      settings_json: JSON.stringify({
        frontend: {
          routes: {
            registration: "/events/custom/register/",
            proposal: "/events/custom/propose",
          },
        },
      }),
    });

    expect(configured.registrationPath).toBe("/events/custom/register/");
    expect(configured.proposalPath).toBe("/events/custom/propose/");
    expect(configured.usedFallback).toBe(true);
    expect(configured.fallbackKeys).toContain("registrationConfirm");

    const defaults = resolveEventFrontendRoutes({ slug: "pqc-2026", base_path: null, starts_at: null, settings_json: "{}" });
    expect(defaults.registrationPath).toBe("/events/pqc-2026/register/");
    expect(defaults.proposalManagePath).toBe("/events/pqc-2026/propose-manage/");
    expect(defaults.usedFallback).toBe(true);
  });

  it("uses base_path from DB when set, ignoring starts_at year derivation", () => {
    const withBasePath = resolveEventFrontendRoutes({
      slug: "pqc-conference-amsterdam-nl",
      base_path: "/events/2026/pqc-conference-amsterdam-nl/",
      starts_at: "2026-12-01T08:00:00.000Z",
      settings_json: "{}",
    });

    expect(withBasePath.registrationPath).toBe("/events/2026/pqc-conference-amsterdam-nl/register/");
    expect(withBasePath.registrationConfirmPath).toBe("/events/2026/pqc-conference-amsterdam-nl/register/confirm/");
    expect(withBasePath.proposalPath).toBe("/events/2026/pqc-conference-amsterdam-nl/propose/");
    expect(withBasePath.registrationManagePath).toBe("/events/2026/pqc-conference-amsterdam-nl/register/manage/");
    expect(withBasePath.proposalManagePath).toBe("/events/2026/pqc-conference-amsterdam-nl/propose-manage/");
  });

  it("falls back to starts_at year when base_path is null", () => {
    const withYear = resolveEventFrontendRoutes({
      slug: "pqc-conference-amsterdam-nl",
      base_path: null,
      starts_at: "2026-12-01T08:00:00.000Z",
      settings_json: "{}",
    });

    expect(withYear.registrationPath).toBe("/events/2026/pqc-conference-amsterdam-nl/register/");
    expect(withYear.registrationConfirmPath).toBe("/events/2026/pqc-conference-amsterdam-nl/register/confirm/");
    expect(withYear.proposalPath).toBe("/events/2026/pqc-conference-amsterdam-nl/propose/");
    expect(withYear.registrationManagePath).toBe("/events/2026/pqc-conference-amsterdam-nl/register/manage/");
    expect(withYear.proposalManagePath).toBe("/events/2026/pqc-conference-amsterdam-nl/propose-manage/");
  });

  it("resolves relative frontend routes against the event base path", () => {
    const relative = resolveEventFrontendRoutes({
      slug: "pqc-conference-amsterdam-nl",
      base_path: "/events/2026/pqc-conference-amsterdam-nl/",
      starts_at: "2026-12-01T08:00:00.000Z",
      settings_json: JSON.stringify({
        frontend: {
          routes: {
            registration: "register/",
            registrationConfirm: "register/confirm/",
            proposal: "propose/",
            registrationManage: "register/manage/",
            proposalManage: "propose-manage/",
            speakerManage: "speaker-manage/",
            inviteDecline: "invite/decline/",
          },
        },
      }),
    });

    // Relative paths must resolve to the same result as the absolute equivalents
    expect(relative.registrationPath).toBe("/events/2026/pqc-conference-amsterdam-nl/register/");
    expect(relative.registrationConfirmPath).toBe("/events/2026/pqc-conference-amsterdam-nl/register/confirm/");
    expect(relative.proposalPath).toBe("/events/2026/pqc-conference-amsterdam-nl/propose/");
    expect(relative.registrationManagePath).toBe("/events/2026/pqc-conference-amsterdam-nl/register/manage/");
    expect(relative.proposalManagePath).toBe("/events/2026/pqc-conference-amsterdam-nl/propose-manage/");
    // All keys configured, so no fallback needed
    expect(relative.usedFallback).toBe(false);
  });

  it("redirects referral links to configured event registration route", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    await db.exec?.(`
      UPDATE events
      SET settings_json = '{"frontend":{"routes":{"registration":"/events/pilot/register/"}}}'
      WHERE id = '${eventId}';
    `);

    const code = await createReferralCode(db, {
      eventId,
      ownerType: "registration",
      ownerId: crypto.randomUUID(),
      length: 7,
    });

    const response = await referralRedirect(createContext(env, new Request(`https://app.test/r/${code}`), { code }));
    const location = response.headers.get("location") ?? "";

    expect(response.status).toBe(302);
    expect(location.startsWith("https://app.test/events/pilot/register/")).toBe(true);
    expect(location.includes(`ref=${code}`)).toBe(true);
    expect(location.includes("source=referral_link")).toBe(true);
  });

  it("returns required terms in forms hydration response", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    await seedEventAndAdmin(db);
    const env = createEnv(db);

    const response = await getForms(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/forms?purpose=event_registration"),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      purpose: string;
      requiredTerms: Array<{ termKey: string; version: string; required: boolean }>;
    };

    expect(payload.purpose).toBe("event_registration");
    expect(payload.requiredTerms.length).toBeGreaterThan(0);
    expect(payload.requiredTerms[0]).toHaveProperty("termKey");
  });
});
