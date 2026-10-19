/**
 * A person a verified address linked to an organization automatically is
 * told once, in the portal and by the identity email, and can keep the link
 * or say it is not their organization, which ends the identity it created.
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  affiliationLinkKeptSchema,
  affiliationOfferDismissalSchema,
  affiliationOfferResponseSchema,
} from "../assets/shared/schemas/affiliation-offer";
import { linkVerifiedAddressToDomainOrganization } from "../functions/_lib/services/identities/email-domain-link";
import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
import { issueContributorProfileAddresses } from "../functions/_lib/services/people/profile-addresses";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { insertGroupSeat, readPublicPersonProfile } from "./helpers/person-profile";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { seedOrganizationAggregate, insertOrganization, insertUser } from "./helpers/membership";
import { keepLinkedOrganization } from "../functions/_lib/services/identities/organization-link-notices";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";

let tokenCounter = 0;

async function signedIn(email: string): Promise<{ userId: string; token: string }> {
  const userId = await insertUser(env.DB, email);
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET email_verified_at = ?, email_verification_method = 'magic_link' WHERE id = ?",
    ).bind(at, userId),
    env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, source, show_on_organization_profile, invited_at,
         started_at, created_at, updated_at)
       VALUES (?, ?, NULL, 'account', 0, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), userId, at, at, at, at),
  ]);
  tokenCounter += 1;
  return { userId, token: await createMemberSession(env.DB, userId, `link-notice-token-${tokenCounter}`) };
}

async function linkedOrganization(email: string) {
  const organizationId = await insertOrganization(env.DB, "Open Claimed Co");
  await env.DB.prepare(
    `INSERT INTO organization_domain_claims (id, domain, organization_id, application_id, created_at, updated_at)
     VALUES (?, 'open-claimed.example', ?, NULL, ?, ?)`,
  )
    .bind(crypto.randomUUID(), organizationId, nowIso(), nowIso())
    .run();
  const person = await signedIn(email);
  const linked = await linkVerifiedAddressToDomainOrganization(env.DB, {
    userId: person.userId,
    normalizedEmail: email,
  });
  expect(linked?.organizationId).toBe(organizationId);
  return { organizationId, identityId: linked!.identityId, ...person };
}

function call(token: string, path: string, body?: unknown): Promise<Response> {
  return callApi(env, `/api/v1/users/current/identities/offer${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function offerOf(token: string) {
  return affiliationOfferResponseSchema.parse(await (await call(token, "")).json()).offer;
}

async function contributorLink(exposure = "identity", hidden = false) {
  const f = await linkedOrganization("person@open-claimed.example");
  let memberId: string;
  let seatedIdentityId = f.identityId;
  if (exposure === "identity") {
    seatedIdentityId = (await env.DB.prepare("SELECT id FROM identities WHERE user_id=? AND organization_id IS NULL")
      .bind(f.userId)
      .first<string>("id"))!;
    const prepared = buildCreateIndividualMemberStatements(env.DB, seatedIdentityId, "H6", nowIso());
    memberId = prepared.memberId;
    await env.DB.batch(prepared.statements);
  } else {
    memberId = await seedOrganizationAggregate(env.DB, f.organizationId);
    await env.DB.prepare("UPDATE identities SET show_on_organization_profile=0 WHERE id=?").bind(f.identityId).run();
  }
  await insertGroupSeat(
    "linked-person",
    { publicRoster: exposure !== "leadership" },
    { userId: f.userId, identityId: seatedIdentityId, memberId },
  );
  if (exposure === "leadership") {
    await env.DB.prepare("UPDATE groups SET public_leadership=1 WHERE slug='linked-person'").run();
    const groupId = await env.DB.prepare("SELECT id FROM groups WHERE slug='linked-person'").first<string>("id");
    await grantGroupLeadershipCapacity(env.DB, groupId!, f.userId);
  }
  await issueContributorProfileAddresses(env.DB, nowIso(), 50);
  if (hidden)
    await env.DB.prepare("UPDATE identities SET hidden_from_public_profile=1 WHERE id=?").bind(f.identityId).run();
  return f;
}
const personLinkRequests = () =>
  queryAll(env.DB, "SELECT id,resource_type,resource_id FROM site_publication_requests ORDER BY sequence");

describe("telling a person about an automatic organization link", () => {
  beforeEach(resetDb);

  it.each([
    { action: "keep", exposure: "identity", hidden: false, changed: true },
    { action: "decline", exposure: "identity", hidden: false, changed: true },
    { action: "keep", exposure: "identity", hidden: true, changed: false },
    { action: "decline", exposure: "identity", hidden: true, changed: false },
    { action: "decline", exposure: "seat", hidden: true, changed: true },
    { action: "decline", exposure: "leadership", hidden: true, changed: true },
  ])("publishes changed addressed person data on a link response: %j", async (options) => {
    const f = await contributorLink(options.exposure, options.hidden);
    const before = await readPublicPersonProfile(f.userId);
    const beforeRequests = await personLinkRequests();
    const attempt = () =>
      options.action === "keep"
        ? call(f.token, "/confirmations", { organizationId: f.organizationId, jobTitle: "Contributor engineer" })
        : call(f.token, "/dismissals", { organizationId: f.organizationId });
    const response = await attempt();
    expect(response.status, await response.clone().text()).toBe(201);
    const after = await readPublicPersonProfile(f.userId);
    if (options.changed) expect(after).not.toEqual(before);
    else expect(after).toEqual(before);
    const saved = await personLinkRequests();
    expect(saved.slice(beforeRequests.length)).toEqual(
      options.changed
        ? [
            expect.objectContaining({
              resource_type: options.action === "keep" ? "identity_profile" : "user_profile",
              resource_id: options.action === "keep" ? f.identityId : f.userId,
            }),
          ]
        : [],
    );
    expect((await attempt()).status).toBe(201);
    expect(await personLinkRequests()).toEqual(saved);
    expect(await readPublicPersonProfile(f.userId)).toEqual(after);
  });

  it.each(["keep", "decline"].flatMap((action) => ["request", "audit"].map((failure) => ({ action, failure }))))(
    "rolls back a person-only link response and retries: %j",
    async ({ action, failure }) => {
      const f = await contributorLink();
      const before = await readPublicPersonProfile(f.userId);
      const beforeRequests = await personLinkRequests();
      const auditAction = action === "keep" ? "organization_link_kept" : "organization_link_declined";
      const attempt = () =>
        action === "keep"
          ? call(f.token, "/confirmations", { organizationId: f.organizationId, jobTitle: "Contributor engineer" })
          : call(f.token, "/dismissals", { organizationId: f.organizationId });
      await env.DB.prepare(`CREATE TRIGGER fail_person_link BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
      ${failure === "audit" ? `WHEN NEW.action='${auditAction}'` : ""}
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_PERSON_LINK_FAILURE'); END`).run();
      try {
        expect((await attempt()).status).toBe(500);
        expect(await readPublicPersonProfile(f.userId)).toEqual(before);
        expect(await personLinkRequests()).toEqual(beforeRequests);
        expect(
          await env.DB.prepare("SELECT answered_at FROM organization_link_notices WHERE identity_id=?")
            .bind(f.identityId)
            .first("answered_at"),
        ).toBeNull();
        expect(
          await queryAll(env.DB, "SELECT organization_id FROM affiliation_offer_dismissals WHERE user_id=?", [
            f.userId,
          ]),
        ).toEqual([]);
        expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action=?", [auditAction])).toEqual([]);
      } finally {
        await env.DB.prepare("DROP TRIGGER fail_person_link").run();
      }
      const response = await attempt();
      expect(response.status, await response.clone().text()).toBe(201);
      expect(await readPublicPersonProfile(f.userId)).not.toEqual(before);
      expect(await personLinkRequests()).toHaveLength(beforeRequests.length + 1);
    },
  );

  it.each(["keep", "decline"])("publishes a public linked identity on %s", async (action) => {
    const f = await linkedOrganization("public@open-claimed.example");
    await seedOrganizationAggregate(env.DB, f.organizationId);
    const attempt = () =>
      action === "keep"
        ? call(f.token, "/confirmations", { organizationId: f.organizationId, jobTitle: "Public engineer" })
        : call(f.token, "/dismissals", { organizationId: f.organizationId });
    const saved = await attempt();
    expect(saved.status, await saved.clone().text()).toBe(201);
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toHaveLength(1);
    const repeated = await attempt();
    expect(repeated.status, await repeated.clone().text()).toBe(201);
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toHaveLength(1);
  });

  it.each([
    { visibility: "hidden", action: "keep" },
    { visibility: "hidden", action: "decline" },
    { visibility: "inactive", action: "keep" },
    { visibility: "inactive", action: "decline" },
    { visibility: "nonmember", action: "keep" },
    { visibility: "nonmember", action: "decline" },
  ])("keeps a $visibility $action response quiet", async ({ visibility, action }) => {
    const f = await linkedOrganization("private@open-claimed.example");
    if (visibility !== "nonmember") {
      const memberId = await seedOrganizationAggregate(env.DB, f.organizationId);
      if (visibility === "inactive")
        await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(memberId).run();
      else
        await env.DB.prepare("UPDATE identities SET show_on_organization_profile=0 WHERE id=?")
          .bind(f.identityId)
          .run();
    }
    const response =
      action === "keep"
        ? await call(f.token, "/confirmations", { organizationId: f.organizationId, jobTitle: "Private engineer" })
        : await call(f.token, "/dismissals", { organizationId: f.organizationId });
    expect(response.status, await response.clone().text()).toBe(201);
    if (action === "decline")
      expect(
        await env.DB.prepare("SELECT ended_at FROM identities WHERE id=?").bind(f.identityId).first("ended_at"),
      ).not.toBeNull();
    else
      expect(
        await env.DB.prepare("SELECT job_title FROM identities WHERE id=?").bind(f.identityId).first("job_title"),
      ).toBe("Private engineer");
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toEqual([]);
  });

  it.each(["keep", "decline"])(
    "rolls back the %s response when publication fails, then permits retry",
    async (action) => {
      const f = await linkedOrganization("atomic@open-claimed.example");
      await seedOrganizationAggregate(env.DB, f.organizationId);
      const before = await queryAll(env.DB, "SELECT job_title,ended_at,updated_at FROM identities WHERE id=?", [
        f.identityId,
      ]);
      const attempt = () =>
        action === "keep"
          ? call(f.token, "/confirmations", { organizationId: f.organizationId, jobTitle: "Public engineer" })
          : call(f.token, "/dismissals", { organizationId: f.organizationId });
      await env.DB.prepare(`CREATE TRIGGER fail_link_publication BEFORE INSERT ON site_publication_requests
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_LINK_PUBLICATION_FAILURE'); END`).run();
      try {
        expect((await attempt()).status).toBe(500);
        expect(
          await queryAll(env.DB, "SELECT job_title,ended_at,updated_at FROM identities WHERE id=?", [f.identityId]),
        ).toEqual(before);
        expect(
          await env.DB.prepare("SELECT answered_at FROM organization_link_notices WHERE identity_id=?")
            .bind(f.identityId)
            .first("answered_at"),
        ).toBeNull();
        expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toEqual([]);
      } finally {
        await env.DB.prepare("DROP TRIGGER fail_link_publication").run();
      }
      const retried = await attempt();
      expect(retried.status, await retried.clone().text()).toBe(201);
      expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toHaveLength(1);
    },
  );

  it("keeps the notice open and leaves no audit/request when a concurrent title edit wins", async () => {
    const f = await linkedOrganization("race@open-claimed.example");
    await seedOrganizationAggregate(env.DB, f.organizationId);
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        "UPDATE identities SET job_title='Concurrent engineer',updated_at='2099-01-01T00:00:00.000Z' WHERE id=?",
      )
        .bind(f.identityId)
        .run(),
    );
    await expect(
      keepLinkedOrganization(db, {
        userId: f.userId,
        organizationId: f.organizationId,
        jobTitle: "Losing title",
        at: nowIso(),
      }),
    ).rejects.toMatchObject({ status: 409, code: "IDENTITY_CHANGED" });
    expect(
      await env.DB.prepare("SELECT job_title FROM identities WHERE id=?").bind(f.identityId).first("job_title"),
    ).toBe("Concurrent engineer");
    expect(
      await env.DB.prepare("SELECT answered_at FROM organization_link_notices WHERE identity_id=?")
        .bind(f.identityId)
        .first("answered_at"),
    ).toBeNull();
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='organization_link_kept'")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toEqual([]);
  });

  it("tells them once in the portal and by the identity email, and keeping the link closes the notice", async () => {
    const { organizationId, identityId, userId, token } = await linkedOrganization("ana@open-claimed.example");
    expect(await offerOf(token)).toEqual({
      kind: "linked",
      organization: { id: organizationId, name: "Open Claimed Co" },
      identityId,
      domain: "open-claimed.example",
    });
    expect(
      await queryAll(
        env.DB,
        `SELECT recipient_user_id, json_extract(payload_json, '$.changeMessage') AS message FROM email_outbox
          WHERE template_key = 'organization-identity-changed'`,
      ),
    ).toEqual([
      {
        recipient_user_id: userId,
        message: expect.stringContaining(
          "You're now linked to Open Claimed Co (from your @open-claimed.example email)",
        ),
      },
    ]);

    // Keeping the link says what they do there: an organization identity always has a job title.
    expect(affiliationLinkKeptSchema.safeParse({ organizationId }).success).toBe(false);
    const kept = await call(
      token,
      "/confirmations",
      affiliationLinkKeptSchema.parse({ organizationId, jobTitle: "Security engineer" }),
    );
    expect(kept.status, await kept.clone().text()).toBe(201);
    expect(
      await env.DB.prepare("SELECT job_title FROM identities WHERE organization_id=? AND ended_at IS NULL")
        .bind(organizationId)
        .first("job_title"),
    ).toBe("Security engineer");
    expect(await offerOf(token)).toBeNull();
    expect(
      await queryAll(env.DB, "SELECT ended_at IS NULL AS active FROM identities WHERE id = ?", [identityId]),
    ).toEqual([{ active: 1 }]);
  });

  it("ends the identity on 'not my organization' and never links that organization again", async () => {
    const { organizationId, identityId, userId, token } = await linkedOrganization("bo@open-claimed.example");
    const declined = await call(token, "/dismissals", affiliationOfferDismissalSchema.parse({ organizationId }));
    expect(declined.status, await declined.clone().text()).toBe(201);

    expect(
      await queryAll(env.DB, "SELECT ended_at IS NOT NULL AS ended FROM identities WHERE id = ?", [identityId]),
    ).toEqual([{ ended: 1 }]);
    expect(
      await queryAll(env.DB, "SELECT action FROM audit_log WHERE action = 'organization_link_declined'"),
    ).toHaveLength(1);
    expect(await offerOf(token)).toBeNull();
    expect(
      await linkVerifiedAddressToDomainOrganization(env.DB, { userId, normalizedEmail: "bo@open-claimed.example" }),
    ).toBeNull();
  });
});
