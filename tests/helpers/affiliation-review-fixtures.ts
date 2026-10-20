import { insertOrganization, insertUser, seedOrganizationAggregate } from "./membership";
import { env } from "cloudflare:workers";

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
