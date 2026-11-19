import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { organizationCurrentApplicationResponseSchema } from "../assets/shared/schemas/organization-self-service";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { insertOrganization, insertUser } from "./helpers/membership";
import { seedMemberApplication } from "./helpers/member-applications";
import { resetDb } from "./helpers/reset-db";

async function represent(organizationId: string, email: string, jobTitle: string) {
  const userId = await insertUser(env.DB, email);
  const { identityId, statement } = await buildCreateIdentityStatement(env.DB, {
    userId,
    organizationId,
    source: "staff",
    jobTitle,
    startImmediately: true,
  });
  await env.DB.batch([statement]);
  const token = await createMemberSession(env.DB, userId, `current-application-${crypto.randomUUID()}`);
  return { userId, identityId, cookie: `pkic_session=${token}` };
}

function currentApplication(organizationId: string, cookie: string) {
  // The representative check, then the application with its applicant's identity.
  return callApi(
    env,
    `/api/v1/organizations/${organizationId}/applications/current`,
    { headers: { cookie } },
    { maxRoundTrips: 2 },
  );
}

describe("an organization's current membership application", () => {
  beforeEach(resetDb);

  it("shows its representatives who applied and where it stands, and nobody else", async () => {
    const organizationId = await insertOrganization(env.DB, "Applying Org");
    const applicant = await represent(organizationId, "applicant@applying.example", "Chief Architect");
    const colleague = await represent(organizationId, "colleague@applying.example", "Engineer");
    const outsider = await represent(await insertOrganization(env.DB, "Other Org"), "out@other.example", "CTO");

    const none = await currentApplication(organizationId, colleague.cookie);
    expect(none.status).toBe(200);
    expect(organizationCurrentApplicationResponseSchema.parse(await none.json())).toEqual({ application: null });

    const applicationId = await seedMemberApplication({
      applicantEmail: "applicant@applying.example",
      applicantUserId: applicant.userId,
      // The copy kept on the application is never shown; the identity is.
      applicantName: "Stale Copy",
      organizationName: "Applying Org",
      stage: "processing",
    });
    await env.DB.prepare("UPDATE member_applications SET organization_id=? WHERE id=?")
      .bind(organizationId, applicationId)
      .run();

    const open = await currentApplication(organizationId, colleague.cookie);
    expect(open.status).toBe(200);
    expect(organizationCurrentApplicationResponseSchema.parse(await open.json())).toMatchObject({
      application: {
        stage: "processing",
        applicant: {
          id: applicant.identityId,
          userId: applicant.userId,
          userName: "Test",
          email: "applicant@applying.example",
          jobTitle: "Chief Architect",
        },
      },
    });

    expect((await currentApplication(organizationId, outsider.cookie)).status).toBe(404);
    expect((await callApi(env, `/api/v1/organizations/${organizationId}/applications/current`)).status).toBe(401);

    // A decided application is no longer current.
    await env.DB.prepare("UPDATE member_applications SET stage='withdrawn' WHERE id=?").bind(applicationId).run();
    expect(
      organizationCurrentApplicationResponseSchema.parse(
        await (await currentApplication(organizationId, colleague.cookie)).json(),
      ),
    ).toEqual({
      application: null,
    });
  });

  it("shows an older application that only names the organization", async () => {
    const organizationId = await insertOrganization(env.DB, "Named Org");
    const colleague = await represent(organizationId, "colleague@named.example", "Engineer");
    await seedMemberApplication({
      applicantEmail: "earlier@named.example",
      organizationName: " Named Org ",
      stage: "submitted",
    });
    expect(
      organizationCurrentApplicationResponseSchema.parse(
        await (await currentApplication(organizationId, colleague.cookie)).json(),
      ),
    ).toMatchObject({ application: { stage: "submitted", applicant: null } });
  });
});
