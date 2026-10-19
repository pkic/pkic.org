import type { Permission } from "./schemas/permissions";
import { scanActionSchema } from "./schemas/event-participation-scanning";
/** Legacy scan is deliberately broad; new action grants are independent. */
export const scannerCapabilities = ["agenda:check", "agenda:admit", "agenda:attendance_record"] as const;
export type ScannerCapability = (typeof scannerCapabilities)[number];
export function scannerPermission(
  check: (permission: Permission) => boolean,
  capability: ScannerCapability,
): Permission | null {
  if (check(capability)) return capability;
  return check("agenda:scan") ? "agenda:scan" : null;
}
export function scanActionCapability(action: string): ScannerCapability {
  return action === "check"
    ? "agenda:check"
    : action === "attendance" || action === "checkout"
      ? "agenda:attendance_record"
      : "agenda:admit";
}

/** Ordinary scan choices derive from the canonical protocol and independent action grants. */
export function availableScannerActions(check: (permission: Permission) => boolean) {
  return scanActionSchema.options.filter(
    (action) => action !== "lead" && action !== "exception" && scannerPermission(check, scanActionCapability(action)),
  );
}
