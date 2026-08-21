import { z } from "zod";

/**
 * Canonical generated identifier for D1 rows.
 *
 * Runtime writes use RFC UUIDs, while migration-seeded rows use SQLite's
 * lower(hex(randomblob(16))) representation. Domains with intentional
 * natural ids, such as events and built-in roles, define named schemas on
 * top of the common bounded-string primitive instead of weakening this one.
 */
export const databaseIdSchema = z.union([z.uuid(), z.string().regex(/^[0-9a-f]{32}$/i, "Invalid database identifier")]);

export type DatabaseId = z.infer<typeof databaseIdSchema>;
