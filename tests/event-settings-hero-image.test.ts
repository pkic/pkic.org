import { beforeEach, describe, expect, it } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createContext, queryAll, seedEventAndAdmin } from "./helpers/context";
import { handleError } from "../functions/_lib/http";
import { onRequestPatch } from "../functions/api/v1/admin/events/[eventSlug]/settings";
import { normalizeHttpOrSameOriginUrl } from "../assets/shared/schemas/urls";
import type { Env } from "../functions/_lib/types";
import { adminEventSettingsSchema } from "../assets/shared/schemas/admin-events";

describe("event hero image URL handling", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("normalizes loopback and same-site hero image URLs to site-relative paths", () => {
    expect(
      normalizeHttpOrSameOriginUrl(
        "http://localhost:8788/events/2026/pqc-conference-amsterdam-nl/hero.png?version=1",
        "https://preview.pkic.org",
      ),
    ).toBe("/events/2026/pqc-conference-amsterdam-nl/hero.png?version=1");

    expect(
      normalizeHttpOrSameOriginUrl(
        "https://preview.pkic.org/events/2026/pqc-conference-amsterdam-nl/hero.png",
        "https://preview.pkic.org",
      ),
    ).toBe("/events/2026/pqc-conference-amsterdam-nl/hero.png");

    expect(normalizeHttpOrSameOriginUrl("https://cdn.example.test/pkic/hero.png", "https://preview.pkic.org")).toBe(
      "https://cdn.example.test/pkic/hero.png",
    );
  });

  it("stores normalized hero image paths via the admin settings endpoint", async () => {
    await seedEventAndAdmin(workerEnv.DB);

    const env = {
      ...workerEnv,
      ADMIN_API_KEY: "test-admin-key",
      APP_BASE_URL: "https://preview.pkic.org",
    } as Env;

    const request = new Request("https://preview.pkic.org/api/v1/admin/events/pqc-2026/settings", {
      method: "PATCH",
      headers: {
        authorization: "Bearer test-admin-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        heroImageUrl: "http://localhost:8788/events/2026/pqc-conference-amsterdam-nl/hero.png?version=1",
      }),
    });

    let response: Response;
    try {
      response = await onRequestPatch(createContext(env, request, { eventSlug: "pqc-2026" }));
    } catch (error) {
      response = handleError(error);
    }

    expect(response.status).toBe(200);

    const rows = await queryAll<{ settings_json: string }>(env.DB, "SELECT settings_json FROM events WHERE slug = ?", [
      "pqc-2026",
    ]);

    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].settings_json)).toMatchObject({
      heroImageUrl: "/events/2026/pqc-conference-amsterdam-nl/hero.png?version=1",
    });
  });

  it("rejects custom settings that try to overwrite dedicated settings", () => {
    expect(
      adminEventSettingsSchema.safeParse({ settings: { heroImageUrl: "https://evil.test/hero.png" } }).success,
    ).toBe(false);
    expect(adminEventSettingsSchema.safeParse({ settings: { forms: { event_registration: "evil" } } }).success).toBe(
      false,
    );
    expect(adminEventSettingsSchema.parse({ settings: { attendeePortalEnabled: true } }).settings).toEqual({
      attendeePortalEnabled: true,
    });
  });

  it("rejects a reserved-key override at the mounted request boundary without mutating D1", async () => {
    await seedEventAndAdmin(workerEnv.DB);
    const env = {
      ...workerEnv,
      ADMIN_API_KEY: "test-admin-key",
      APP_BASE_URL: "https://preview.pkic.org",
    } as Env;
    const request = new Request("https://preview.pkic.org/api/v1/admin/events/pqc-2026/settings", {
      method: "PATCH",
      headers: { authorization: "Bearer test-admin-key", "content-type": "application/json" },
      body: JSON.stringify({ venue: "Expected venue", settings: { venue: "Injected venue" } }),
    });

    let response: Response;
    try {
      response = await onRequestPatch(createContext(env, request, { eventSlug: "pqc-2026" }));
    } catch (error) {
      response = handleError(error);
    }

    expect(response.status).toBe(400);
    const [row] = await queryAll<{ settings_json: string }>(env.DB, "SELECT settings_json FROM events WHERE slug = ?", [
      "pqc-2026",
    ]);
    expect(JSON.parse(row.settings_json)).not.toHaveProperty("venue");
  });
});
