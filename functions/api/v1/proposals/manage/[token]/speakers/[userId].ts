import { z } from "zod";
import { json } from "../../../../../../_lib/http";
import { parseJsonBody } from "../../../../../../_lib/validation";
import { first } from "../../../../../../_lib/db/queries";
import { AppError } from "../../../../../../_lib/errors";
import { getProposalByManageToken, updateProposalSpeakerRole } from "../../../../../../_lib/services/proposals";
import { updateSpeakerProfile } from "../../../../../../_lib/services/proposals-speaker-profile";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import {
  firstNameSchema,
  lastNameSchema,
  organizationNameSchema,
  jobTitleSchema,
} from "../../../../../../../assets/shared/schemas/api";

const speakerRoleSchema = z.enum(["proposer", "speaker", "co_speaker", "moderator", "panelist"]);

const speakerProfileSchema = z.object({
  role: speakerRoleSchema.optional(),
  firstName: z.union([firstNameSchema, z.literal(""), z.null()]).optional(),
  lastName: z.union([lastNameSchema, z.literal(""), z.null()]).optional(),
  organizationName: z.union([organizationNameSchema, z.literal(""), z.null()]).optional(),
  jobTitle: z.union([jobTitleSchema, z.literal(""), z.null()]).optional(),
  biography: z.union([z.string().trim().min(1).max(10_000), z.literal(""), z.null()]).optional(),
  links: z
    .array(
      z.object({
        label: z.string().trim().max(128),
        url: z.url().max(2048),
      }),
    )
    .max(10)
    .optional(),
});

async function loadSpeakerContext(db: D1Database, manageToken: string, userId: string) {
  const proposal = await getProposalByManageToken(db, manageToken);
  const speaker = await first<{
    id: string;
    user_id: string;
    status: string;
    role: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
    job_title: string | null;
    biography: string | null;
    links_json: string | null;
  }>(
    db,
    `SELECT ps.id, ps.user_id, ps.status, ps.role,
            u.first_name, u.last_name, u.organization_name, u.job_title, u.biography, u.links_json
     FROM proposal_speakers ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.proposal_id = ? AND ps.user_id = ?`,
    [proposal.id, userId],
  );

  if (!speaker) {
    throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker not found on this proposal");
  }

  if (proposal.status === "withdrawn" || proposal.status === "rejected") {
    throw new AppError(400, "PROPOSAL_CLOSED", "Cannot update speakers on a closed proposal");
  }

  return { proposal, speaker };
}

export async function onRequestPatch(c: any): Promise<Response> {
  const body = await parseJsonBody(c.req, speakerProfileSchema);
  const { proposal, speaker } = await loadSpeakerContext(c.env.DB, c.req.param("token"), c.req.param("userId"));

  const previousLinks = speaker.links_json ? JSON.parse(speaker.links_json) : [];
  const nextValues = {
    firstName: body.firstName === undefined ? undefined : body.firstName || null,
    lastName: body.lastName === undefined ? undefined : body.lastName || null,
    organizationName: body.organizationName === undefined ? undefined : body.organizationName || null,
    jobTitle: body.jobTitle === undefined ? undefined : body.jobTitle || null,
    biography: body.biography === undefined ? undefined : body.biography || null,
    linksJson: body.links ? JSON.stringify(body.links) : body.links === undefined ? undefined : null,
  };

  await updateSpeakerProfile(c.env.DB, speaker.user_id, nextValues);

  const details: Record<string, { from: unknown; to: unknown }> = {};
  if (body.firstName !== undefined) details.firstName = { from: speaker.first_name, to: nextValues.firstName ?? null };
  if (body.lastName !== undefined) details.lastName = { from: speaker.last_name, to: nextValues.lastName ?? null };
  if (body.organizationName !== undefined) {
    details.organizationName = { from: speaker.organization_name, to: nextValues.organizationName ?? null };
  }
  if (body.jobTitle !== undefined) details.jobTitle = { from: speaker.job_title, to: nextValues.jobTitle ?? null };
  if (body.biography !== undefined) details.biography = { from: speaker.biography, to: nextValues.biography ?? null };
  if (body.links !== undefined) details.links = { from: previousLinks, to: body.links };
  if (body.role !== undefined && body.role !== speaker.role) {
    await updateProposalSpeakerRole(c.env.DB, {
      proposalId: proposal.id,
      userId: speaker.user_id,
      role: body.role,
    });
    details.role = { from: speaker.role, to: body.role };
  }

  if (Object.keys(details).length > 0) {
    await writeAuditLog(
      c.env.DB,
      "user",
      proposal.proposer_user_id,
      "speaker_profile_updated_by_proposer",
      "proposal_speaker",
      speaker.id,
      { proposalId: proposal.id, speakerUserId: speaker.user_id, ...details },
    );
  }

  return json({ success: true });
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  if (c.req.raw.method === "PATCH") return onRequestPatch(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
