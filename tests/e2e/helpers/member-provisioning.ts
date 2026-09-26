import { membershipWorkflowVersionResponseSchema } from "../../../assets/shared/schemas/membership-workflows";
import { membershipWorkflowReviewResponseSchema } from "../../../assets/shared/schemas/membership-review-routes";
/**
 * Real Worker/D1 member provisioning through the public HTTP APIs and the
 * normal mailbox capability flow: no route interception and no D1 files. A
 * spec that needs an approved member with a live organization capacity, such
 * as a person who can hold a seat or a leadership term in a group, creates
 * one here rather than seeding the database behind the application's back.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";

export type JsonRecord = Record<string, unknown>;

export function stringProperty(payload: JsonRecord, key: string): string {
  const value = payload[key];
  expect(typeof value, `Expected ${key} to be a string in ${JSON.stringify(payload)}`).toBe("string");
  return value as string;
}

export function recordProperty(payload: JsonRecord, key: string): JsonRecord {
  const value = payload[key];
  expect(value, `Expected ${key} in ${JSON.stringify(payload)}`).toBeTruthy();
  return value as JsonRecord;
}

export function arrayProperty(payload: JsonRecord, key: string): unknown[] {
  const value = payload[key];
  expect(Array.isArray(value), `Expected ${key} to be an array in ${JSON.stringify(payload)}`).toBe(true);
  return value as unknown[];
}

export async function jsonResponse(
  request: APIRequestContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<JsonRecord> {
  const response = await request.fetch(path, {
    method,
    ...(body === undefined ? {} : { data: body }),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });
  const payload = (await response.json()) as JsonRecord;
  expect(response.status(), `${method} ${path}: ${JSON.stringify(payload)}`).toBeLessThan(300);
  return payload;
}

export async function createMember(
  page: Page,
  options: { individual?: boolean } = {},
): Promise<{ email: string; userId: string; memberId: string; identityId: string }> {
  const identity = crypto.randomUUID();
  const email = `e2e-persona-${identity}@persona-${identity}.example.test`;
  const startSince = await capturedEmailCount();
  const start = await jsonResponse(page.request, "POST", "/api/v1/members/join/start", {
    email,
    unaffiliatedAttestation: options.individual ?? false,
  });
  expect(stringProperty(start, "status")).toBe("verification_sent");

  const verificationEmail = await waitForCapturedEmail(email, "verify your email address", { since: startSince });
  const verificationUrl = extractEmailUrl(verificationEmail, "/join/");
  const verificationToken = new URL(verificationUrl).hash.replace(/^#verify=/, "");
  expect(verificationToken.length).toBeGreaterThan(32);
  const verified = await jsonResponse(page.request, "POST", "/api/v1/members/join/verify", {
    token: verificationToken,
  });
  expect(stringProperty(verified, "status")).toBe("application_ready");

  const application = await jsonResponse(page.request, "POST", "/api/v1/members/applications", {
    applicantEmail: email,
    applicantName: "E2E Persona Member",
    membershipCategory: options.individual ? "H5" : "A",
    ...(options.individual ? {} : { organizationName: `Persona Test Organization ${identity}` }),
    joinToken: stringProperty(verified, "joinToken"),
    answers: {
      reason: "Real Worker/D1 portal persona coverage",
      agrees_bylaws: true,
      agrees_code_of_conduct: true,
      agrees_ipr_policy: true,
      warranted_authority: true,
    },
  });
  expect(stringProperty(application, "stage")).toBe("submitted");
  const approved = await completeSyntheticMembershipReview(page.request, stringProperty(application, "applicationId"));
  const userId = stringProperty(approved, "userId");
  const userDetail = recordProperty(await jsonResponse(page.request, "GET", `/api/v1/users/${userId}`), "user");
  const identities = arrayProperty(userDetail, "identities");
  expect(identities).toHaveLength(1);
  return {
    email,
    userId,
    memberId: stringProperty(approved, "memberId"),
    identityId: stringProperty(identities[0] as JsonRecord, "identityId"),
  };
}

let staffWorkflowVersion: Promise<string> | null = null;

/** Adopt a purpose-created staff-only policy through the same explicit preview used by staff. */
export async function prepareSyntheticMembershipReview(request: APIRequestContext, applicationId: string) {
  staffWorkflowVersion ??= (async () => {
    const created = membershipWorkflowVersionResponseSchema.parse(
      await jsonResponse(request, "POST", "/api/v1/membership/workflows/versions", {
        definition: {
          name: "Synthetic organization and user review",
          policyReference: "Browser fixture admission policy",
          steps: [
            {
              id: crypto.randomUUID(),
              kind: "staff_review",
              label: "Review organization and user",
              reviewerGroupId: null,
              instructions: "Verify the submitted application form and the user's authority.",
            },
          ],
        },
      }),
    );
    await jsonResponse(request, "POST", `/api/v1/membership/workflows/versions/${created.workflow.id}/publication`, {
      expectedRevision: created.workflow.revision,
      reason: "Adopt a purpose-created policy for browser fixtures.",
    });
    return created.workflow.id;
  })();
  const versionId = await staffWorkflowVersion;
  const base = `/api/v1/members/applications/${applicationId}`;
  const preview = await jsonResponse(request, "GET", `${base}/workflow/migration?versionId=${versionId}`);
  await jsonResponse(request, "POST", `${base}/workflow/migration`, {
    versionId,
    previewFingerprint: preview.fingerprint,
    acknowledgeRestart: true,
    reason: "Apply the synthetic policy to this browser fixture without bypassing review evidence.",
  });
  await jsonResponse(request, "POST", "/api/v1/scheduler/jobs/membership_workflows/runs", {});
  return membershipWorkflowReviewResponseSchema.parse(await jsonResponse(request, "GET", `${base}/reviews/current`));
}

export async function completeSyntheticMembershipReview(request: APIRequestContext, applicationId: string) {
  const review = await prepareSyntheticMembershipReview(request, applicationId);
  const completion = await jsonResponse(
    request,
    "POST",
    `/api/v1/members/applications/${applicationId}/reviews/completion`,
    {
      expectedRevision: review.workflow.revision,
      reason: "Verified the synthetic organization, user, and application form.",
    },
  );
  expect(completion.approved).toBe(true);
  const users = arrayProperty(
    await jsonResponse(request, "GET", `/api/v1/users?q=${encodeURIComponent(review.application.applicantEmail)}`),
    "users",
  ) as JsonRecord[];
  const user = users.find((item) => item.email === review.application.applicantEmail)!;
  expect(user).toBeTruthy();
  const userId = stringProperty(user, "id");
  const detail = recordProperty(await jsonResponse(request, "GET", `/api/v1/users/${userId}`), "user");
  const identity = arrayProperty(detail, "identities")[0] as JsonRecord;
  return {
    userId,
    memberId: stringProperty(identity, "memberId"),
    organizationId: identity.organizationId === null ? null : stringProperty(identity, "organizationId"),
  };
}
