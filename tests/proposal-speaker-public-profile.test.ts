import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { lookupOgPerson } from "../functions/r/[code]";
import { readBadgeSource } from "../functions/_lib/services/og-badge-source";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import {
  inviteSpeakerAndSubmitCapacityProposal,
  setupProposalSpeakerCapacityWorkflow,
} from "./helpers/proposal-speaker-capacity";

describe("public speaker profiles", () => {
  beforeEach(resetDb);

  it("reads referral metadata and badge render data from the person, never a proposal copy", async () => {
    const { adminSessionToken } = await setupProposalSpeakerCapacityWorkflow();
    const { proposalId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const [referral] = await queryAll<{ code: string; created_by_user_id: string }>(
      env.DB,
      `SELECT code, created_by_user_id
       FROM referral_codes
       WHERE owner_type = 'proposal' AND owner_id = ?`,
      [proposalId],
    );
    expect(referral).toBeTruthy();

    const headshot = `headshots/${referral.created_by_user_id}/public.jpg`;
    await env.DB.prepare(
      `UPDATE users SET first_name = 'Person', last_name = 'Own', headshot_r2_key = ?,
              headshot_updated_at = '2026-08-22T00:00:00.000Z'
        WHERE id = ?`,
    )
      .bind(headshot, referral.created_by_user_id)
      .run();

    await expect(lookupOgPerson(env.DB, referral.code)).resolves.toMatchObject({
      first_name: "Person",
      last_name: "Own",
    });
    await expect(readBadgeSource(env.DB, referral.code)).resolves.toMatchObject({
      first_name: "Person",
      last_name: "Own",
      headshot_r2_key: headshot,
    });
  });
});
