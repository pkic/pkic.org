import { requestDb } from "../../../../../_lib/db/context";
import { registrationEmailProofVerifyResponseSchema } from "../../../../../../assets/shared/schemas/registration-email-proof";
import { registrationEmailProofVerifyRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-registrations";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../../_lib/request";
import { verifyRegistrationEmailProof } from "../../../../../_lib/services/registrations/email-proof";

export const RegistrationEmailProofVerifyPost = openApiRoute(
  registrationEmailProofVerifyRouteSchema,
  async (c, data) => {
    return jsonPrivate(
      registrationEmailProofVerifyResponseSchema.parse(
        await verifyRegistrationEmailProof(requestDb(c), {
          signingSecret: requireInternalSecret(c.env),
          token: data.body.token,
          eventSlug: data.params.eventSlug,
          domain: data.body.domain,
          affiliation: data.body.affiliation,
        }),
      ),
    );
  },
);
