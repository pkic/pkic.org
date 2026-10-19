import { beforeEach, describe, expect, it } from "vitest";
import { attendancePointSvg } from "../functions/_lib/services/event-attendance-points/point-exports";
import { createAttendancePointFixture } from "./helpers/attendance-point-fixture";

const fixture = createAttendancePointFixture();
const { dates, request } = fixture;

describe("check-in code downloads", () => {
  beforeEach(fixture.setup);

  it("downloads one static code as an SVG holding only its QR code", async () => {
    const response = await request(
      "organizer",
      `/attendance/points/exports?format=svg&kind=venue_check_in&dayDate=${dates.today}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="day-1-check-in.svg"');
    const svg = await response.text();
    const [point] = await fixture.points(`?kind=venue_check_in&dayDate=${dates.today}`);
    // The same static code the listing signs, pointing at this deployment's portal.
    expect(svg).toBe(attendancePointSvg(point!, "https://app.test"));
    expect(svg).toContain("<title>Check-in code: Day 1 check-in</title>");
    expect(svg).not.toContain("<script");
  });

  it("refuses an SVG download for a filter that selects more than one code", async () => {
    expect((await request("organizer", "/attendance/points/exports?format=svg")).status).toBe(400);
    expect((await request("attendee", "/attendance/points/exports?format=zip")).status).toBe(403);
  });

  it("downloads every listed code as a ZIP with one SVG each", async () => {
    const response = await request("organizer", "/attendance/points/exports?format=zip");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="check-in-test-check-in-codes.zip"');
    const archive = new TextDecoder("latin1").decode(await response.arrayBuffer());
    for (const name of [
      "day-1-check-in.svg",
      "day-1-check-out.svg",
      "day-2-check-in.svg",
      "day-2-check-out.svg",
      "main-hall.svg",
    ])
      expect(archive).toContain(name);
    // Session codes are for screens and are only included when asked for.
    expect(archive).not.toContain("opening-keynote.svg");
    const sessions = new TextDecoder("latin1").decode(
      await (await request("organizer", "/attendance/points/exports?format=zip&kind=session")).arrayBuffer(),
    );
    expect(sessions).toContain("opening-keynote.svg");
  });
});
