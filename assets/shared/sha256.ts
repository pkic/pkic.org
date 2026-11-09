const encoder = new TextEncoder();

export async function sha256Hex(input: string | BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", typeof input === "string" ? encoder.encode(input) : input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
