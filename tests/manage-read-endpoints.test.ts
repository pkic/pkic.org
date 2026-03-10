import { describe, expect, it } from "vitest";
import { D1DatabaseShim } from "./helpers/d1-shim";
import { createContext, createEnv, seedEventAndAdmin } from "./helpers/context";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { onRequestGet as getRegistration } from "../functions/api/v1/registrations/manage/[token]";
import { onRequestGet as getProposal } from "../functions/api/v1/proposals/manage/[token]";

describe("manage read endpoints", () => {
  it("returns registration state for a valid manage token", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    const userId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();
    const token = "registration-token";
    const tokenHash = await sha256Hex(token);

    await db.exec?.(`
      INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
      VALUES ('${userId}', 'person@example.test', 'person@example.test', 'Pat', 'Lee', datetime('now'), datetime('now'));

      INSERT INTO registrations (
        id, event_id, user_id, status, attendance_type, source_type,
        manage_token_hash, created_at, updated_at
      ) VALUES (
        '${registrationId}', '${eventId}', '${userId}', 'registered', 'virtual', 'direct',
        '${tokenHash}', datetime('now'), datetime('now')
      );
    `);

    const response = await getRegistration(
      createContext(env, new Request(`https://app.test/api/v1/registrations/manage/${token}`), { token }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { registration: { id: string } };
    expect(payload.registration.id).toBe(registrationId);
  });

  it("returns proposal state for a valid manage token", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    const userId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const token = "proposal-token";
    const tokenHash = await sha256Hex(token);

    await db.exec?.(`
      INSERT INTO users (id, email, normalized_email, first_name, last_name, biography, created_at, updated_at)
      VALUES ('${userId}', 'speaker@example.test', 'speaker@example.test', 'Sam', 'Taylor', 'Speaker bio with enough detail for testing.', datetime('now'), datetime('now'));

      INSERT INTO session_proposals (
        id, event_id, proposer_user_id, status, proposal_type, title, abstract,
        manage_token_hash, submitted_at, updated_at
      ) VALUES (
        '${proposalId}', '${eventId}', '${userId}', 'submitted', 'talk', 'Proposal title',
        'Proposal abstract text that is sufficiently long for test payload validation.',
        '${tokenHash}', datetime('now'), datetime('now')
      );

      INSERT INTO proposal_speakers (id, proposal_id, user_id, role, created_at)
      VALUES ('${crypto.randomUUID()}', '${proposalId}', '${userId}', 'proposer', datetime('now'));
    `);

    const response = await getProposal(
      createContext(env, new Request(`https://app.test/api/v1/proposals/manage/${token}`), { token }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { proposal: { id: string }; speakers: Array<{ email: string }> };
    expect(payload.proposal.id).toBe(proposalId);
    expect(payload.speakers[0].email).toBe("speaker@example.test");
  });
});
