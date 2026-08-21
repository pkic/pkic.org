import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createContext, createTestRateLimiter, queryAll, seedEventAndAdmin } from "./helpers/context";
import { handleError } from "../functions/_lib/http";
import { onRequestPost as createInquiry } from "../functions/api/v1/sponsorship/inquiries";

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

async function callEndpoint(handler: (c: any) => Promise<Response>, ctx: any): Promise<Response> {
  try {
    return await handler(ctx);
  } catch (error) {
    return handleError(error);
  }
}

describe("POST /api/v1/sponsorship/inquiries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a sponsorships record at pipeline_stage=new_inquiry", async () => {
    const testEnv = makeEnv();
    const response = await callEndpoint(
      createInquiry,
      createContext(
        testEnv,
        postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {
          contactName: "Dana Sponsor",
          contactEmail: "dana@sponsor-corp.test",
          organizationName: "Sponsor Corp",
          desiredTier: "Gold",
          comments: "Interested in learning more.",
        }),
        {},
      ),
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
      createInquiry,
      createContext(
        testEnv,
        postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {
          contactName: "Dana Sponsor",
          contactEmail: "dana@sponsor-corp.test",
          organizationName: "Sponsor Corp",
          desiredTier: "Leader",
          eventId: "pqc-2026",
        }),
        {},
      ),
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
      createInquiry,
      createContext(
        testEnv,
        postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {
          contactName: "Dana Sponsor",
          contactEmail: "dana@sponsor-corp.test",
          organizationName: "Sponsor Corp",
          desiredTier: "Silver",
        }),
        {},
      ),
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
      createInquiry,
      createContext(
        testEnv,
        postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {
          contactName: "Dana Sponsor",
          contactEmail: "dana@sponsor-corp.test",
          organizationName: "Sponsor Corp",
          desiredTier: "Gold",
        }),
        {},
      ),
    );
    expect(response.status).toBe(201);

    const outbox = await queryAll<{ recipient_email: string }>(
      testEnv.DB,
      "SELECT recipient_email FROM email_outbox WHERE template_key = 'sponsorship-new-inquiry' ORDER BY created_at DESC LIMIT 1",
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0].recipient_email).toBe("sponsorships-team@pkic.org");

    const brochureOutbox = await queryAll<{ recipient_email: string }>(
      testEnv.DB,
      "SELECT recipient_email FROM email_outbox WHERE template_key = 'sponsorship-brochure' ORDER BY created_at DESC LIMIT 1",
    );
    expect(brochureOutbox).toHaveLength(1);
    expect(brochureOutbox[0].recipient_email).toBe("dana@sponsor-corp.test");
  });

  it("returns 400 for missing required fields", async () => {
    const testEnv = makeEnv();
    const response = await callEndpoint(
      createInquiry,
      createContext(testEnv, postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {}), {}),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a tier outside the active shared catalog", async () => {
    const testEnv = makeEnv();
    const response = await callEndpoint(
      createInquiry,
      createContext(
        testEnv,
        postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {
          contactName: "Dana Sponsor",
          contactEmail: "dana@sponsor-corp.test",
          organizationName: "Sponsor Corp",
          desiredTier: "Hardcoded Future Tier",
        }),
        {},
      ),
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
        createInquiry,
        createContext(
          testEnv,
          postRequest("https://pkic.org/api/v1/sponsorship/inquiries", {
            contactName: "Dana Sponsor",
            contactEmail: "dana@sponsor-corp.test",
            organizationName: "Sponsor Corp",
            desiredTier: "Gold",
          }),
          {},
        ),
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
});
