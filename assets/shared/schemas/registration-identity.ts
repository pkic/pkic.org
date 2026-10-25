import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { successResponseSchema, utcInstantSchema } from "./api-common";
import { sessionActingIdentitySchema } from "../session-acting-identity";

export const registrationIdentityChangeSchema = z.object({
  identityId: databaseIdSchema,
  expectedIdentityId: databaseIdSchema.nullable(),
});
export const registrationIdentityChangeResponseSchema = successResponseSchema.extend({
  identity: sessionActingIdentitySchema,
  badgeVersion: utcInstantSchema,
});
