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
): Promise<{ email: string; userId: string; memberId: string; identityId: string }> {
  const identity = crypto.randomUUID();
  const email = `e2e-persona-${identity}@persona-${identity}.example.test`;
  const startSince = await capturedEmailCount();
  const start = await jsonResponse(page.request, "POST", "/api/v1/members/join/start", {
    email,
    unaffiliatedAttestation: false,
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
    membershipCategory: "A",
    organizationName: `Persona Test Organization ${identity}`,
    joinToken: stringProperty(verified, "joinToken"),
    answers: {
      reason: "Real Worker/D1 portal persona coverage",
      agrees_bylaws: true,
      agrees_code_of_conduct: true,
      agrees_ipr_policy: true,
      warranted_authority: true,
    },
  });
  expect(stringProperty(application, "stage")).toBe("pending");

  await jsonResponse(
    page.request,
    "PATCH",
    `/api/v1/members/applications/${stringProperty(application, "applicationId")}/stage`,
    {
      toStage: "in_review",
    },
  );
  await jsonResponse(
    page.request,
    "PATCH",
    `/api/v1/members/applications/${stringProperty(application, "applicationId")}/stage`,
    {
      toStage: "in_consultation",
    },
  );
  await jsonResponse(
    page.request,
    "PATCH",
    `/api/v1/members/applications/${stringProperty(application, "applicationId")}/stage`,
    {
      toStage: "ec_review",
    },
  );
  const approved = await jsonResponse(
    page.request,
    "POST",
    `/api/v1/members/applications/${stringProperty(application, "applicationId")}/approve`,
  );
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
