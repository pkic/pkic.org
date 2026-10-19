import {
  personProfileGetRouteSchema,
  personProfileResponseSchema,
} from "../../../../../assets/shared/schemas/person-profile";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { readPersonProfile } from "../../../../_lib/services/people/read-person-profile";
import type { AdminContext } from "../../../../_lib/db/context";
import { requireProfileReader } from "./member-profile-authorization";

export const UserProfileGet = openApiRoute(personProfileGetRouteSchema, async (c: AdminContext, data) => {
  // What the profile publishes is public; only its subject also sees what stays hidden.
  const { db, viewerUserId } = await requireProfileReader(c);
  const audience = viewerUserId === data.params.userId ? "owner" : "public";
  return json(personProfileResponseSchema.parse(await readPersonProfile(db, data.params.userId, audience)));
});
