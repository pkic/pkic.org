import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { organizationContactDetailsResponseSchema } from "../assets/shared/schemas/organization-contact-details";
import { resolveUserSessionFromRequest } from "../functions/_lib/auth/user-session";
import { organizationContactAccess } from "../functions/_lib/services/organization-contact-access";
import {
  readOrganizationContactDetails,
  saveOrganizationContactDetails,
} from "../functions/_lib/services/organization-contact-details";
import { buildOrganizationParticipationWarningEmail } from "../functions/_lib/services/membership/participation-warning";
import { resolveOrganizationNoticeRecipient } from "../functions/_lib/services/membership/organization-notice-recipient";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import {
  insertOrgRepresentative,
  insertUser,
  addRepresentative,
  assignRepresentativeRole,
  REPRESENTATIVE_ROLE_IDS,
} from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const fields = {
  email: "office@example.test",
  phone: "+1 202 555 0100",
  postalAddress: { lines: ["123 Example St", "Suite 2"], city: "Example City", region: "DC", postalCode: "20001" },
  countryCode: "US",
};

async function fixture() {
  const org = await insertOrgRepresentative(env.DB);
  await assignRepresentativeRole(env.DB, org.memberId, org.userId, REPRESENTATIVE_ROLE_IDS.primaryContact);
  const token = await createMemberSession(env.DB, org.userId, crypto.randomUUID(), undefined, org.identityId);
  return { ...org, token };
}

function request(organizationId: string, token?: string, body?: unknown) {
  return new Request(`https://app.test/api/v1/organizations/${organizationId}/contacts/details`, {
    method: body === undefined ? "GET" : "PUT",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function staff(permission: "organizations:read" | "organizations:write") {
  const userId = await insertUser(env.DB);
  await env.DB.prepare(`INSERT INTO permission_grants
    (id, user_id, permission, granted_by_user_id, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), userId, permission, userId, "2026-10-17T00:00:00.000Z")
    .run();
  return { userId, token: await createAdminSession(env.DB, userId, crypto.randomUUID()) };
}

async function auditCount() {
  return env.DB.prepare(
    "SELECT count(*) AS count FROM audit_log WHERE action='organization_contact_details_updated'",
  ).first<{ count: number }>();
}

beforeEach(resetDb);

describe("private organization contact details", () => {
  it("lets primary and secondary contacts directly save, reload, and clear private fields", async () => {
    const org = await fixture();
    const initial = await callApi(env, request(org.organizationId, org.token));
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({ contactDetails: null });
    const saved = await callApi(
      env,
      request(org.organizationId, org.token, { ...fields, email: "OFFICE@example.test", revision: 0 }),
    );
    expect(saved.status).toBe(200);
    const result = organizationContactDetailsResponseSchema.parse(await saved.json());
    expect(result.contactDetails).toMatchObject({ ...fields, revision: 1, updatedByUserId: org.userId });
    expect(
      await env.DB.prepare(`SELECT json_extract(postal_address_json, '$.city') AS city,
      json_extract(postal_address_json, '$.postalCode') AS postalCode FROM organization_contact_details
      WHERE organization_id=?`)
        .bind(org.organizationId)
        .first(),
    ).toEqual({ city: "Example City", postalCode: "20001" });
    expect(saved.headers.get("cache-control")).toContain("no-store");

    const secondary = await insertUser(env.DB);
    const identityId = await addRepresentative(env.DB, org.memberId, secondary);
    await assignRepresentativeRole(env.DB, org.memberId, secondary, REPRESENTATIVE_ROLE_IDS.secondaryContact);
    const token = await createMemberSession(env.DB, secondary, crypto.randomUUID(), undefined, identityId);
    const reload = await callApi(env, request(org.organizationId, token));
    expect(await reload.json()).toEqual(result);
    const cleared = await callApi(
      env,
      request(org.organizationId, token, {
        email: null,
        phone: null,
        postalAddress: null,
        countryCode: null,
        revision: 1,
      }),
    );
    expect(cleared.status).toBe(200);
    expect(organizationContactDetailsResponseSchema.parse(await cleared.json()).contactDetails).toMatchObject({
      email: null,
      phone: null,
      postalAddress: null,
      countryCode: null,
      revision: 2,
      updatedByUserId: secondary,
    });
    expect(await auditCount()).toEqual({ count: 2 });
    const audit = await env.DB.prepare(
      "SELECT details_json FROM audit_log WHERE action='organization_contact_details_updated'",
    ).all();
    expect(JSON.stringify(audit.results)).not.toContain(fields.email);
    for (const table of ["organization_content_reviews", "site_publication_requests", "email_outbox"]) {
      expect(await env.DB.prepare(`SELECT count(*) AS count FROM ${table}`).first()).toEqual({ count: 0 });
    }
  });

  it("uses exact staff read/write permissions on the same resource", async () => {
    const org = await fixture();
    const reader = await staff("organizations:read");
    const writer = await staff("organizations:write");
    expect((await callApi(env, request(org.organizationId, reader.token))).status).toBe(200);
    expect((await callApi(env, request(org.organizationId, reader.token, { ...fields, revision: 0 }))).status).toBe(
      403,
    );
    expect((await callApi(env, request(org.organizationId, writer.token))).status).toBe(403);
    expect((await callApi(env, request(org.organizationId, writer.token, { ...fields, revision: 0 }))).status).toBe(
      200,
    );
  });

  it("keeps private channels out of member profiles and public publication snapshots", async () => {
    const org = await fixture();
    await env.DB.prepare("UPDATE organizations SET slug='private-contact-fixture' WHERE id=?")
      .bind(org.organizationId)
      .run();
    const baseline = await readSitePublicationSnapshot(env.DB, []);
    expect((await callApi(env, request(org.organizationId, org.token, { ...fields, revision: 0 }))).status).toBe(200);
    const published = await readSitePublicationSnapshot(env.DB, []);
    expect(published).toEqual(baseline);
    const profile = await callApi(env, `/api/v1/organizations/${org.organizationId}/profile`, {
      headers: { authorization: `Bearer ${org.token}` },
    });
    expect(profile.status).toBe(200);
    const payload = JSON.stringify(await profile.json());
    expect(payload).not.toContain(fields.email);
    expect(payload).not.toContain(fields.phone);
    expect(payload).not.toContain(fields.postalAddress.lines[0]);
  });

  it("denies ordinary representatives, other organizations, anonymous callers, and API keys", async () => {
    const org = await fixture();
    const ordinary = await insertOrgRepresentative(env.DB, { organizationId: org.organizationId });
    const ordinaryToken = await createMemberSession(env.DB, ordinary.userId, crypto.randomUUID());
    const other = await fixture();
    for (const body of [undefined, { ...fields, revision: 0 }]) {
      expect((await callApi(env, request(org.organizationId, ordinaryToken, body))).status).toBe(403);
      expect((await callApi(env, request(org.organizationId, other.token, body))).status).toBe(404);
      expect((await callApi(env, request(org.organizationId, undefined, body))).status).toBe(401);
      expect((await callApi(env, request(org.organizationId, env.ADMIN_API_KEY, body))).status).toBeGreaterThanOrEqual(
        400,
      );
    }
  });

  it.each([
    { email: "invalid" },
    { phone: " " },
    { postalAddress: "123 Example St" },
    { postalAddress: { ...fields.postalAddress, city: "a".repeat(201) } },
    { postalAddress: { ...fields.postalAddress, lines: ["a".repeat(201)] } },
    { postalAddress: { ...fields.postalAddress, lines: Array(11).fill("Line") } },
    { postalAddress: { ...fields.postalAddress, postalCode: "a".repeat(41) } },
    { postalAddress: { ...fields.postalAddress, unexpected: true } },
    { countryCode: "ZZ" },
    { revision: -1 },
    { revision: 0.5 },
    { name: "Copied profile" },
  ])("rejects invalid input without writes: %j", async (invalid) => {
    const org = await fixture();
    expect(
      (await callApi(env, request(org.organizationId, org.token, { ...fields, revision: 0, ...invalid }))).status,
    ).toBe(400);
    expect(await auditCount()).toEqual({ count: 0 });
  });

  it("refuses stale creates and updates without overwriting data or adding audit rows", async () => {
    const org = await fixture();
    for (const [revision, status] of [
      [0, 200],
      [0, 409],
      [1, 200],
      [1, 409],
    ]) {
      const response = await callApi(env, request(org.organizationId, org.token, { ...fields, revision }));
      expect(response.status).toBe(status);
    }
    expect(await auditCount()).toEqual({ count: 2 });
    expect((await readOrganizationContactDetails(env.DB, org.organizationId)).contactDetails?.revision).toBe(2);
  });

  it("commits only one competing first save and its audit record", async () => {
    const org = await fixture();
    const results = await Promise.all([
      callApi(env, request(org.organizationId, org.token, { ...fields, revision: 0 })),
      callApi(
        env,
        request(org.organizationId, org.token, { ...fields, email: "other-office@example.test", revision: 0 }),
      ),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await auditCount()).toEqual({ count: 1 });
  });

  it("rolls back contact changes if the same-batch audit fails", async () => {
    const org = await fixture();
    await env.DB.prepare(`CREATE TRIGGER reject_private_contact_audit BEFORE INSERT ON audit_log
      WHEN NEW.action='organization_contact_details_updated' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END;`).run();
    try {
      expect((await callApi(env, request(org.organizationId, org.token, { ...fields, revision: 0 }))).status).toBe(500);
      expect((await readOrganizationContactDetails(env.DB, org.organizationId)).contactDetails).toBeNull();
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_private_contact_audit").run();
    }
  });

  it("rechecks contact roles inside the database boundary after request preflight", async () => {
    const org = await fixture();
    const session = await resolveUserSessionFromRequest(env.DB, request(org.organizationId, org.token), env);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?")
        .bind("2026-10-17T00:00:00.000Z", org.userId)
        .run(),
    );
    const access = await organizationContactAccess(racingDb, session, org.organizationId, "organizations:write");
    await expect(
      saveOrganizationContactDetails(access.db, access.actor, org.organizationId, {
        ...fields,
        countryCode: "US",
        revision: 0,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await auditCount()).toEqual({ count: 0 });
    expect((await readOrganizationContactDetails(env.DB, org.organizationId)).contactDetails).toBeNull();
  });

  it("refuses a private read if staff permission is revoked after preflight", async () => {
    const org = await fixture();
    const reader = await staff("organizations:read");
    const session = await resolveUserSessionFromRequest(env.DB, request(org.organizationId, reader.token), env);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE user_id=?")
        .bind("2026-10-17T00:00:00.000Z", reader.userId)
        .run(),
    );
    const access = await organizationContactAccess(racingDb, session, org.organizationId, "organizations:read");
    await expect(readOrganizationContactDetails(access.db, org.organizationId)).rejects.toMatchObject({ status: 409 });
  });
});

describe("organization membership notice recipients", () => {
  it("uses the secondary contact when the primary contact role expires", async () => {
    const org = await fixture();
    const secondary = await insertUser(env.DB, "secondary@example.test");
    await addRepresentative(env.DB, org.memberId, secondary);
    await assignRepresentativeRole(env.DB, org.memberId, secondary, REPRESENTATIVE_ROLE_IDS.secondaryContact);
    await env.DB.prepare("UPDATE user_roles SET expires_at='2020-01-01T00:00:00.000Z' WHERE user_id=?")
      .bind(org.userId)
      .run();
    expect(await resolveOrganizationNoticeRecipient(env.DB, org.organizationId)).toMatchObject({
      recipientEmail: "secondary@example.test",
      source: "representative",
      noCurrentRepresentatives: false,
    });
  });
  it("prefers current contact roles, then retains the organization mailbox after everyone leaves", async () => {
    const org = await fixture();
    expect((await callApi(env, request(org.organizationId, org.token, { ...fields, revision: 0 }))).status).toBe(200);
    expect(await resolveOrganizationNoticeRecipient(env.DB, org.organizationId)).toMatchObject({
      source: "representative",
      noCurrentRepresentatives: false,
    });
    await env.DB.prepare("UPDATE identities SET ended_at=? WHERE organization_id=?")
      .bind(new Date().toISOString(), org.organizationId)
      .run();
    const draft = await buildOrganizationParticipationWarningEmail(env.DB, org.organizationId, "November 15, 2026");
    expect(draft).toMatchObject({
      templateKey: "membership-participation-warning",
      recipientEmail: fields.email,
      data: { noCurrentRepresentatives: true },
    });
    expect(JSON.stringify(draft.data)).toContain("__pkicEmailPlainText");
    expect((await callApi(env, request(org.organizationId, org.token))).status).toBeGreaterThanOrEqual(400);
    const reader = await staff("organizations:read");
    expect((await callApi(env, request(org.organizationId, reader.token))).status).toBe(200);
  });

  it("refuses a missing mailbox instead of sending to an ended representative", async () => {
    const org = await fixture();
    await env.DB.prepare("UPDATE identities SET ended_at=? WHERE organization_id=?")
      .bind(new Date().toISOString(), org.organizationId)
      .run();
    await expect(buildOrganizationParticipationWarningEmail(env.DB, org.organizationId)).rejects.toMatchObject({
      code: "ORGANIZATION_CONTACT_MISSING",
    });
  });
});
