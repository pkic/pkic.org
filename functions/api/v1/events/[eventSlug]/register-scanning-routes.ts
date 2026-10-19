import { ScannerFailureCreate } from "./scanner-failures";
import { EventScanCreate, ScannerTargetsGet } from "./scans";
import { ScannerSuggestionsGet } from "./scanner-suggestions";
import { OfflineEligibilityGet } from "./offline-eligibility";
import {
  ScannerDeviceEnrollmentPost,
  ScannerDeviceStatusGet,
  ScannerDeviceClosingPost,
} from "./scanner-device-sessions";

type ScanningRouter = Pick<typeof import("./router").openapi, "get" | "post">;

/** Scanner capture, device sessions and offline eligibility, behind the event router's management middleware. */
export function registerScanningRoutes(openapi: ScanningRouter): void {
  openapi.post("/scans", EventScanCreate);
  openapi.post("/scans/failures", ScannerFailureCreate);
  openapi.post("/scanner/devices/sessions", ScannerDeviceEnrollmentPost);
  openapi.get("/scanner/devices/sessions/:epochId", ScannerDeviceStatusGet);
  openapi.post("/scanner/devices/sessions/:epochId/closing", ScannerDeviceClosingPost);
  openapi.get("/scans/targets", ScannerTargetsGet);
  openapi.get("/scans/suggestions", ScannerSuggestionsGet);
  openapi.get("/offline-eligibility", OfflineEligibilityGet);
}
