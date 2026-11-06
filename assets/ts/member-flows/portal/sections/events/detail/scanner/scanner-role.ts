import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";

/** The same task identity drives scanner color and successful-scan audio. */
export function scannerRole(action: EventScanRequest["action"], session = false, printing = false) {
  return printing
    ? "print"
    : action === "lead"
      ? "lead"
      : session
        ? "session"
        : action === "checkout"
          ? "exit"
          : "entry";
}
