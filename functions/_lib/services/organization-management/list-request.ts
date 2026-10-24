import { readStaffProjection } from "../../auth/staff-projection";
import { prepareOrganizationsList } from "./read-model";
import type { OrganizationsListQuery } from "../../../../assets/shared/schemas/organization-management";
import type { DatabaseLike, Env } from "../../types";

/** The serving-replica snapshot owns staff authority, the filtered page, and its count. */
export async function listOrganizationsRequest(
  db: DatabaseLike,
  request: Request,
  env: Env,
  query: OrganizationsListQuery,
) {
  return readStaffProjection(db, request, env, "organizations:read", prepareOrganizationsList(db, query));
}
