import {
  memberAvailabilityResponseSchema,
  memberAvailabilityRouteSchema,
  memberAvailabilityUpdateRouteSchema,
  memberSkillVouchRouteSchema,
  memberSkillVouchWithdrawRouteSchema,
  memberSkillsResponseSchema,
  memberSkillsRouteSchema,
  memberStandingResponseSchema,
  memberStandingRouteSchema,
} from "../../../../../assets/shared/schemas/member-profile";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getMemberAvailability, getMemberSkills, getMemberStanding } from "../../../../_lib/services/member-profile";
import {
  setMemberAvailability,
  vouchForSkill,
  withdrawSkillVouch,
} from "../../../../_lib/services/member-profile-writes";
import type { AdminContext } from "../../../../_lib/db/context";
import { requireProfileReader, requireVouchingMember } from "./member-profile-authorization";
import { requireUserStaffPermission } from "../authorization";

export const MemberSkillsGet = openApiRoute(memberSkillsRouteSchema, async (c: AdminContext, data) => {
  // The viewer marks their own vouches; it never changes which skills appear.
  const { db, viewerUserId } = await requireProfileReader(c);
  return json(memberSkillsResponseSchema.parse(await getMemberSkills(db, data.params.userId, viewerUserId)));
});

export const MemberAvailabilityGet = openApiRoute(memberAvailabilityRouteSchema, async (c: AdminContext, data) => {
  // Reaching this route at all means an authenticated member or staff reader,
  // which is what the members-only audience setting is about.
  const { db } = await requireProfileReader(c);
  return json(
    memberAvailabilityResponseSchema.parse({
      availability: await getMemberAvailability(db, data.params.userId, true),
    }),
  );
});

export const MemberStandingGet = openApiRoute(memberStandingRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireProfileReader(c);
  return json(memberStandingResponseSchema.parse({ standing: await getMemberStanding(db, data.params.userId) }));
});

export const MemberSkillVouchPost = openApiRoute(memberSkillVouchRouteSchema, async (c: AdminContext, data) => {
  // A vouch is a member's judgement about a peer, so only a member may give
  // one — staff permission is not a substitute for having worked with them.
  const { db, voucherUserId } = await requireVouchingMember(c);
  await vouchForSkill(db, data.params.userId, data.params.skillId, voucherUserId);
  return json(memberSkillsResponseSchema.parse(await getMemberSkills(db, data.params.userId, voucherUserId)));
});

export const MemberSkillVouchDelete = openApiRoute(
  memberSkillVouchWithdrawRouteSchema,
  async (c: AdminContext, data) => {
    const { db, voucherUserId } = await requireVouchingMember(c);
    await withdrawSkillVouch(db, data.params.userId, data.params.skillId, voucherUserId);
    return json(memberSkillsResponseSchema.parse(await getMemberSkills(db, data.params.userId, voucherUserId)));
  },
);

export const MemberAvailabilityPut = openApiRoute(
  memberAvailabilityUpdateRouteSchema,
  async (c: AdminContext, data) => {
    /* Reads are open to any member; this write is not. Setting what somebody
     else is open to is an administrative act on their behalf, and a peer has
     no business doing it. When members edit their own, that belongs on the
     current-user routes, not here. */
    const { db } = await requireUserStaffPermission(c, "users:write");
    return json(
      memberAvailabilityResponseSchema.parse({
        availability: await setMemberAvailability(db, data.params.userId, data.body),
      }),
    );
  },
);
