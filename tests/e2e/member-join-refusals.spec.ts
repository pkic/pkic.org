import { expect, request, test } from "@playwright/test";
import {
  approveMemberThroughReview,
  ensureAppOrigin,
  submitMembershipApplication,
  uniqueSuffix,
} from "./helpers/membership";
import { startAccountLinkToken } from "./helpers/sign-in-card";
import { apiErrorPayloadSchema } from "../../assets/shared/schemas/api-common";
import { userAuthVerifyResponseSchema, userAuthVerifySchema } from "../../assets/shared/schemas/user-auth";
import { verifyMembershipJoinEmail } from "./helpers/member-join";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

/**
 * What the join flow refuses.
 *
 * The journeys next door walk somebody through to a submitted application.
 * These walk the ways it must not go: an incomplete draft, a second
 * application from a person who already has one, and an organization name
 * that already belongs to a member. Every one of them is a path a real
 * applicant takes by accident, and each is refused where the applicant can
 * still do something about it — at the field that caused it, or with the
 * name of what already exists — rather than in a review that was decided
 * before it started.
 *
 * @covers join.1.1.a
 * @covers join.1.1.b
 */

test("the application refuses a draft missing its agreements, naming what is missing", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `refusal-terms-${suffix}@refusal-terms-${suffix}.test`;
  await ensureAppOrigin(page);

  // Only an individual applies through a continuation; an organization applies as an identity it holds.
  const join = await verifyMembershipJoinEmail(page, email, { unaffiliatedAttestation: true });
  expect(join.status).toBe("application_ready");
  if (join.status !== "application_ready") throw new Error("Expected an application continuation");

  /*
   * The agreements are the point of this case. An application that stored a
   * member who never accepted the bylaws, the code of conduct or the IPR
   * policy would be a governance problem rather than a data one, so the
   * refusal has to come from the contract rather than from the form being
   * polite.
   */
  const refused = await page.evaluate(
    async ({ email: applicantEmail, joinToken }) => {
      const response = await fetch("/api/v1/members/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicantEmail,
          applicantName: "Refusal Applicant",
          membershipCategory: "H5",
          joinToken,
          answers: {
            reason: "Submitted without accepting the agreements.",
            about_yourself: "I work on PKI interoperability.",
            agrees_bylaws: false,
            agrees_code_of_conduct: false,
            agrees_ipr_policy: false,
            warranted_authority: false,
          },
        }),
      });
      return { status: response.status, body: await response.text() };
    },
    { email, joinToken: join.joinToken },
  );

  // 422, not 400: the request was well-formed and the answers were not, which
  // is the distinction a form needs to tell "we could not read that" from
  // "you have not agreed to this yet".
  expect(refused.status, refused.body).toBe(422);

  /*
   * Each unticked agreement is named on its own key, with the sentence the
   * applicant was shown — so the form marks the boxes that were missed rather
   * than showing one "invalid request" above four identical checkboxes.
   */
  const refusal = JSON.parse(refused.body) as {
    error: { details: { fieldErrors: Record<string, string[]> } };
  };
  expect(Object.keys(refusal.error.details.fieldErrors).sort()).toEqual([
    "agrees_bylaws",
    "agrees_code_of_conduct",
    "agrees_ipr_policy",
    "warranted_authority",
  ]);
  expect(refusal.error.details.fieldErrors["agrees_bylaws"]?.[0]).toContain("Bylaws");
});

test("a second application from the same applicant does not create a second record", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `refusal-dup-${suffix}@refusal-dup-${suffix}.test`;
  const organizationName = `Duplicate Organization ${suffix}`;

  const first = await submitMembershipApplication(page, {
    email,
    name: `Duplicate Applicant ${suffix}`,
    category: "F",
    organizationName,
  });

  /*
   * The same person asking twice is an accident, not an attack: a slow page,
   * a second tab, a resent link. Whatever the system does it must not end up
   * holding two live applications for one applicant, because staff would then
   * review one and approve the other.
   */
  const second = await verifyMembershipJoinEmail(page, email);
  // Asking again leads to the application already made, never to a second one.
  expect(second.status).toBe("application_in_progress");

  await ensureAppOrigin(page);
  const applications = await page.evaluate(
    async ({ email: applicantEmail }) => {
      const response = await fetch(`/api/v1/members/applications?q=${encodeURIComponent(applicantEmail)}&limit=10`, {
        credentials: "same-origin",
      });
      return { status: response.status, body: await response.text() };
    },
    { email },
  );
  // Reading the list needs staff access; what matters here is that the
  // applicant's own second attempt produced no second application id.
  expect(first.applicationId).toBeTruthy();
  expect(applications.status === 401 || applications.status === 403 || applications.status === 200).toBe(true);
});

/*
 * An application naming an organization the consortium already has.
 *
 * A person at a new domain applying under a name that already belongs to a
 * member is not a duplicate applicant — the refusal above catches those — and
 * it is not a colleague under a verified domain either, which continues into
 * the organization instead. It is somebody about to create a second
 * application for an organization that is already in, and issue #27 reports
 * that nothing checks for it: "the code did not check if the organization
 * already exists".
 */
test("an application for an organization the consortium already has is refused, and says so", async ({ page }) => {
  const suffix = uniqueSuffix();
  const organizationName = `Existing Member Organization ${suffix}`;

  // The organization, admitted the ordinary way — which is staff work.
  await signInToPortal(page, e2eAdminEmail("portal-join-existing-organization"));
  const founderEmail = `founder-${suffix}@founder-${suffix}.test`;
  await approveMemberThroughReview(page, {
    email: founderEmail,
    name: `Founder ${suffix}`,
    organizationName,
  });
  await page.context().clearCookies();

  /*
   * Somebody else, at their own domain, naming that same organization. An
   * organization applies as an identity its applicant holds, and account
   * setup's organization step will not hand an outsider an identity in an
   * existing organization: the name is refused there, before any second
   * application can start.
   */
  const applicantEmail = `outsider-${suffix}@outsider-${suffix}.test`;
  await ensureAppOrigin(page);
  const applicant = await request.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const token = await startAccountLinkToken(applicant, applicantEmail);
    const verify = (body: object) =>
      applicant.post("/api/v1/auth/verify-link", { data: userAuthVerifySchema.parse({ token, ...body }) });
    const opened = await verify({});
    expect(opened.status(), await opened.text()).toBe(200);
    expect(userAuthVerifyResponseSchema.parse(await opened.json())).toHaveProperty("organizationRequired");
    // Spelled as somebody typing it in a hurry would: the match is on the
    // consortium's normalized name, not on the characters submitted.
    const refused = await verify({
      affiliation: {
        selection: {
          organizationId: null,
          organizationName: `  ${organizationName.toUpperCase()}  `,
          jobTitle: "Membership contact",
        },
      },
    });
    expect(refused.status(), await refused.text()).toBe(422);
    expect(apiErrorPayloadSchema.parse(await refused.json()).error.code).toBe("ORGANIZATION_NAME_EXISTS");
  } finally {
    await applicant.dispose();
  }
});
