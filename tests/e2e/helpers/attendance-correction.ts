import { randomUUID } from "node:crypto";
import { expect, type Page, type TestInfo } from "@playwright/test";
import {
  attendanceCorrectionRequestSchema,
  attendanceCorrectionSchema,
  attendanceCorrectionHistoryResponseSchema,
  attendanceEvidenceResponseSchema,
} from "../../../assets/shared/schemas/event-attendance-corrections";
import { attendanceSummarySchema } from "../../../assets/shared/schemas/event-attendance-reporting";
import { enrolledEventScanRequestSchema } from "../../../assets/shared/schemas/event-participation-scanning";
import { userAuthSessionResponseSchema } from "../../../assets/shared/schemas/user-auth";
import { capturePilot } from "./agenda-integrated-pilot";

/** Correct the effective view through the real UI while retaining the original capture and its history. */
export async function correctPilotAttendance(
  staff: Page,
  door: Page,
  slug: string,
  _title: string,
  scan: ReturnType<typeof enrolledEventScanRequestSchema.parse>,
  info: TestInfo,
) {
  const base = `/api/v1/events/${encodeURIComponent(slug)}/attendance`;
  const evidencePath = `${base}/observations?occurrenceId=${scan.occurrenceId}&limit=10&offset=0`;
  const readEvidence = async () => {
    const response = await staff.request.get(evidencePath);
    expect(response.status()).toBe(200);
    return attendanceEvidenceResponseSchema.parse(await response.json()).observations;
  };
  const originals = await readEvidence();
  expect(originals).toHaveLength(1);
  const original = originals[0];
  if (!original || !scan.occurrenceId) throw new Error("The pilot must capture one original session observation");
  expect(original).toMatchObject({
    occurrenceId: scan.occurrenceId,
    observedAt: scan.observedAt,
    operatorUserId: scan.operatorUserId,
    deviceId: scan.deviceId,
    action: "attendance",
    revision: 0,
    voided: false,
  });
  const session = await staff.request.get("/api/v1/auth/session");
  expect(session.status()).toBe(200);
  const actorId = userAuthSessionResponseSchema.parse(await session.json()).identity.id;
  const path = `${base}/observations/${original.id}/corrections`;
  const history = async () => {
    const response = await staff.request.get(`${path}?sort=revision&limit=10&offset=0`);
    expect(response.status()).toBe(200);
    return attendanceCorrectionHistoryResponseSchema.parse(await response.json()).corrections;
  };
  expect(await history()).toHaveLength(0);
  const refused = await door.request.post(path, {
    data: attendanceCorrectionRequestSchema.parse({
      operationId: randomUUID(),
      expectedRevision: 0,
      kind: "void",
      reasonCode: "operator_error",
    }),
  });
  expect(refused.status()).toBe(403);
  expect(await history()).toHaveLength(0);
  expect(await readEvidence()).toEqual(originals);

  const reportUrl = new URL(staff.url());
  reportUrl.hash = `${reportUrl.hash.replace(/\/attendance(?:\/.*)?$/, "/attendance")}/sessions/${encodeURIComponent(scan.occurrenceId)}/evidence`;
  await staff.goto(reportUrl.toString());
  await expect(
    staff
      .getByRole("navigation", { name: "Session attendance sections", exact: true })
      .getByRole("link", { name: "Observations", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const evidence = staff.getByRole("table", { name: "Original attendance evidence", exact: true });
  const corrections: ReturnType<typeof attendanceCorrectionSchema.parse>[] = [];
  for (const [kind, revision, reasonCode, button, status] of [
    ["void", 1, "operator_error", "Exclude observation from attendance", "Excluded by correction"],
    ["restore", 2, "verified_evidence_review", "Restore observation", "Included"],
  ] as const) {
    await evidence
      .getByRole("button", { name: `Actions for ${original.displayName ?? "Attendance observation"}`, exact: true })
      .click();
    await staff.getByRole("menuitem", { name: "Review observation", exact: true }).click();
    await staff.getByRole("combobox", { name: "Correction reason", exact: true }).selectOption(reasonCode);
    const changed = staff.waitForResponse(
      (response) => new URL(response.url()).pathname === path && response.request().method() === "POST",
      { timeout: 30_000 },
    );
    await staff.getByRole("button", { name: button, exact: true }).click();
    const response = await changed;
    expect(response.status()).toBe(200);
    const input = attendanceCorrectionRequestSchema.parse(response.request().postDataJSON());
    expect(input).toMatchObject({ kind, reasonCode, expectedRevision: revision - 1 });
    const correction = attendanceCorrectionSchema.parse(await response.json());
    expect(correction).toMatchObject({
      observationId: original.id,
      actorUserId: actorId,
      operationId: input.operationId,
      revision,
      kind,
      reasonCode,
    });
    const replay = await staff.request.post(path, { data: input });
    expect(replay.status()).toBe(200);
    expect(attendanceCorrectionSchema.parse(await replay.json())).toEqual(correction);
    corrections.push(correction);
    expect(await history()).toEqual(corrections);
    const updated = (await readEvidence())[0];
    expect(updated).toEqual({ ...original, revision, voided: kind === "void" });
    const summaryResponse = await staff.request.get(`${base}/summary`);
    expect(summaryResponse.status()).toBe(200);
    const summary = attendanceSummarySchema.parse(await summaryResponse.json());
    expect(summary.observed).toMatchObject({
      originalObservations: 1,
      effectiveObservations: kind === "void" ? 0 : 1,
      voidedObservations: kind === "void" ? 1 : 0,
      uniquePeople: kind === "void" ? 0 : 1,
    });
    expect(summary.attempts).toMatchObject({ attendance: 1, admissionAllowed: 1, uniqueAllowedAdmissionPeople: 1 });
    expect(summary.sync.deviceBacklog).toBe("complete");
    await expect(evidence.getByRole("cell", { name: status, exact: true })).toBeVisible();
    await capturePilot(staff, info, `pilot-attendance-${kind}`);
  }
  return { original, corrections };
}
