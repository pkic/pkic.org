import { describe, expect, it } from "vitest";
import { composeBadgePrintSvg } from "../../assets/shared/badge-print-svg";
import { badgePrintCsv, type PrintableBadgePrint } from "../../assets/ts/components/event-badges/badge-print-artifacts";

const code = "ABCDEFGHJKLMNPQR";
const badge: PrintableBadgePrint = {
  id: "10000000-0000-4000-8000-000000000001",
  displayName: "Synthetic Attendee",
  firstName: "Synthetic",
  lastName: "Attendee",
  jobTitle: "Cryptography Policy Advisor",
  organization: "Example Research Lab",
  badgeRole: "attendee",
  svg: composeBadgePrintSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 37 37"><path d="M4 4h1v1H4z"/></svg>',
    code,
  ),
};
describe("printer personalization CSV", () => {
  it("matches the supplied seven-column template, including recovered badge codes", () => {
    expect(badgePrintCsv([badge])).toBe(
      "\uFEFFrole,first_name,last_name,job_title,organisation,attendee_id,qr_content\r\nAttendee,Synthetic,Attendee,Cryptography Policy Advisor,Example Research Lab,ABCD-EFGH-JKLM-NPQR,ABCDEFGHJKLMNPQR",
    );
    expect(badgePrintCsv([{ ...badge, credential: code }])).toBe(badgePrintCsv([badge]));
  });
  it("preserves accents and quoted values and neutralizes spreadsheet formulas", () => {
    const csv = badgePrintCsv([
      { ...badge, firstName: "Émilie", organization: 'Research, "Europe"', jobTitle: "=SUM(1,2)" },
    ]);
    expect(csv).toContain("Émilie");
    expect(csv).toContain('"Research, ""Europe"""');
    expect(csv).toContain('"\'=SUM(1,2)"');
  });
  it("refuses missing codes or a supplied code that differs from the printed QR", () => {
    expect(() => badgePrintCsv([{ ...badge, svg: "<svg/>" }])).toThrow("no printable QR code");
    expect(() => badgePrintCsv([{ ...badge, credential: "23456789ABCDEFGH" }])).toThrow("no printable QR code");
  });
});
