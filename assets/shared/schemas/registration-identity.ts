import { z } from "zod";
import { databaseIdSchema } from "./identifiers";

export const registrationIdentityChangeSchema = z.object({
  identityId: databaseIdSchema,
  expectedIdentityId: databaseIdSchema.nullable(),
});
