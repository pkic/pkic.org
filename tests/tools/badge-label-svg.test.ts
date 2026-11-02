import QRCode from "qrcode";
import sharp from "sharp";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { badgeLabelSvg } from "../../assets/shared/badge-label-svg";
import { composeBadgePrintSvg } from "../../assets/shared/badge-print-svg";
import { badgePrintPages, badgePrintPreset } from "../../assets/shared/badge-print-layout";

describe("Brother attendee labels", () => {
  it("prints two actual-size labels per attendee, with a decodable original code and live profile details", async () => {
    const credential = "ABCDEFGHJKLMNPQR";
    const svg = badgeLabelSvg({
      svg: composeBadgePrintSvg(await QRCode.toString(credential, { type: "svg", margin: 4 }), credential),
      displayName: "Synthetic Attendee",
      firstName: "Synthetic",
      lastName: "Attendee",
      jobTitle: "Cryptography Policy Adviser",
      organization: "Example Research Lab",
    });
    expect(svg).toContain('width="90.3mm" height="38mm"');
    for (const value of ["Synthetic", "Attendee", "Cryptography Policy Adviser", "Example Research Lab"])
      expect(svg).toContain(value);
    const raster = await sharp(Buffer.from(svg), { density: 300 })
      .resize(Math.round((90.3 / 25.4) * 300), Math.round((38 / 25.4) * 300))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(jsQR(new Uint8ClampedArray(raster.data), raster.info.width, raster.info.height)?.data).toBe(credential);
    const pages = [...badgePrintPages(2, badgePrintPreset("brother_dk_1208"))];
    expect(pages).toHaveLength(4);
    expect(pages.map((page) => page.slots[0].itemIndex)).toEqual([0, 0, 1, 1]);
    expect(pages.every((page) => page.widthMm === 90.3 && page.heightMm === 38 && page.slots.length === 1)).toBe(true);
  });

  it("keeps long and non-ASCII names as complete text, escapes markup, and handles missing fields", () => {
    const svg = badgeLabelSvg({
      svg: "<svg/>",
      displayName: "Zoë <Example>",
      firstName: "Zoë",
      lastName: "van Example-SyntheticLongSurname",
      jobTitle: null,
      organization: "Research & Development",
    });
    expect(svg).toContain(">van</text>");
    expect(svg).toContain(">Example-SyntheticLongSurname</text>");
    expect(svg).toContain("Research &amp; Development");
    expect(svg).toContain('aria-label="Zoë &lt;Example&gt;"');
    expect(svg).not.toContain("null");
  });
});
