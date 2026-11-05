import QRCode from "qrcode";
import sharp from "sharp";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { badgeLabelSvg } from "../../assets/shared/badge-label-svg";
import { composeBadgePrintSvg } from "../../assets/shared/badge-print-svg";
import { badgePrintPages, badgePrintPreset } from "../../assets/shared/badge-print-layout";

describe("Brother attendee labels", () => {
  it("rotates complete artwork into the native roll page and keeps readable QR ink inside the printer margins", async () => {
    const credential = "ABCDEFGHJKLMNPQR";
    const label = badgeLabelSvg(
      {
        svg: composeBadgePrintSvg(await QRCode.toString(credential, { type: "svg", margin: 4 }), credential),
        displayName: "Synthetic Attendee",
        firstName: "Synthetic",
        lastName: "Attendee",
        jobTitle: "Cryptography Policy Adviser",
        organization: "Example Research Lab",
      },
      38,
      89.8,
    );
    expect(label).toContain('width="38mm" height="89.8mm" viewBox="0 0 38 89.8"');
    expect(label).toContain("rotate(90)");
    const { data, info } = await sharp(Buffer.from(label), { density: 300 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data).toBe(credential);
    let minimumX = info.width,
      minimumY = info.height,
      maximumX = 0,
      maximumY = 0;
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        const pixel = (y * info.width + x) * info.channels;
        if (data[pixel] < 100 && data[pixel + 1] < 100 && data[pixel + 2] < 100) {
          minimumX = Math.min(minimumX, x);
          maximumX = Math.max(maximumX, x);
          minimumY = Math.min(minimumY, y);
          maximumY = Math.max(maximumY, y);
        }
      }
    expect((minimumX / info.width) * 38).toBeGreaterThanOrEqual(1.5);
    expect(((info.width - maximumX) / info.width) * 38).toBeGreaterThanOrEqual(1.5);
    expect((minimumY / info.height) * 89.8).toBeGreaterThanOrEqual(3);
    expect(((info.height - maximumY) / info.height) * 89.8).toBeGreaterThanOrEqual(3);
  });

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
    expect(pages.every((page) => page.widthMm === 38 && page.heightMm === 89.8 && page.slots.length === 1)).toBe(true);
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

it("draws decodable labels directly from authorized compact data without an intermediate QR image", async () => {
  const credential = "23456789ABCDEFGH";
  const svg = badgeLabelSvg(
    {
      svg: "",
      credential,
      firstName: "Alex",
      lastName: "Example",
      displayName: "Alex Example",
      jobTitle: null,
      organization: null,
    },
    38,
    89.8,
  );
  expect(svg).not.toContain("<image");
  expect(svg).toContain("2345-6789-ABCD-EFGH");
  const raster = await sharp(Buffer.from(svg), { density: 300 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(jsQR(new Uint8ClampedArray(raster.data), raster.info.width, raster.info.height)?.data).toBe(credential);
});

it("refuses a supplied code that disagrees with the existing badge", async () => {
  const svg = composeBadgePrintSvg(
    await QRCode.toString("ABCDEFGHJKLMNPQR", { type: "svg", margin: 4 }),
    "ABCDEFGHJKLMNPQR",
  );
  expect(() =>
    badgeLabelSvg({
      svg,
      credential: "23456789ABCDEFGH",
      firstName: "Alex",
      lastName: "Example",
      displayName: "Alex Example",
      jobTitle: null,
      organization: null,
    }),
  ).toThrow("do not match");
});
