import {
  eventBadgePrintPopulationQuerySchema,
  eventBadgePrintPopulationResponseSchema,
  type EventBadgePrintPopulationResponse,
} from "../../../shared/schemas/event-badge-printing";
import { MAX_PAGE_LIMIT } from "../../../shared/schemas/pagination";
import { getJson } from "../../shared/api-client";
import { buildServerCollectionUrl } from "../../hooks/useServerCollection";

const filtersSchema = eventBadgePrintPopulationQuerySchema.omit({ limit: true, cursor: true });
export type BadgePrintPopulationRow = EventBadgePrintPopulationResponse["registrations"][number];
export type BadgePrintScope =
  | { kind: "selected"; rows: readonly BadgePrintPopulationRow[] }
  | { kind: "filtered"; endpoint: string; filters: ReturnType<typeof filtersSchema.parse> };

export function filteredBadgePrintScope(endpoint: string, query: Readonly<Record<string, string>>): BadgePrintScope {
  const { q, status, waitlisted, attendance_type, badge_role } = query;
  return {
    kind: "filtered",
    endpoint,
    filters: filtersSchema.parse({ q, status, waitlisted, attendance_type, badge_role }),
  };
}

function assertPrintableRows(
  rows: readonly BadgePrintPopulationRow[],
  registrations = new Set<string>(),
  attendees = new Set<string>(),
) {
  for (const row of rows) {
    if (row.status !== "registered" || registrations.has(row.id) || attendees.has(row.user_id))
      throw new Error("The matching registrations changed or are not eligible for badges. Reload the registrations.");
    registrations.add(row.id);
    attendees.add(row.user_id);
  }
}

/** Resolve the complete server-filtered population before creating any credential. */
export async function loadBadgePrintPopulation(
  scope: BadgePrintScope,
  signal: AbortSignal,
  onProgress: (count: number) => void,
): Promise<BadgePrintPopulationRow[]> {
  if (scope.kind === "selected") {
    assertPrintableRows(scope.rows);
    return [...scope.rows];
  }
  const rows: BadgePrintPopulationRow[] = [];
  const registrations = new Set<string>();
  const attendees = new Set<string>();
  let total: number | undefined;
  let cursor: string | undefined;
  for (;;) {
    if (signal.aborted) throw new DOMException("Loading cancelled", "AbortError");
    const query = eventBadgePrintPopulationQuerySchema.parse({ ...scope.filters, limit: MAX_PAGE_LIMIT, cursor });
    const params = Object.fromEntries(
      Object.entries(query)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    );
    const response = await getJson(
      buildServerCollectionUrl(scope.endpoint, params),
      eventBadgePrintPopulationResponseSchema,
      { signal },
    );
    if (signal.aborted) throw new DOMException("Loading cancelled", "AbortError");
    total ??= response.page.total;
    if (
      response.page.total !== total ||
      response.page.limit !== query.limit ||
      response.registrations.length > query.limit
    )
      throw new Error("The matching registration count changed. Reload before creating badges.");
    assertPrintableRows(response.registrations, registrations, attendees);
    for (const row of response.registrations) {
      const previous = rows.at(-1)?.id;
      if (previous && row.id <= previous)
        throw new Error("The matching registration pages changed. Reload before creating badges.");
      rows.push(row);
    }
    if (rows.length > total) throw new Error("The matching registration count changed. Reload before creating badges.");
    onProgress(rows.length);
    const next = response.page.nextCursor;
    if (next === null) {
      if (rows.length !== total)
        throw new Error("Not all matching registrations were received. Reload before creating badges.");
      return rows;
    }
    if (
      !response.registrations.length ||
      next !== rows.at(-1)?.id ||
      (cursor && next <= cursor) ||
      rows.length === total
    )
      throw new Error("The matching registration pages changed. Reload before creating badges.");
    cursor = next;
  }
}
