import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { lookupOgPerson } from "../functions/r/[code]";
import { getProposalSpeakerBadgeRenderData } from "../functions/_lib/services/og-badge-prerender";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import {
  inviteSpeakerAndSubmitCapacityProposal,
  setupProposalSpeakerCapacityWorkflow,
} from "./helpers/proposal-speaker-capacity";

describe("proposal-scoped public speaker profiles", () => {
  beforeEach(resetDb);

  it("uses proposal overrides in referral metadata and badge render data", async () => {
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

    const scopedHeadshot = `proposal-headshots/${proposalId}/${referral.created_by_user_id}/public.jpg`;
    await env.DB.prepare(
      `UPDATE proposal_speakers
       SET profile_overrides_json = ?, headshot_override_set = 1,
           headshot_r2_key = ?, headshot_updated_at = '2026-08-22T00:00:00.000Z'
       WHERE proposal_id = ? AND user_id = ?`,
    )
      .bind(
        JSON.stringify({
          firstName: "Proposal",
          lastName: "Persona",
          organizationName: "Scoped Organization",
          jobTitle: "Scoped Title",
        }),
        scopedHeadshot,
        proposalId,
        referral.created_by_user_id,
      )
      .run();

    await expect(lookupOgPerson(env.DB, referral.code)).resolves.toMatchObject({
      first_name: "Proposal",
      last_name: "Persona",
    });
    await expect(
      getProposalSpeakerBadgeRenderData(env.DB, proposalId, referral.created_by_user_id),
    ).resolves.toMatchObject({
      first_name: "Proposal",
      last_name: "Persona",
      organization_name: "Scoped Organization",
      job_title: "Scoped Title",
      headshot_r2_key: scopedHeadshot,
    });
  });
});
