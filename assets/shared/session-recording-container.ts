export function recordingContainerMimeType(prefix: Uint8Array): "video/mp4" | "video/webm" | null {
  // Container signatures establish format only, never codec or playback support.
  if (prefix.length >= 16 && new TextDecoder().decode(prefix.subarray(4, 8)) === "ftyp") {
    const size = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(0);
    const brands = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "M4V "]);
    if (size >= 16 && size <= prefix.length && size % 4 === 0) {
      for (let index = 8; index < size; index += 4) {
        if (index === 12) continue;
        if (brands.has(new TextDecoder().decode(prefix.subarray(index, index + 4)))) return "video/mp4";
      }
    }
  }
  if (prefix.length >= 5 && prefix[0] === 0x1a && prefix[1] === 0x45 && prefix[2] === 0xdf && prefix[3] === 0xa3) {
    // Parse EBML header elements, rather than searching arbitrary media bytes for "webm".
    const vint = (at: number, id: boolean): { value: number; width: number } | null => {
      const first = prefix[at];
      if (!first) return null;
      let width = 1,
        mask = 0x80;
      while (!(first & mask) && width <= 8) {
        width++;
        mask >>= 1;
      }
      if (width > (id ? 4 : 8) || at + width > prefix.length) return null;
      let value = id ? first : first & (mask - 1);
      for (let i = 1; i < width; i++) value = value * 256 + prefix[at + i]!;
      return Number.isSafeInteger(value) ? { value, width } : null;
    };
    const header = vint(4, false);
    if (header && 4 + header.width + header.value <= prefix.length) {
      const end = 4 + header.width + header.value;
      let at = 4 + header.width;
      while (at < end) {
        const id = vint(at, true);
        if (!id) break;
        const size = vint(at + id.width, false);
        if (!size) break;
        at += id.width + size.width;
        if (at + size.value > end) break;
        if (id.value === 0x4282 && new TextDecoder().decode(prefix.subarray(at, at + size.value)) === "webm")
          return "video/webm";
        at += size.value;
      }
    }
  }
  return null;
}
