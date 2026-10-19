import { utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { sessionAppearanceChoicesQuerySchema } from "./event-session-history";
export const transferIdentitiesQuerySchema = sessionAppearanceChoicesQuerySchema.extend({
  userId: databaseIdSchema,
  at: utcInstantSchema,
});
