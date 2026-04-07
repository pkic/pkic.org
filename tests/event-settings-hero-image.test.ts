import { beforeEach, describe, expect, it } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createContext, queryAll, seedEventAndAdmin } from "./helpers/context";
import { handleError } from "../functions/_lib/http";
import { onRequestPatch } from "../functions/api/v1/admin/events/[eventSlug]/settings";
import { normalizeEventHeroImageUrl } from "../functions/_lib/services/events";
import type { Env } from "../functions/_lib/types";

describe("event hero image URL handling", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("normalizes loopback and same-site hero image URLs to site-relative paths", () => {
    expect(
      normalizeEventHeroImageUrl(
        "http://localhost:8788/events/2026/pqc-conference-amsterdam-nl/hero.png?version=1",
        "https://preview.pkic.org",
      ),
    ).toBe("/events/2026/pqc-conference-amsterdam-nl/hero.png?version=1");

    expect(
      normalizeEventHeroImageUrl(
        "https://preview.pkic.org/events/2026/pqc-conference-amsterdam-nl/hero.png",
        "https://preview.pkic.org",
      ),
    ).toBe("/events/2026/pqc-conference-amsterdam-nl/hero.png");

    expect(
      normalizeEventHeroImageUrl(
        "https://cdn.example.test/pkic/hero.png",
        "https://preview.pkic.org",
      ),
    ).toBe("https://cdn.example.test/pkic/hero.png");
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

    const rows = await queryAll<{ settings_json: string }>(
      env.DB,
      "SELECT settings_json FROM events WHERE slug = ?",
      ["pqc-2026"],
    );

    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].settings_json)).toMatchObject({
      heroImageUrl: "/events/2026/pqc-conference-amsterdam-nl/hero.png?version=1",
    });
  });
});