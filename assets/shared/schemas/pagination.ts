/**
 * Shared list/pagination contract, reused by every admin list endpoint
 * (organizations, applications, sponsorships, members, content-reviews,
 * ...) instead of each schema file redeclaring an identical `limit`/
 * `offset`/`page` envelope and its own allowlisted-sort validator.
 */
import { z } from "zod";

export const DEFAULT_PAGE_LIMIT = 50;
export const DEFAULT_PAGE_OFFSET = 0;
export const MAX_PAGE_LIMIT = 200;

export interface PaginationDefaults {
  limit?: number;
  offset?: number;
}

/**
 * Builds a pagination query whose parsed output is always resolved. Endpoint
 * schemas own non-standard defaults; routes and services must consume the
 * parsed values instead of redeclaring fallback behavior.
 */
export function paginationQuerySchemaWithDefaults(defaults: PaginationDefaults = {}) {
  const limit = defaults.limit ?? DEFAULT_PAGE_LIMIT;
  const offset = defaults.offset ?? DEFAULT_PAGE_OFFSET;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new RangeError(`Default page limit must be an integer from 1 through ${MAX_PAGE_LIMIT}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError("Default page offset must be a non-negative integer");
  }
  return z.object({
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(limit),
    offset: z.coerce.number().int().min(0).default(offset),
  });
}

export const paginationQuerySchema = paginationQuerySchemaWithDefaults();

export const searchQuerySchema = z.object({
  // Keep collection search bounded while permitting a complete email address.
  // The shared D1 search builder uses bound INSTR contains predicates so long
  // values do not exceed D1's LIKE/GLOB pattern limit.
  q: z
    .string()
    .trim()
    .min(1)
    .max(254)
    .refine((value) => new TextEncoder().encode(value).byteLength <= 254, "Search must be at most 254 UTF-8 bytes")
    .optional(),
});

/** Canonical pagination/search contract for list endpoints without sorting. */
export const searchableQuerySchema = paginationQuerySchema.merge(searchQuerySchema);

export const pageInfoSchema = z.object({
  limit: z.number().int().min(1).max(200),
  offset: z.number().int().min(0),
  total: z.number().int().min(0),
  hasMore: z.boolean(),
});

export type PageInfo = z.infer<typeof pageInfoSchema>;

/** Builds the `page` envelope for a list response from the resolved query + result set. */
export function buildPageInfo(limit: number, offset: number, total: number, itemCount: number): PageInfo {
  return { limit, offset, total, hasMore: offset + itemCount < total };
}

export function paginatedResponseSchema<K extends string, T extends z.ZodTypeAny>(
  itemsKey: K,
  itemSchema: T,
): z.ZodObject<{ [P in K]: z.ZodArray<T> } & { page: typeof pageInfoSchema }> {
  return z.object({
    [itemsKey]: z.array(itemSchema),
    page: pageInfoSchema,
  }) as never;
}

/**
 * Builds a validator for an allowlisted `sort` query param: an optional
 * column name, optionally prefixed with `-` for descending. Reused by every
 * list endpoint that supports `?sort=` instead of each one hand-rolling the
 * same `.refine()`.
 */
export function sortColumnSchema<Columns extends readonly string[]>(columns: Columns) {
  return z
    .string()
    .trim()
    .min(1)
    .max(41)
    .refine(
      (value) => {
        const field = value.startsWith("-") ? value.slice(1) : value;
        return (columns as readonly string[]).includes(field);
      },
      { message: "Unknown sort column" },
    )
    .optional();
}

/** Builds the same allowlisted sort contract with a schema-owned default. */
export function sortColumnSchemaWithDefault<Columns extends readonly string[]>(
  columns: Columns,
  defaultValue: Columns[number] | `-${Columns[number]}`,
) {
  const schema = sortColumnSchema(columns);
  if (!schema.safeParse(defaultValue).success) {
    throw new RangeError(`Default sort '${defaultValue}' is not in the endpoint allowlist`);
  }
  return schema.default(defaultValue);
}

/**
 * Canonical query contract for searchable, sortable list endpoints. Domain
 * filters belong in a caller-owned `.extend(...)`; pagination, search, and
 * sort must not be redeclared per resource.
 */
export function listQuerySchema<Columns extends readonly string[]>(
  columns: Columns,
  defaults: PaginationDefaults = {},
) {
  return searchableListQuerySchema(sortColumnSchema(columns), defaults);
}

/** Shared pagination/search contract for endpoints whose sort vocabulary is a domain-specific enum. */
export function searchableListQuerySchema<SortSchema extends z.ZodTypeAny>(
  sortSchema: SortSchema,
  defaults: PaginationDefaults = {},
) {
  return paginationQuerySchemaWithDefaults(defaults).merge(searchQuerySchema).extend({
    sort: sortSchema,
  });
}
