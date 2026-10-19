import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { proposalIdentityFixture as fixture, submitIdentityProposal as submit } from "./helpers/proposal-identity";
import { queryAll } from "./helpers/context";
import { insertIndividualMember, insertOrganization } from "./helpers/membership";
import { insertGroupSeat, readPublicPersonProfile } from "./helpers/person-profile";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";
import { prepareIdentityProfileCompletion } from "../functions/_lib/services/identities/profile-completion";
import { issueContributorProfileAddresses } from "../functions/_lib/services/people/profile-addresses";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { nowIso } from "../functions/_lib/utils/time";

beforeEach(resetDb);

async function contributorCompletion(options: { addressed?: boolean; hidden?: boolean } = {}) {
  const f = await fixture();
  const memberId = await env.DB.prepare(`SELECT member.id FROM members member JOIN identities identity
    ON identity.organization_id=member.organization_id WHERE identity.id=?`)
    .bind(f.identityId)
    .first<string>("id");
  if (options.addressed !== false) {
    await insertGroupSeat(
      "completion-contributor",
      { publicRoster: true },
      { userId: f.userId, identityId: f.identityId, memberId: memberId! },
    );
    await issueContributorProfileAddresses(env.DB, nowIso(), 50);
  }
  await env.DB.prepare(
    "UPDATE members SET status='inactive' WHERE organization_id IN (SELECT organization_id FROM identities WHERE user_id=?)",
  )
    .bind(f.userId)
    .run();
  if (options.hidden)
    await env.DB.prepare("UPDATE identities SET hidden_from_public_profile=1 WHERE id=?").bind(f.identityId).run();
  return f;
}
const completionRequests = () =>
  queryAll(env.DB, "SELECT id,resource_id FROM site_publication_requests ORDER BY sequence");

describe("publication after proposal profile completion", () => {
  it.each([
    { addressed: true, hidden: false },
    { addressed: true, hidden: true },
    { addressed: false, hidden: false },
  ])("publishes only visible person-only completion during submission: %j", async (options) => {
    const f = await contributorCompletion(options);
    const before = await readPublicPersonProfile(f.userId);
    const beforeRequests = await completionRequests();
    const response = await submit(f.body, f.token);
    expect(response.status, await response.clone().text()).toBe(200);
    const after = await readPublicPersonProfile(f.userId);
    const changed = options.addressed && !options.hidden;
    if (changed) expect(after).not.toEqual(before);
    else expect(after).toEqual(before);
    expect(await completionRequests()).toHaveLength(beforeRequests.length + (changed ? 1 : 0));
    await env.DB.batch(
      prepareIdentityProfileCompletion(env.DB, {
        userId: f.userId,
        identityId: f.identityId,
        biography: "Do not overwrite the completed biography",
        at: nowIso(),
        actor: { type: "user", id: f.userId },
      }),
    );
    expect(
      await env.DB.prepare("SELECT biography FROM identities WHERE id=?").bind(f.identityId).first("biography"),
    ).toBe(f.body.proposer.bio);
    expect(await completionRequests()).toHaveLength(beforeRequests.length + (changed ? 1 : 0));
  });

  it("publishes person-only empty links through the personal identity fallback", async () => {
    const f = await insertIndividualMember(env.DB, "H6", "person-completion-fallback@example.test");
    await insertGroupSeat("person-completion-fallback", { publicRoster: true }, f);
    await issueContributorProfileAddresses(env.DB, nowIso(), 50);
    await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(f.memberId).run();
    await env.DB.prepare("UPDATE identities SET biography='Kept biography' WHERE id=?").bind(f.identityId).run();
    const before = await readPublicPersonProfile(f.userId);
    const beforeRequests = await completionRequests();
    const input = {
      userId: f.userId,
      identityId: null,
      biography: "Ignored biography",
      links: ["https://example.test/completion"],
      at: nowIso(),
      actor: { type: "user", id: f.userId },
    };
    await env.DB.batch(prepareIdentityProfileCompletion(env.DB, input));
    expect(await readPublicPersonProfile(f.userId)).not.toEqual(before);
    expect(
      await env.DB.prepare("SELECT biography FROM identities WHERE id=?").bind(f.identityId).first("biography"),
    ).toBe("Kept biography");
    expect(await completionRequests()).toHaveLength(beforeRequests.length + 1);
    await env.DB.batch(prepareIdentityProfileCompletion(env.DB, input));
    expect(await completionRequests()).toHaveLength(beforeRequests.length + 1);
  });

  it.each(["request", "audit"])(
    "rolls back person-only proposal completion on %s failure and retries",
    async (failure) => {
      const f = await contributorCompletion();
      const before = await readPublicPersonProfile(f.userId);
      const beforeRequests = await completionRequests();
      await env.DB.prepare(`CREATE TRIGGER fail_person_completion BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
      ${failure === "audit" ? "WHEN NEW.action='identity_profile_completed'" : ""}
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_PERSON_COMPLETION_FAILURE'); END`).run();
      try {
        expect((await submit(f.body, f.token)).status).toBe(500);
        expect(await readPublicPersonProfile(f.userId)).toEqual(before);
        expect(await completionRequests()).toEqual(beforeRequests);
        expect(await queryAll(env.DB, "SELECT id FROM session_proposals")).toEqual([]);
        expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='identity_profile_completed'")).toEqual(
          [],
        );
      } finally {
        await env.DB.prepare("DROP TRIGGER fail_person_completion").run();
      }
      const response = await submit(f.body, f.token);
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await readPublicPersonProfile(f.userId)).not.toEqual(before);
      expect(await completionRequests()).toHaveLength(beforeRequests.length + 1);
    },
  );

  it("leaves no completion request when a concurrent biography fills the blank first", async () => {
    const f = await contributorCompletion();
    const beforeRequests = await completionRequests();
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE identities SET biography='Winning biography' WHERE id=?").bind(f.identityId).run(),
    );
    await db.batch(
      prepareIdentityProfileCompletion(db, {
        userId: f.userId,
        identityId: f.identityId,
        biography: "Losing biography",
        at: nowIso(),
        actor: { type: "user", id: f.userId },
      }),
    );
    expect(
      await env.DB.prepare("SELECT biography FROM identities WHERE id=?").bind(f.identityId).first("biography"),
    ).toBe("Winning biography");
    expect(await completionRequests()).toEqual(beforeRequests);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='identity_profile_completed'")).toEqual([]);
  });

  it("publishes blank public bio completion during proposal submission and preserves nonempty data", async () => {
    const f = await fixture();
    const response = await submit(f.body, f.token);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT resource_id,reason_code FROM site_publication_requests")).toEqual([
      { resource_id: f.userId, reason_code: "user_profile_changed" },
    ]);
    await env.DB.batch(
      prepareIdentityProfileCompletion(env.DB, {
        userId: f.userId,
        identityId: f.identityId,
        biography: "Must not replace the saved biography",
        at: nowIso(),
        actor: { type: "user", id: f.userId },
      }),
    );
    expect(
      await env.DB.prepare("SELECT biography FROM identities WHERE id=?").bind(f.identityId).first("biography"),
    ).toBe(f.body.proposer.bio);
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toHaveLength(1);
  });

  it.each(["hidden", "inactive", "nonmember"])(
    "keeps blank %s identity completion quiet even with another public identity",
    async (visibility) => {
      const f = await fixture();
      let identityId = f.identityId;
      const organizationId = await env.DB.prepare("SELECT organization_id FROM identities WHERE id=?")
        .bind(f.identityId)
        .first("organization_id");
      if (visibility === "hidden")
        await env.DB.prepare("UPDATE identities SET show_on_organization_profile=0 WHERE id=?")
          .bind(f.identityId)
          .run();
      else if (visibility === "inactive")
        await env.DB.prepare("UPDATE members SET status='inactive' WHERE organization_id=?").bind(organizationId).run();
      else {
        const prepared = await buildCreateIdentityStatement(env.DB, {
          userId: f.userId,
          organizationId: await insertOrganization(env.DB, "Nonmember completion organization"),
          source: "staff",
          startImmediately: true,
          jobTitle: "Nonmember role",
        });
        await env.DB.batch([prepared.statement]);
        identityId = prepared.identityId;
      }
      await env.DB.batch(
        prepareIdentityProfileCompletion(env.DB, {
          userId: f.userId,
          identityId,
          biography: "Private biography",
          links: ["https://example.test/private"],
          at: nowIso(),
          actor: { type: "user", id: f.userId },
        }),
      );
      expect(
        await env.DB.prepare("SELECT biography FROM identities WHERE id=?").bind(identityId).first("biography"),
      ).toBe("Private biography");
      expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toEqual([]);
    },
  );

  it("publishes only the empty links filled on a personal member identity selected by fallback", async () => {
    const f = await insertIndividualMember(env.DB, "H6", "completion-personal@example.test");
    await env.DB.prepare("UPDATE identities SET biography='Kept biography' WHERE id=?").bind(f.identityId).run();
    const input = {
      userId: f.userId,
      identityId: null,
      biography: "Ignored biography",
      links: ["https://example.test/personal"],
      at: nowIso(),
      actor: { type: "user", id: f.userId },
    };
    await env.DB.batch(prepareIdentityProfileCompletion(env.DB, input));
    await env.DB.batch(prepareIdentityProfileCompletion(env.DB, input));
    expect(await queryAll(env.DB, "SELECT biography,links_json FROM identities WHERE id=?", [f.identityId])).toEqual([
      { biography: "Kept biography", links_json: '["https://example.test/personal"]' },
    ]);
    expect(await queryAll(env.DB, "SELECT resource_id FROM site_publication_requests")).toEqual([
      { resource_id: f.userId },
    ]);
  });

  it("rolls back proposal/profile completion when publication fails, then retries successfully", async () => {
    const f = await fixture();
    await env.DB.prepare(`CREATE TRIGGER fail_completion_publication BEFORE INSERT ON site_publication_requests
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_COMPLETION_PUBLICATION_FAILURE'); END`).run();
    try {
      expect((await submit(f.body, f.token)).status).toBe(500);
      expect(
        await env.DB.prepare("SELECT biography FROM identities WHERE id=?").bind(f.identityId).first("biography"),
      ).toBeNull();
      expect(await queryAll(env.DB, "SELECT id FROM session_proposals")).toEqual([]);
      expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toEqual([]);
      expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='identity_profile_completed'")).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_completion_publication").run();
    }
    const retried = await submit(f.body, f.token);
    expect(retried.status, await retried.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toHaveLength(1);
  });
});
