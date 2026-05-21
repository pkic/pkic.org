import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { createContext, seedEventAndAdmin } from "./helpers/context";
import { createReferralCode } from "../functions/_lib/services/referrals";
import { resolveEventFrontendRoutes } from "../functions/_lib/services/events";
import { onRequestGet as referralRedirect } from "../functions/r/[code]";
import app from "../functions/router";

describe("event frontend routes and hydration contracts", () => {
  beforeEach(async () => {
    await resetDb();
  });
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

    const defaults = resolveEventFrontendRoutes({
      slug: "pqc-2026",
      base_path: null,
      starts_at: null,
      settings_json: "{}",
    });
    expect(defaults.registrationPath).toBe("/events/pqc-2026/register/");
    expect(defaults.proposalManagePath).toBe("/events/pqc-2026/propose/manage/");
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
    expect(withBasePath.proposalManagePath).toBe("/events/2026/pqc-conference-amsterdam-nl/propose/manage/");
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
    expect(withYear.proposalManagePath).toBe("/events/2026/pqc-conference-amsterdam-nl/propose/manage/");
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
            proposalManage: "propose/manage/",
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
    expect(relative.proposalManagePath).toBe("/events/2026/pqc-conference-amsterdam-nl/propose/manage/");
    // All keys configured, so no fallback needed
    expect(relative.usedFallback).toBe(false);
  });

  it("redirects referral links to configured event registration route", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.prepare(
      `
      UPDATE events
      SET settings_json = '{"frontend":{"routes":{"registration":"/events/pilot/register/"}}}'
      WHERE id = '${eventId}';
    `,
    ).run();

    const code = await createReferralCode(env.DB, {
      eventId,
      ownerType: "registration",
      ownerId: crypto.randomUUID(),
      length: 7,
    });

    const response = await referralRedirect(createContext(env, new Request(`https://app.test/r/${code}`), { code }));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain("/events/pilot/register/?event=pqc-2026");
    expect(html).toContain(`ref=${code}`);
    expect(html).toContain("source=referral_link");
  });

  it("returns required terms in forms hydration response", async () => {
    await seedEventAndAdmin(env.DB);

    const response = await app.fetch(
      new Request("https://app.test/api/v1/events/pqc-2026/forms?purpose=event_registration"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
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

  it("honours an explicit form link over the current active form", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const registrationLinkedKey = "reg-linked";
    const registrationNewestKey = "reg-newest";
    const proposalLinkedKey = "prop-linked";

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO forms (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
         VALUES (?, ?, 'global', NULL, 'event_registration', 'active', ?, NULL, datetime('now', '-2 days'), datetime('now', '-2 days'))`,
      ).bind(crypto.randomUUID(), registrationLinkedKey, "Linked registration form"),
      env.DB.prepare(
        `INSERT INTO form_fields (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
         VALUES (?, (SELECT id FROM forms WHERE key = ?), 'interest', 'Interest', 'text', 0, NULL, NULL, 0, datetime('now'))`,
      ).bind(crypto.randomUUID(), registrationLinkedKey),
      env.DB.prepare(
        `INSERT INTO forms (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
         VALUES (?, ?, 'event', ?, 'event_registration', 'active', ?, NULL, datetime('now'), datetime('now'))`,
      ).bind(crypto.randomUUID(), registrationNewestKey, eventId, "Newest registration form"),
      env.DB.prepare(
        `INSERT INTO form_fields (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
         VALUES (?, (SELECT id FROM forms WHERE key = ?), 'country', 'Country', 'text', 0, NULL, NULL, 0, datetime('now'))`,
      ).bind(crypto.randomUUID(), registrationNewestKey),
      env.DB.prepare(
        `INSERT INTO forms (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
         VALUES (?, ?, 'event', ?, 'proposal_submission', 'active', ?, NULL, datetime('now'), datetime('now'))`,
      ).bind(crypto.randomUUID(), proposalLinkedKey, eventId, "Linked proposal form"),
      env.DB.prepare(
        `INSERT INTO form_fields (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
         VALUES (?, (SELECT id FROM forms WHERE key = ?), 'topic', 'Topic', 'text', 0, NULL, NULL, 0, datetime('now'))`,
      ).bind(crypto.randomUUID(), proposalLinkedKey),
      env.DB.prepare(
        `UPDATE events
         SET settings_json = json_set(json_set(settings_json, '$.forms.event_registration', ?), '$.forms.proposal_submission', ?)
         WHERE id = ?`,
      ).bind(registrationLinkedKey, proposalLinkedKey, eventId),
    ]);

    const registrationResponse = await app.fetch(
      new Request("https://app.test/api/v1/events/pqc-2026/forms?purpose=event_registration"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(registrationResponse.status).toBe(200);
    const registrationPayload = (await registrationResponse.json()) as { form: { key: string } | null };
    expect(registrationPayload.form?.key).toBe(registrationLinkedKey);

    const proposalResponse = await app.fetch(
      new Request("https://app.test/api/v1/events/pqc-2026/forms?purpose=proposal_submission"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(proposalResponse.status).toBe(200);
    const proposalPayload = (await proposalResponse.json()) as { form: { key: string } | null };
    expect(proposalPayload.form?.key).toBe(proposalLinkedKey);
  });

  it("treats an explicit null form link as no form", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO forms (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
         VALUES (?, ?, 'event', ?, 'event_registration', 'active', ?, NULL, datetime('now'), datetime('now'))`,
      ).bind(crypto.randomUUID(), "reg-current", eventId, "Current registration form"),
      env.DB.prepare(
        `INSERT INTO form_fields (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
         VALUES (?, (SELECT id FROM forms WHERE key = ?), 'interest', 'Interest', 'text', 0, NULL, NULL, 0, datetime('now'))`,
      ).bind(crypto.randomUUID(), "reg-current"),
      env.DB.prepare(
        `UPDATE events
         SET settings_json = json_set(settings_json, '$.forms.event_registration', json('null'))
         WHERE id = ?`,
      ).bind(eventId),
    ]);

    const response = await app.fetch(
      new Request("https://app.test/api/v1/events/pqc-2026/forms?purpose=event_registration"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { form: { key: string } | null };
    expect(payload.form).toBeNull();
  });
});
