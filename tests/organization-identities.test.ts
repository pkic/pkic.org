import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCreateIdentityStatement,
  buildEndIdentityStatement,
  isActiveIdentityForMember,
  listActiveIdentitiesForUser,
} from "../functions/_lib/services/membership/identities";
import { queryAll } from "./helpers/context";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);

describe("acting identity persistence", () => {
  it("allows one user to hold exact active identities for two organizations", async () => {
    const userId = await insertUser(env.DB);
    const organizationAId = await insertOrganization(env.DB, "Identity Org A");
    const organizationBId = await insertOrganization(env.DB, "Identity Org B");
    const memberAId = await seedOrganizationAggregate(env.DB, organizationAId, "A");
    const memberBId = await seedOrganizationAggregate(env.DB, organizationBId, "B");

    const identityAId = await addRepresentative(env.DB, memberAId, userId);
    const identityBId = await addRepresentative(env.DB, memberBId, userId);

    expect(new Set((await listActiveIdentitiesForUser(env.DB, userId)).map((identity) => identity.id))).toEqual(
      new Set([identityAId, identityBId]),
    );
    expect(await isActiveIdentityForMember(env.DB, memberAId, userId)).toBe(true);
    expect(await isActiveIdentityForMember(env.DB, memberBId, userId)).toBe(true);
  });

  it("rejects a second unresolved identity for the same user and organization", async () => {
    const userId = await insertUser(env.DB);
    const organizationId = await insertOrganization(env.DB);
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await addRepresentative(env.DB, memberId, userId);

    await expect(
      buildCreateIdentityStatement(env.DB, {
        userId,
        organizationId,
        source: "staff",
        startImmediately: true,
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_ALREADY_ACTIVE" });
  });

  it("keeps an ended identity immutable and creates a linked successor for a later role period", async () => {
    const userId = await insertUser(env.DB);
    const organizationId = await insertOrganization(env.DB);
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const firstIdentityId = await addRepresentative(env.DB, memberId, userId);
    await env.DB.batch([buildEndIdentityStatement(env.DB, { identityId: firstIdentityId })]);

    const successor = await buildCreateIdentityStatement(env.DB, {
      userId,
      organizationId,
      source: "staff",
      startImmediately: true,
    });
    await env.DB.batch([successor.statement]);

    expect(
      await queryAll<{ id: string; predecessor_identity_id: string | null; ended_at: string | null }>(
        env.DB,
        "SELECT id, predecessor_identity_id, ended_at FROM identities WHERE user_id = ? ORDER BY created_at, id",
        [userId],
      ),
    ).toEqual([
      { id: firstIdentityId, predecessor_identity_id: null, ended_at: expect.any(String) },
      { id: successor.identityId, predecessor_identity_id: firstIdentityId, ended_at: null },
    ]);
  });
});
