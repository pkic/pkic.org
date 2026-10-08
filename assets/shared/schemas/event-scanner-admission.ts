import { z } from "zod";
/** A recorded operator decision is evidence, never a seat reservation or capacity spend. */
export const scannerAdmissionDecisionSchema = z.enum(["allowed", "refused", "unresolved"]);
export type ScannerAdmissionDecision = z.infer<typeof scannerAdmissionDecisionSchema>;
/** Existing structured exception reasons authorize review of registration warnings only. */
export const scannerAdmissionExceptionWarnings = [
  "missing_registration",
  "canceled_registration",
  "wrong_attendance_mode",
] as const;
