// Prepare the real HTTP graph before timed journeys, as the shared API helper does.
import "../functions/http-router";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import {
  myApplicationsListResponseSchema,
  myApplicationDetailSchema,
  myProfileSchema,
} from "../assets/shared/schemas/me";
import { createMemberSession } from "./helpers/auth";
import { resetDb } from "./helpers/reset-db";
import { insertUser, insertIndividualMembershipForUser } from "./helpers/membership";
import { seedMemberApplication } from "./helpers/member-applications";
import { getAccountProfile } from "../functions/_lib/services/member-self-service";

const EMAIL = "applicant@example.test";
let userId: string;
let headers: { authorization: string };
async function call(path: string, init: RequestInit = {}) {
  return app.fetch(
    new Request(`https://app.test${path}`, init),
    env as never,
    { passThroughOnException() {}, waitUntil() {} } as never,
  );
}
beforeEach(async () => {
  await resetDb();
  userId = await insertUser(env.DB, EMAIL);
  const token = await createMemberSession(env.DB, userId, "own-applications-session");
  headers = { authorization: `Bearer ${token}` };
});
describe("own application history", () => {
  it("reads its pending and historical applications without membership and refuses another applicant's detail", async () => {
    const otherUser = await insertUser(env.DB, "other-applicant@example.test");
    const ownedIds = [];
    for (const stage of ["submitted", "on_hold", "approved", "declined", "withdrawn"]) {
      ownedIds.push(
        await seedMemberApplication({
          applicantUserId: userId,
          applicantEmail: EMAIL,
          stage,
          organizationDomain: null,
        }),
      );
    }
    const foreignId = await seedMemberApplication({
      applicantUserId: otherUser,
      applicantEmail: EMAIL,
      organizationDomain: null,
    });
    const listed = await call("/api/v1/users/current/applications?limit=2", { headers });
    expect(listed.status).toBe(200);
    const page = myApplicationsListResponseSchema.parse(await listed.json());
    expect(page.page).toMatchObject({ total: 5, hasMore: true });
    expect(page.applications).toHaveLength(2);
    for (const id of ownedIds) {
      const detail = await call(`/api/v1/users/current/applications/${id}`, { headers });
      expect(detail.status).toBe(200);
      expect(myApplicationDetailSchema.parse(await detail.json()).id).toBe(id);
    }
    expect((await call(`/api/v1/users/current/applications/${foreignId}`, { headers })).status).toBe(404);
    expect((await call("/api/v1/users/current/applications")).status).toBe(401);
  });

  it("reports membership through another identity without selecting that identity", async () => {
    await insertIndividualMembershipForUser(env.DB, userId, "H6");
    const person = myProfileSchema.parse(await getAccountProfile(env.DB, userId));
    expect(person.identityId).toBeNull();
    expect(person.activeIdentities).toHaveLength(1);
  });
});
