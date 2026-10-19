import { AttendanceImportsGet, AttendanceImportReviewCreate, AttendanceImportCreate } from "./attendance-imports";
import {
  AttendanceEvidenceGet,
  AttendanceCorrectionHistoryGet,
  AttendanceCorrectionCreate,
} from "./attendance-corrections";
import {
  AttendanceSummaryGet,
  AttendanceAttemptsGet,
  AttendanceReasonsGet,
  EventAttendancePeopleGet,
} from "./attendance-reporting";
import {
  AttendancePeopleExportGet,
  AttendanceAttemptsExportGet,
  AttendanceSummaryExportGet,
} from "./attendance-exports";
import {
  AttendanceCheckInCreate,
  AttendanceCheckOutCreate,
  AttendanceOccupancyGet,
  AttendancePointGet,
  AttendancePointIssuanceCreate,
  AttendancePointsExportGet,
  AttendancePointsGet,
  CurrentAttendanceGet,
} from "./attendance-points";
import { AttendanceAttributionsGet, AttendanceMovementsGet, SelfCheckInsGet } from "./attendance-movement";

type AttendanceRouter = Pick<typeof import("./router").openapi, "get" | "post">;

/** The event's attendance domain: evidence, reports, imports, check-in codes, self check-in and movement. */
export function registerAttendanceRoutes(openapi: AttendanceRouter): void {
  openapi.get("/attendance/imports", AttendanceImportsGet);
  openapi.post("/attendance/imports/reviews", AttendanceImportReviewCreate);
  openapi.post("/attendance/imports", AttendanceImportCreate);
  openapi.get("/attendance/summary", AttendanceSummaryGet);
  openapi.get("/attendance/attempts", AttendanceAttemptsGet);
  openapi.get("/attendance/reasons", AttendanceReasonsGet);
  openapi.get("/attendance/people", EventAttendancePeopleGet);
  openapi.get("/attendance/people/exports", AttendancePeopleExportGet);
  openapi.get("/attendance/attempts/exports", AttendanceAttemptsExportGet);
  openapi.get("/attendance/summary/exports", AttendanceSummaryExportGet);
  openapi.get("/attendance/observations", AttendanceEvidenceGet);
  openapi.get("/attendance/observations/:observationId/corrections", AttendanceCorrectionHistoryGet);
  openapi.post("/attendance/observations/:observationId/corrections", AttendanceCorrectionCreate);
  openapi.get("/attendance/points", AttendancePointsGet);
  openapi.post("/attendance/points/issuances", AttendancePointIssuanceCreate);
  openapi.get("/attendance/points/exports", AttendancePointsExportGet);
  openapi.get("/attendance/points/:pointToken", AttendancePointGet);
  openapi.get("/attendance/check-ins", SelfCheckInsGet);
  openapi.post("/attendance/check-ins", AttendanceCheckInCreate);
  openapi.get("/attendance/check-ins/current", CurrentAttendanceGet);
  openapi.post("/attendance/check-outs", AttendanceCheckOutCreate);
  openapi.get("/attendance/occupancy", AttendanceOccupancyGet);
  openapi.get("/attendance/attributions", AttendanceAttributionsGet);
  openapi.get("/attendance/movements", AttendanceMovementsGet);
}
