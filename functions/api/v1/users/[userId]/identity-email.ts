import {
  representationEmailOptionsRouteSchema,
  representationEmailChangeRouteSchema,
} from "../../../../../assets/shared/schemas/representation-email";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { jsonPrivate } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  readRepresentationEmailOptions,
  changeRepresentationEmail,
} from "../../../../_lib/services/identities/representation-email";
export const RepresentationEmailGet = openApiRoute(
  representationEmailOptionsRouteSchema,
  async (c: AdminContext, data) =>
    jsonPrivate(
      await readRepresentationEmailOptions(
        requestDb(c),
        c.req.raw,
        c.env,
        data.params.userId,
        data.params.identityId,
        data.query,
      ),
    ),
);
export const RepresentationEmailPut = openApiRoute(
  representationEmailChangeRouteSchema,
  async (c: AdminContext, data) =>
    jsonPrivate(
      await changeRepresentationEmail(
        requestDb(c),
        c.req.raw,
        c.env,
        data.params.userId,
        data.params.identityId,
        data.body,
      ),
    ),
);
