import type { z } from "zod";
import { userDetailSchema, userMembershipDetailSchema } from "../../../../../shared/schemas/user-management";

export type UserDetail = z.infer<typeof userDetailSchema>;
export type UserMembership = z.infer<typeof userMembershipDetailSchema>;
