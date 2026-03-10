const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function uuid(): string {
  return crypto.randomUUID();
}

export function randomBase62(length: number): string {
  const chars: string[] = [];
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i += 1) {
    chars.push(BASE62[bytes[i] % BASE62.length]);
  }
  return chars.join("");
}
