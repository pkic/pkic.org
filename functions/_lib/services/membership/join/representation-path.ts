import type { DatabaseLike } from "../../../types";
import { batchFirst } from "../../../db/pagination";
import { readMembershipApplicationConflicts } from "../applications/conflicts";
import {
  ownOpenApplicationSelection,
  resolveOpenJoinApplication,
  type OwnOpenApplicationRow,
} from "./open-application";
import type { MemberJoinVerifyResponse } from "./types";

/**
 * Decides whether a person may apply as an organization identity they hold,
 * from the same conflicts the submission refuses, so the form is only offered
 * when it can be sent. An open application for the organization needs no
 * second one: its approval makes every representative a member representative.
 */
export async function resolveRepresentationJoinPath(
  db: DatabaseLike,
  input: { userId: string; email: string; organizationId: string; signingSecret: string },
): Promise<MemberJoinVerifyResponse> {
  const conflicts = await readMembershipApplicationConflicts(db, {
    isIndividual: false,
    organizationName: null,
    organizationId: input.organizationId,
    applicantUserId: input.userId,
    applicantEmail: input.email,
  });
  if (conflicts.memberOrganization) return { status: "already_member" };
  if (conflicts.pendingForApplicant) {
    const own = ownOpenApplicationSelection(input.email, { sql: "SELECT ?", bindings: [input.userId] });
    const row = batchFirst<OwnOpenApplicationRow>((await db.batch([db.prepare(own.sql).bind(...own.bindings)]))[0]);
    const open = await resolveOpenJoinApplication(input.signingSecret, { own: row, organizationOpen: false });
    if (open?.kind === "own") return { status: "application_in_progress", statusPath: open.statusPath };
  }
  if (conflicts.pendingOrganization) return { status: "representation_application_in_progress" };
  return { status: "representation_application_ready" };
}
