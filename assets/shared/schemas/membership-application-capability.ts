import { z } from "zod";

/** Opaque applicant capability issued once when a membership application is created. */
export const memberApplicationManageTokenSchema = z.string().min(16).max(64);

export const memberApplicationCapabilityQuerySchema = z.object({ token: memberApplicationManageTokenSchema });
