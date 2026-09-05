import crypto from "node:crypto";

/**
 * A stable identifier for a seeded row.
 *
 * Re-running must not duplicate rows, so these ids cannot be random — but they
 * also cannot be readable literals like `seed-identity-peer`, because every id
 * a seed writes is one an API response later parses through `databaseIdSchema`,
 * which accepts a UUID or 32 hex characters and nothing else. A readable
 * literal seeds a database that fails its own contracts: it broke sign-in for
 * the seeded peer, whose session response carries the identity and member ids
 * verbatim.
 *
 * Derived UUIDv5-style from the caller's namespace, so the same key always
 * yields the same id without a lookup table.
 */
function stableId(namespace, key) {
  const hash = crypto.createHash("sha1").update(`${namespace}:${key}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Ids for the member-profile demo seed.
 *
 * Bound here rather than at each call site so the namespace exists once. The
 * same key must yield the same id in every module that writes these rows, and
 * a namespace repeated in two files is a namespace that can drift in one.
 */
export function memberProfileId(key) {
  return stableId("pkic-seed-member-profiles", key);
}
