import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createTestRateLimiter, queryAll, seedEventAndAdmin } from "./helpers/context";
import app from "../functions/router";
import { renderEmail } from "../functions/_lib/email/render";

function makeEnv(overrides: Partial<typeof env> = {}) {
  return { ...env, IP_RATE_LIMITER: createTestRateLimiter(100), ...overrides } as typeof env;
}

function postRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callEndpoint(request: Request, runtimeEnv: typeof env): Promise<Response> {
  return app.fetch(request, runtimeEnv as any, { passThroughOnException: () => {}, waitUntil: () => {} } as any);
}

describe("POST /api/v1/sponsorship/inquiries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a sponsorships record at pipeline_stage=new_inquiry", async () => {
    const testEnv = makeEnv();
    const response = await callEndpoint(
      postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {
        contactName: "Dana Sponsor",
        contactEmail: "dana@sponsor-corp.test",
        organizationName: "Sponsor Corp",
        tier: "Gold",
        comments: "Interested in learning more.",
      }),
      testEnv,
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { sponsorshipId: string; pipelineStage: string };
    expect(body.pipelineStage).toBe("new_inquiry");

    const rows = await queryAll<{ pipeline_stage: string; sponsor_type: string; tier: string; notes: string | null }>(
      testEnv.DB,
      "SELECT pipeline_stage, sponsor_type, tier, notes FROM sponsorships WHERE id = ?",
      [body.sponsorshipId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].pipeline_stage).toBe("new_inquiry");
    expect(rows[0].tier).toBe("Gold");
    expect(rows[0].notes).toBe("Interested in learning more.");
    expect(
      await queryAll(testEnv.DB, "SELECT id FROM audit_log WHERE action = 'sponsorship_inquiry_submitted'"),
    ).toHaveLength(1);
  });

  it("infers sponsor_type=event when an eventId is provided", async () => {
    const testEnv = makeEnv();
    const { eventId } = await seedEventAndAdmin(testEnv.DB);

    const response = await callEndpoint(
      postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {
        contactName: "Dana Sponsor",
        contactEmail: "dana@sponsor-corp.test",
        organizationName: "Sponsor Corp",
        tier: "Leader",
        eventId: "pqc-2026",
      }),
      testEnv,
    );

    const body = (await response.json()) as { sponsorshipId: string };
    const rows = await queryAll<{ sponsor_type: string; event_id: string | null }>(
      testEnv.DB,
      "SELECT sponsor_type, event_id FROM sponsorships WHERE id = ?",
      [body.sponsorshipId],
    );
    expect(rows[0].sponsor_type).toBe("event");
    expect(rows[0].event_id).toBe(eventId);
  });

  it("defaults to sponsor_type=consortium when no event context is provided", async () => {
    const testEnv = makeEnv();
    const response = await callEndpoint(
      postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {
        contactName: "Dana Sponsor",
        contactEmail: "dana@sponsor-corp.test",
        organizationName: "Sponsor Corp",
        tier: "Silver",
      }),
      testEnv,
    );

    const body = (await response.json()) as { sponsorshipId: string };
    const rows = await queryAll<{ sponsor_type: string }>(
      testEnv.DB,
      "SELECT sponsor_type FROM sponsorships WHERE id = ?",
      [body.sponsorshipId],
    );
    expect(rows[0].sponsor_type).toBe("consortium");
  });

  it("queues the sponsorship-new-inquiry staff notification email", async () => {
    const testEnv = makeEnv({ SPONSORSHIP_NOTIFICATION_EMAIL: "sponsorships-team@pkic.org" });
    const response = await callEndpoint(
      postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {
        contactName: "Dana Sponsor",
        contactEmail: "dana@sponsor-corp.test",
        organizationName: "Sponsor Corp",
        tier: "Gold",
      }),
      testEnv,
    );
    expect(response.status).toBe(201);

    const outbox = await queryAll<{ recipient_email: string }>(
      testEnv.DB,
      "SELECT recipient_email FROM email_outbox WHERE template_key = 'sponsorship-new-inquiry' ORDER BY created_at DESC LIMIT 1",
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0].recipient_email).toBe("sponsorships-team@pkic.org");

    const [staffPayload] = await queryAll<{ payload_json: string }>(
      testEnv.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'sponsorship-new-inquiry' ORDER BY created_at DESC LIMIT 1",
    );
    expect(JSON.parse(staffPayload!.payload_json)).toMatchObject({
      adminUrl: "https://app.test/admin/#/sponsorships",
    });

    const brochureOutbox = await queryAll<{ recipient_email: string }>(
      testEnv.DB,
      "SELECT recipient_email FROM email_outbox WHERE template_key = 'sponsorship-brochure' ORDER BY created_at DESC LIMIT 1",
    );
    expect(brochureOutbox).toHaveLength(1);
    expect(brochureOutbox[0].recipient_email).toBe("dana@sponsor-corp.test");
  });

  it("renders public inquiry text literally in the staff email", async () => {
    const testEnv = makeEnv({ SPONSORSHIP_NOTIFICATION_EMAIL: "sponsorships-team@pkic.org" });
    const maliciousNotes = [
      "[Review updated agreement](https://attacker.invalid/phish)",
      "![tracking pixel](https://attacker.invalid/pixel.gif)",
      '<img src="https://attacker.invalid/raw.gif">',
      "<https://attacker.invalid/autolink>",
      "https://attacker.invalid/bare",
      "# Urgent",
    ].join("\n\n");
    const response = await callEndpoint(
      postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {
        contactName: "Dana [Sponsor](https://attacker.invalid/name)",
        contactEmail: "dana@sponsor-corp.test",
        organizationName: "Sponsor <img src=https://attacker.invalid/org.gif>",
        tier: "Gold",
        comments: maliciousNotes,
      }),
      testEnv,
    );
    expect(response.status).toBe(201);

    const [sponsorship] = await queryAll<{ notes: string | null }>(
      testEnv.DB,
      "SELECT notes FROM sponsorships ORDER BY created_at DESC LIMIT 1",
    );
    expect(sponsorship!.notes).toBe(maliciousNotes);

    const [outbox] = await queryAll<{ payload_json: string }>(
      testEnv.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'sponsorship-new-inquiry' ORDER BY created_at DESC LIMIT 1",
    );
    const payload = JSON.parse(outbox!.payload_json) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("contactName");
    expect(payload).not.toHaveProperty("organizationName");
    expect(payload).not.toHaveProperty("notes");
    const rendered = await renderEmail(
      "- Contact: {{contactNameText}} ({{contactEmailText}})\n- Organization: {{organizationNameText}}\n- Notes: {{notesText}}",
      payload,
      "<!doctype html><html><body>{{{body_html}}}</body></html>",
    );

    expect(rendered.html).toContain("Review updated agreement");
    expect(rendered.text).toContain("attacker.invalid/phish");
    expect(rendered.html).not.toMatch(/<(?:a|img)\b[^>]*(?:href|src)=["']?https:\/\/attacker\.invalid/i);
    expect(rendered.html).not.toContain("<h1>Urgent</h1>");
  });

  it("returns 400 for missing required fields", async () => {
    const testEnv = makeEnv();
    const response = await callEndpoint(postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {}), testEnv);
    expect(response.status).toBe(400);
  });

  it("rate limits invalid requests before body validation", async () => {
    const testEnv = makeEnv({ IP_RATE_LIMITER: createTestRateLimiter(1) });

    const invalid = await callEndpoint(postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {}), testEnv);
    expect(invalid.status).toBe(400);

    const limited = await callEndpoint(
      postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {
        contactName: "Dana Sponsor",
        contactEmail: "dana@sponsor-corp.test",
        organizationName: "Sponsor Corp",
        tier: "Gold",
      }),
      testEnv,
    );
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(await queryAll(testEnv.DB, "SELECT id FROM sponsorships")).toHaveLength(0);
  });

  it("rejects a tier outside the active shared catalog", async () => {
    const testEnv = makeEnv();
    const response = await callEndpoint(
      postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {
        contactName: "Dana Sponsor",
        contactEmail: "dana@sponsor-corp.test",
        organizationName: "Sponsor Corp",
        tier: "Hardcoded Future Tier",
      }),
      testEnv,
    );

    expect(response.status).toBe(422);
    expect(await queryAll(testEnv.DB, "SELECT id FROM sponsorships")).toHaveLength(0);
  });

  it("rolls back the sponsorship, event, emails, and audit as one transaction", async () => {
    const testEnv = makeEnv();
    await testEnv.DB.prepare(
      `CREATE TRIGGER fail_sponsorship_inquiry_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'sponsorship_inquiry_submitted'
       BEGIN
         SELECT RAISE(ABORT, 'forced sponsorship inquiry audit failure');
       END`,
    ).run();

    try {
      const response = await callEndpoint(
        postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {
          contactName: "Dana Sponsor",
          contactEmail: "dana@sponsor-corp.test",
          organizationName: "Sponsor Corp",
          tier: "Gold",
        }),
        testEnv,
      );

      expect(response.status).toBe(500);
      expect(await queryAll(testEnv.DB, "SELECT id FROM sponsorships")).toHaveLength(0);
      expect(await queryAll(testEnv.DB, "SELECT id FROM sponsorship_events")).toHaveLength(0);
      expect(
        await queryAll(
          testEnv.DB,
          "SELECT id FROM email_outbox WHERE template_key IN ('sponsorship-brochure', 'sponsorship-new-inquiry')",
        ),
      ).toHaveLength(0);
      expect(
        await queryAll(testEnv.DB, "SELECT id FROM audit_log WHERE action = 'sponsorship_inquiry_submitted'"),
      ).toHaveLength(0);
    } finally {
      await testEnv.DB.prepare("DROP TRIGGER fail_sponsorship_inquiry_audit").run();
    }
  });

  it("accepts an inquiry with no selected tier without inventing a catalog tier", async () => {
    const testEnv = makeEnv();
    const response = await callEndpoint(
      postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {
        contactName: "Dana Sponsor",
        contactEmail: "dana@sponsor-corp.test",
        organizationName: "Sponsor Corp",
        tier: null,
      }),
      testEnv,
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { sponsorshipId: string };
    const rows = await queryAll<{ tier: string | null }>(testEnv.DB, "SELECT tier FROM sponsorships WHERE id = ?", [
      body.sponsorshipId,
    ]);
    expect(rows).toEqual([{ tier: null }]);
    const [staffEmail] = await queryAll<{ payload_json: string }>(
      testEnv.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'sponsorship-new-inquiry'",
    );
    expect(JSON.parse(staffEmail!.payload_json)).toMatchObject({ tierText: "Not specified" });
  });

  it("rejects an unknown event before it can create an unlinked event sponsorship", async () => {
    const testEnv = makeEnv();
    const response = await callEndpoint(
      postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {
        contactName: "Dana Sponsor",
        contactEmail: "dana@sponsor-corp.test",
        organizationName: "Sponsor Corp",
        tier: "Leader",
        eventId: "does-not-exist",
      }),
      testEnv,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "UNKNOWN_EVENT" } });
    expect(await queryAll(testEnv.DB, "SELECT id FROM sponsorships")).toHaveLength(0);
  });

  it("exposes only active D1-backed tiers through the public catalog", async () => {
    const testEnv = makeEnv();
    await testEnv.DB.prepare(
      "UPDATE sponsorship_tier_catalog SET active = 0 WHERE sponsor_type = 'consortium' AND tier = 'Bronze'",
    ).run();

    try {
      const response = await callEndpoint(
        new Request("https://pkic.org/api/v1/sponsorship/tiers?sponsorType=consortium"),
        testEnv,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("s-maxage=900");
      await expect(response.json()).resolves.toEqual({
        sponsorType: "consortium",
        tiers: [{ tier: "Silver" }, { tier: "Gold" }, { tier: "Platinum" }, { tier: "Titanium" }, { tier: "Diamond" }],
      });
    } finally {
      await testEnv.DB.prepare(
        "UPDATE sponsorship_tier_catalog SET active = 1 WHERE sponsor_type = 'consortium' AND tier = 'Bronze'",
      ).run();
    }
  });

  it("validates the public catalog sponsorship type through the shared query contract", async () => {
    const response = await callEndpoint(
      new Request("https://pkic.org/api/v1/sponsorship/tiers?sponsorType=unsupported"),
      makeEnv(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
});
