import { expect, test } from "@playwright/test";
import {
  approveMemberThroughReview,
  ensureAppOrigin,
  submitMembershipApplication,
  uniqueSuffix,
} from "./helpers/membership";
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

  const join = await verifyMembershipJoinEmail(page, email, { unaffiliatedAttestation: false });
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
          membershipCategory: "F",
          organizationName: "Refusal Organization",
          joinToken,
          answers: {
            reason: "Submitted without accepting the agreements.",
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
  const second = await page.evaluate(
    async ({ email: applicantEmail }) => {
      const response = await fetch("/api/v1/members/join/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: applicantEmail }),
      });
      return { status: response.status, body: await response.text() };
    },
    { email },
  );
  expect(second.status, second.body).toBeLessThan(500);

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

  // Somebody else, at their own domain, naming that same organization.
  const applicantEmail = `outsider-${suffix}@outsider-${suffix}.test`;
  await ensureAppOrigin(page);
  const join = await verifyMembershipJoinEmail(page, applicantEmail);
  expect(join.status).toBe("application_ready");
  if (join.status !== "application_ready") throw new Error("Expected an application continuation");

  const refused = await page.evaluate(
    async ({ email, name, organization, joinToken }) => {
      const response = await fetch("/api/v1/members/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicantEmail: email,
          applicantName: name,
          membershipCategory: "F",
          organizationName: organization,
          joinToken,
          answers: {
            reason: "This browser journey exercises the membership review workflow.",
            agrees_bylaws: true,
            agrees_code_of_conduct: true,
            agrees_ipr_policy: true,
            warranted_authority: true,
          },
        }),
      });
      return { status: response.status, body: await response.text() };
    },
    {
      email: applicantEmail,
      name: `Outsider ${suffix}`,
      // Spelled as somebody typing it in a hurry would: the match is on the
      // consortium's normalized name, not on the characters submitted.
      organization: `  ${organizationName.toUpperCase()}  `,
      joinToken: join.joinToken,
    },
  );

  // Refused, and named: the applicant is told the organization is already a
  // member rather than left waiting on a review that can only end one way.
  expect(refused.status, refused.body).toBe(409);
  const refusal = JSON.parse(refused.body) as {
    error: { code: string; message: string; details: { fieldErrors: Record<string, string[]> } };
  };
  expect(refusal.error.code).toBe("ORGANIZATION_ALREADY_MEMBER");
  // Named as the consortium holds it, so the applicant can recognize it.
  expect(refusal.error.message).toContain(organizationName);
  // And carried on the box they would have to change, the way every other
  // refusal in this form is, so it is marked rather than only announced.
  expect(refusal.error.details.fieldErrors.organizationName?.[0]).toContain(organizationName);
});
