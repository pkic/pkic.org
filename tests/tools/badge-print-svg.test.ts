import QRCode from "qrcode";
import sharp from "sharp";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { composeBadgePrintSvg } from "../../assets/shared/badge-print-svg";
import { formatBadgeCredential } from "../../assets/shared/schemas/badge-credential";

describe("printable badge manual credential", () => {
  it.each(["ABCDEFGHJKLMNPQR", "23456789ABCDEFGH"])(
    "prints the complete %s credential below unchanged decodable QR pixels",
    async (credential) => {
      const qr = await QRCode.toString(credential, { type: "svg", errorCorrectionLevel: "M", margin: 4 });
      const printable = composeBadgePrintSvg(qr, credential);
      expect(printable).toContain(">Badge code</text>");
      expect(printable).toContain(`>${formatBadgeCredential(credential)}</text>`);
      const original = await sharp(Buffer.from(qr), { density: 72 * 16 })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const printed = await sharp(Buffer.from(printable), { density: 72 * 16 })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(printed.info.height).toBeGreaterThan(original.info.height);
      const dimensions = printable.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/)!;
      const canvasWidth = Number(dimensions[1]);
      const canvasHeight = Number(dimensions[2]);
      const offset = Number(printable.match(/translate\(([0-9.]+) 0\)/)![1]);
      expect(canvasHeight).toBeLessThanOrEqual(canvasWidth);
      const codeFont = Number(printable.match(/font-size="([0-9.]+)" textLength=/)![1]);
      for (const [imageMillimeters, expectedPoints] of [
        [36, 8.25],
        [72, 16.5],
      ] as const) {
        const printedPoints = ((codeFont / canvasWidth) * imageMillimeters * 72) / 25.4;
        expect(printedPoints).toBeCloseTo(expectedPoints, 10);
        expect(printedPoints).toBeGreaterThanOrEqual(8);
      }
      expect((Number(printable.match(/textLength="([0-9.]+)"/)![1]) / canvasWidth) * 36).toBeCloseTo(32.4, 10);
      const originalArea = await sharp(Buffer.from(printable), { density: 72 * 16 })
        .extract({ left: Math.round(offset * 16), top: 0, width: original.info.width, height: original.info.height })
        .ensureAlpha()
        .raw()
        .toBuffer();
      expect(originalArea).toEqual(original.data);
      expect(jsQR(new Uint8ClampedArray(printed.data), printed.info.width, printed.info.height)?.data).toBe(credential);
    },
  );
  it("refuses malformed credentials and non-QR SVG rather than printing a record reference substitute", () => {
    const qr = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 37 37"></svg>';
    expect(() => composeBadgePrintSvg(qr, "ABCD")).toThrow();
    expect(() => composeBadgePrintSvg(qr, "20000000-0000-4000-8000-000000000123")).toThrow();
    expect(() => composeBadgePrintSvg("<svg/>", "ABCDEFGHJKLMNPQR")).toThrow();
  });
});
