import { requireUserBackedAdminFromRequest } from "../../../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../../../_lib/db/context";
import {
  prepareGroupEventProposalContextGuard,
  requireGroupEventProposalContext,
} from "../../../../../../../../../_lib/services/proposal-group-context";

export interface GroupProposalParams {
  groupId: string;
  eventId: string;
  proposalId: string;
}

export interface GroupProposalSpeakerParams extends GroupProposalParams {
  userId: string;
}

export async function requireGroupProposalSpeakerContext(
  c: AdminContext,
  params: GroupProposalParams,
  permission: "proposals:score" | "proposals:manage",
) {
  const db = requestDb(c);
  const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  const context = await requireGroupEventProposalContext(
    db,
    actor,
    params.groupId,
    params.eventId,
    permission,
    params.proposalId,
  );
  return { db, actor, context, contextGuard: prepareGroupEventProposalContextGuard(db, context) };
}

export function groupProposalSpeakerHeadshotUrl(
  c: AdminContext,
  params: GroupProposalSpeakerParams,
  updatedAt: string | null,
): string {
  const url = new URL(
    `/api/v1/groups/${encodeURIComponent(params.groupId)}/events/${encodeURIComponent(params.eventId)}/proposals/${encodeURIComponent(params.proposalId)}/speakers/${encodeURIComponent(params.userId)}/headshot`,
    resolveAppBaseUrl(c.env, c.req.raw),
  );
  if (updatedAt) url.searchParams.set("v", updatedAt);
  return url.toString();
}
