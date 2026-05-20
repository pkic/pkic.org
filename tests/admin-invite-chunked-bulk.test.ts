/**
 * admin-invite-chunked-bulk.test.ts
 *
 * Verifies the chunked-send protocol introduced to support large CSV uploads
 * (>500 invitees).  The frontend:
 *
 *  1. POSTs all invites to the preview endpoint → receives previewToken + inviteDigest
 *  2. Splits the list into 500-row chunks and POSTs each chunk to the bulk
 *     endpoint, passing the original inviteDigest so the HMAC token (signed
 *     against the full list) still validates correctly.
 *
 * Tests:
 *  - Preview response includes inviteDigest
 *  - Bulk accepts a chunk that differs from the full list when inviteDigest matches
 *  - Bulk rejects a chunk without inviteDigest when the chunk ≠ full list
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { createTemplateVersion, activateTemplateVersion } from "../functions/_lib/email/templates";
import { onRequestPost as inviteAttendeesPreview } from "../functions/api/v1/admin/events/[eventSlug]/invites/attendees/preview";
import { onRequestPost as inviteAttendeesBulk } from "../functions/api/v1/admin/events/[eventSlug]/invites/attendees/bulk";
import { handleError } from "../functions/_lib/http";
import type { Env as AppEnv } from "../functions/_lib/types";

const appEnv = env as unknown as AppEnv;

const EVENT_SLUG = "pqc-2026";
let RAW_TOKEN = "chunked-bulk-test-token";

async function seedRequiredTemplates(adminId: string): Promise<void> {
  for (const [key, content, subject] of [
    ["email_layout", "{{{body_html}}}", null],
    ["attendee_invite", "Join: {{registrationUrl}}", "Invite to {{eventName}}"],
  ] as [string, string, string | null][]) {
    const v = await createTemplateVersion(appEnv.DB, {
      templateKey: key,
      content,
      subjectTemplate: subject,
      createdByUserId: adminId,
    });
    await activateTemplateVersion(appEnv.DB, { templateKey: key, version: v.version });
  }
}

function makeRequest(body: unknown): Request {
  return new Request("https://app.test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${RAW_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

describe("attendee invite — chunked bulk send", () => {
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(appEnv.DB);
    const row = (await queryAll<{ id: string }>(appEnv.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    adminId = row.id;
    RAW_TOKEN = await createAdminSession(appEnv.DB, adminId, RAW_TOKEN);
    await seedRequiredTemplates(adminId);
  });

  it("preview response includes inviteDigest", async () => {
    const invites = [
      { email: "a@example.com", firstName: "Alice", lastName: "A" },
      { email: "b@example.com", firstName: "Bob", lastName: "B" },
    ];
    const ctx = createContext(appEnv, makeRequest({ invites }), { eventSlug: EVENT_SLUG });
    const res = await inviteAttendeesPreview(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.previewToken).toBeTypeOf("string");
    expect(body.inviteDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(body.recipientCount).toBe(2);
  });

  it("bulk accepts a chunk with the full-list inviteDigest", async () => {
    // Preview issued for two invitees
    const allInvites = [
      { email: "a@example.com", firstName: "Alice", lastName: "A" },
      { email: "b@example.com", firstName: "Bob", lastName: "B" },
    ];
    const previewCtx = createContext(appEnv, makeRequest({ invites: allInvites }), { eventSlug: EVENT_SLUG });
    const previewRes = await inviteAttendeesPreview(previewCtx);
    const { previewToken, inviteDigest } = (await previewRes.json()) as Record<string, string>;

    // Send only the first invitee as a "chunk" — pass the full-list digest so
    // the token (signed over both invitees) still validates.
    const chunk = [{ email: "a@example.com", firstName: "Alice", lastName: "A" }];
    const bulkCtx = createContext(appEnv, makeRequest({ invites: chunk, previewToken, inviteDigest }), {
      eventSlug: EVENT_SLUG,
    });
    const bulkRes = await inviteAttendeesBulk(bulkCtx);

    expect(bulkRes.status).toBe(200);
    const bulkBody = (await bulkRes.json()) as { success: boolean; created: unknown[] };
    expect(bulkBody.success).toBe(true);
    expect(bulkBody.created).toHaveLength(1);
  });

  it("bulk rejects a chunk when inviteDigest is omitted and chunk ≠ full list", async () => {
    // Preview issued for two invitees
    const allInvites = [
      { email: "a@example.com", firstName: "Alice", lastName: "A" },
      { email: "b@example.com", firstName: "Bob", lastName: "B" },
    ];
    const previewCtx = createContext(appEnv, makeRequest({ invites: allInvites }), { eventSlug: EVENT_SLUG });
    const previewRes = await inviteAttendeesPreview(previewCtx);
    const { previewToken } = (await previewRes.json()) as Record<string, string>;

    // Send only the first invitee without passing inviteDigest — the worker
    // will compute the digest from the chunk alone, which differs from the
    // full-list digest embedded in the token → 409 INVITE_PREVIEW_STALE.
    const chunk = [{ email: "a@example.com", firstName: "Alice", lastName: "A" }];
    const bulkCtx = createContext(appEnv, makeRequest({ invites: chunk, previewToken }), { eventSlug: EVENT_SLUG });
    const bulkRes = await inviteAttendeesBulk(bulkCtx).catch(handleError);

    expect(bulkRes.status).toBe(409);
    const bulkBody = (await bulkRes.json()) as { error: { code: string } };
    expect(bulkBody.error.code).toBe("INVITE_PREVIEW_STALE");
  });
});
