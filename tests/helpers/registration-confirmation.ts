import { expect } from "vitest";
import { registrationConfirmInfoResponseSchema } from "../../assets/shared/schemas/registration";
import { registrationEmailProofVerifyResponseSchema } from "../../assets/shared/schemas/registration-email-proof";
import { issueDatabaseCapability } from "../../functions/_lib/services/capability-links";
import { createRegistration } from "../../functions/_lib/services/registrations";
import { findOrCreateUser } from "../../functions/_lib/services/users";
import type { DatabaseLike, Env } from "../../functions/_lib/types";
import { env } from "cloudflare:test";
import { callApi } from "./app";

const signingSecret = () => env.INTERNAL_SIGNING_SECRET ?? "test-signing-secret";

/** The management capability a registrant receives by email. */
export function issueRegistrationManageToken(db: DatabaseLike, registrationId: string): Promise<string> {
  return issueDatabaseCapability({
    db,
    signingSecret: signingSecret(),
    purpose: "registration_manage",
    resourceId: registrationId,
  });
}

/** The confirmation capability a pending registrant receives by email. */
export function issueRegistrationConfirmationToken(db: DatabaseLike, registrationId: string): Promise<string> {
  return issueDatabaseCapability({
    db,
    signingSecret: signingSecret(),
    purpose: "registration_confirm",
    resourceId: registrationId,
  });
}

/**
 * A registration still waiting for its mailbox proof. The public route no longer
 * creates one, but an unconfirmed registration from before sign-in became
 * required, a self-reactivated unconfirmed registration, and an email change
 * all leave this state, and the confirm, resend, and reminder flows serve it.
 */
export async function createPendingRegistration(
  db: DatabaseLike,
  options: {
    email: string;
    firstName?: string;
    lastName?: string;
    eventSlug?: string;
    dayAttendance?: Array<{ dayDate: string; attendanceType: string }>;
    sourceType?: string;
  },
) {
  const event = await db
    .prepare("SELECT id FROM events WHERE slug = ?")
    .bind(options.eventSlug ?? "pqc-2026")
    .first<{ id: string }>();
  if (!event) throw new Error("createPendingRegistration needs a seeded event");
  const dayAttendance = options.dayAttendance ?? [{ dayDate: "2026-12-01", attendanceType: "virtual" }];
  const now = new Date().toISOString();
  for (const day of dayAttendance) {
    await db
      .prepare(
        "INSERT INTO event_days(id,event_id,day_date,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(event_id,day_date) DO NOTHING",
      )
      .bind(crypto.randomUUID(), event.id, day.dayDate, now, now)
      .run();
  }
  const user = await findOrCreateUser(db, {
    email: options.email,
    firstName: options.firstName ?? "Test",
    lastName: options.lastName ?? "User",
  });
  const created = await createRegistration(db, {
    event,
    userId: user.id,
    dayAttendance,
    sourceType: options.sourceType ?? "direct",
    signingSecret: signingSecret(),
  });
  if (created.registration.status !== "pending_email_confirmation" || !created.confirmationToken) {
    throw new Error("createPendingRegistration must leave the registration awaiting confirmation");
  }
  return {
    userId: user.id,
    registrationId: created.registration.id,
    confirmationToken: created.confirmationToken,
    manageToken: created.manageToken,
  };
}

/** Confirm a work-address registration through the same organization selection used by attendees. */
export async function confirmWorkRegistration(environment: Env, token: string): Promise<Response> {
  const base = "/api/v1/events/pqc-2026/registrations";
  const infoResponse = await callApi(environment, `${base}/confirm-info?token=${encodeURIComponent(token)}`);
  expect(infoResponse.status, await infoResponse.clone().text()).toBe(200);
  const info = registrationConfirmInfoResponseSchema.parse(await infoResponse.json());
  expect(info.organizationProof).toBeTruthy();

  async function verify(affiliation?: object) {
    const response = await callApi(environment, `${base}/proof/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: info.organizationProof, affiliation }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return registrationEmailProofVerifyResponseSchema.parse(await response.json()).affiliation!;
  }

  const offered = await verify();
  const organizationId = offered.organization?.id ?? null;
  const name = offered.organization?.name ?? `Organization for ${offered.domain}`;
  const jobTitle = "Engineer";
  const chosen = await verify({ organizationId, ...(organizationId ? {} : { organizationName: name }), jobTitle });
  return callApi(environment, `${base}/confirm-email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      organization: { name, organizationId, jobTitle, contextToken: chosen.contextToken },
    }),
  });
}
