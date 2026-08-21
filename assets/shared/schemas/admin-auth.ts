import { emailRecoveryRequestSchema, magicLinkVerifySchema } from "./api-common";

export const adminAuthRequestSchema = emailRecoveryRequestSchema;
export const adminAuthVerifySchema = magicLinkVerifySchema;
