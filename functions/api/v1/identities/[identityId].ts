import {
  identityGetRouteSchema,
  identityRecordSchema,
  identityUpdateRouteSchema,
} from "../../../../assets/shared/schemas/identity-public-profile";
import { requireStaffPermission } from "../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../_lib/db/context";
import { jsonPrivate } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { readIdentityRecord, updateIdentityProfileByStaff } from "../../../_lib/services/identities/identity-record";
import { setIdentityPublicProfileHidden } from "../../../_lib/services/identities/public-profile-visibility";

export const IdentityGet = openApiRoute(identityGetRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffPermission(c, "membership:read");
  return jsonPrivate(identityRecordSchema.parse(await readIdentityRecord(db, data.params.identityId)));
});

export const IdentityPatch = openApiRoute(identityUpdateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "membership:write");
  const { hiddenFromPublicProfile, ...profile } = data.body;
  // The contract carries exactly one of the two changes.
  if (hiddenFromPublicProfile === undefined) {
    await updateIdentityProfileByStaff(db, staff, data.params.identityId, profile);
  } else {
    await setIdentityPublicProfileHidden(db, staff, data.params.identityId, hiddenFromPublicProfile);
  }
  return jsonPrivate(identityRecordSchema.parse(await readIdentityRecord(db, data.params.identityId)));
});
