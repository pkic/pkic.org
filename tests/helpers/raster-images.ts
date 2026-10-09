/** Structurally valid raster headers for upload-boundary tests. */
export function validJpegBytes(width = 1, height = 1): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x08,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x01,
    0xff,
    0xd9,
  ]);
}

export function validPngBytes(width = 1, height = 1): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([0x08, 0x06, 0x00, 0x00, 0x00], 24);
  return bytes;
}

export function validWebpBytes(width = 1, height = 1): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(30);
  bytes.set([
    0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00,
    0x00,
  ]);
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  bytes.set([0x00, 0x00, 0x00, 0x00, encodedWidth & 0xff, encodedWidth >> 8, encodedWidth >> 16], 20);
  bytes.set([encodedHeight & 0xff, encodedHeight >> 8, encodedHeight >> 16], 27);
  return bytes;
}
