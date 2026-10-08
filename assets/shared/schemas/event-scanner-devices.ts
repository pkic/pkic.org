import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";

export const scannerSequenceSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const SCANNER_RECOVERY_EPOCH_LIMIT = 1000;
export const scannerSessionSchema = z.object({ epochId: databaseIdSchema, sequence: scannerSequenceSchema }).strict();
export const scannerReceiptSchema = scannerSessionSchema.extend({
  operationId: databaseIdSchema,
  receivedAt: utcInstantSchema,
});
export const scannerDeviceSessionEnrollmentSchema = z
  .object({
    operationId: databaseIdSchema,
    deviceId: databaseIdSchema,
    sponsorId: databaseIdSchema.optional(),
  })
  .strict();
export const scannerDeviceSessionEnrollmentResponseSchema = z
  .object({
    epochId: databaseIdSchema,
    eventId: databaseIdSchema,
    operatorUserId: databaseIdSchema,
    deviceId: databaseIdSchema,
    openedAt: utcInstantSchema,
  })
  .strict();
export const scannerDeviceSessionClosingSchema = z
  .object({
    operationId: databaseIdSchema,
    highWaterSequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    pendingCount: z.literal(0),
    recoveryCount: z.literal(0),
    sponsorId: databaseIdSchema.optional(),
  })
  .strict();
export const scannerDeviceSessionStatusSchema = z
  .object({
    epochId: databaseIdSchema,
    deviceId: databaseIdSchema,
    enrollmentOperationId: databaseIdSchema,
    openedAt: utcInstantSchema,
    highWaterSequence: z.number().int().min(0).nullable(),
    receivedCount: z.number().int().min(0),
    missingCount: z.number().int().min(0).nullable(),
    closingDeclaredAt: utcInstantSchema.nullable(),
    closingOperationId: databaseIdSchema.nullable(),
    closedAt: utcInstantSchema.nullable(),
  })
  .strict();
export type ScannerDeviceSessionStatus = z.infer<typeof scannerDeviceSessionStatusSchema>;
/** IDs and owner-issued sequence state only; recover the original epoch rather than minting a replacement. */
export const scannerRecoveryEpochSchema = z
  .object({
    eventId: z.string().min(1).max(200),
    operatorUserId: databaseIdSchema,
    deviceId: databaseIdSchema,
    epochId: databaseIdSchema,
    enrollmentOperationId: databaseIdSchema,
    issuedHighWater: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    state: z.enum(["open", "closing", "closed"]),
    closingOperationId: databaseIdSchema.nullable(),
    openedAt: utcInstantSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.state === "open") !== (value.closingOperationId === null))
      context.addIssue({
        code: "custom",
        path: ["closingOperationId"],
        message: "The epoch closing operation must match its lifecycle state.",
      });
  });
