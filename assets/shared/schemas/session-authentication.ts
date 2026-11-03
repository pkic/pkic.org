import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";

/** Server-signed evidence of passkey sign-in with user verification for this session. */
export const sessionPasskeyAuthenticationSchema = z
  .object({
    credentialId: databaseIdSchema,
    authenticatedAt: utcInstantSchema,
  })
  .strict();

export type SessionPasskeyAuthentication = z.infer<typeof sessionPasskeyAuthenticationSchema>;
