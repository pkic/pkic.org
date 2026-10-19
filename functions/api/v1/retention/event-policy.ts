import {
  eventEvidenceRetentionPolicyReadRouteSchema,
  eventEvidenceRetentionPolicyUpdateRouteSchema,
} from "../../../../assets/shared/schemas/event-evidence-retention";
import { requireUserBackedAuthAdmin } from "../../../_lib/auth/admin-identity";
import { requireStaffPermission } from "../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import {
  readEventEvidenceRetentionPolicy,
  updateEventEvidenceRetentionPolicy,
} from "../../../_lib/services/event-participation/retention-policy";

export const EventEvidenceRetentionPolicyRead = openApiRoute(
  eventEvidenceRetentionPolicyReadRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "retention:read");
    return json(await readEventEvidenceRetentionPolicy(db, requireUserBackedAuthAdmin(staff), data.params.eventId));
  },
);
export const EventEvidenceRetentionPolicyUpdate = openApiRoute(
  eventEvidenceRetentionPolicyUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "retention:read");
    return json(
      await updateEventEvidenceRetentionPolicy(db, requireUserBackedAuthAdmin(staff), data.params.eventId, data.body),
    );
  },
);
