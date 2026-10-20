import { insertOrganization, insertUser, seedOrganizationAggregate } from "./membership";
import { env } from "cloudflare:workers";
import { queryAll } from "./context";

export async function historicalRegistration(
  userId: string,
  email: string,
  kind: "invite" | "confirmation" | "status",
  deliveredEmail = email,
) {
  const eventId = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM events LIMIT 1"))[0].id;
  const at = "2026-04-09T15:24:14.543Z";
  const registrationId = crypto.randomUUID();
  const inviteId = crypto.randomUUID();
  if (kind === "invite")
    await env.DB.prepare(`INSERT INTO invites(id,event_id,invitee_email,invite_type,link_secret,status,source_type,accepted_at,created_at)
      VALUES (?,?,?,'attendee',?,'accepted','direct',?,?)`)
      .bind(inviteId, eventId, deliveredEmail, crypto.randomUUID(), at, at)
      .run();
  await env.DB.prepare(`INSERT INTO registrations(id,event_id,user_id,invite_id,status,attendance_type,source_type,manage_link_secret,confirmed_at,created_at,updated_at)
      VALUES (?,?,?,?,'registered','in_person','direct',?,?,?,?)`)
    .bind(registrationId, eventId, userId, kind === "invite" ? inviteId : null, crypto.randomUUID(), at, at, at)
    .run();
  if (kind === "confirmation")
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO email_outbox(id,event_id,template_key,recipient_user_id,recipient_email,payload_json,message_type,provider,status,attempts,send_after,created_at,updated_at)
        VALUES (?,?,'registration_confirm_email',?,?,'{}','transactional','sendgrid','sent',1,?,?,?)`).bind(
        crypto.randomUUID(),
        eventId,
        userId,
        deliveredEmail,
        at,
        at,
        at,
      ),
      env.DB.prepare(`INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,created_at)
        VALUES (?,'user',?,'registration_email_confirmed','registration',?,?)`).bind(
        crypto.randomUUID(),
        userId,
        registrationId,
        at,
      ),
    ]);
  return at;
}

export async function approvedOrganization(): Promise<string> {
  const organizationId = await insertOrganization(env.DB, "IBM");
  await seedOrganizationAggregate(env.DB, organizationId);
  await env.DB.prepare(`INSERT INTO organization_domain_claims (id, domain, organization_id, created_at, updated_at)
      VALUES (?, 'ibm.example', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
    .bind(crypto.randomUUID(), organizationId)
    .run();
  return organizationId;
}
export async function verifiedPerson(email: string): Promise<string> {
  const userId = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .bind(userId)
    .run();
  return userId;
}
