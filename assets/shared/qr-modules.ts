/**
 * A QR code as one SVG path of dark modules, for screens and print documents
 * that draw the code themselves at any size. The quiet zone is part of the
 * returned size, so a viewBox of `0 0 size size` on a light ground scans.
 */
import QRCode from "qrcode";

const QUIET_ZONE = 4;

export function qrModulePath(text: string): { size: number; path: string } {
  const modules = QRCode.create(text, { errorCorrectionLevel: "M" }).modules;
  const segments: string[] = [];
  for (let row = 0; row < modules.size; row++)
    for (let column = 0; column < modules.size; column++)
      if (modules.get(row, column)) segments.push(`M${column + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`);
  return { size: modules.size + QUIET_ZONE * 2, path: segments.join("") };
}
