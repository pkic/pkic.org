import { groupEventRegistrationExportQuerySchema } from "../../../shared/schemas/group-event-registration-operations";
import { buildServerCollectionUrl } from "../../hooks/useServerCollection";

/** Exports share the roster's filters, with pagination removed and optional explicit selection. */
export function registrationRosterExportUrl(
  endpoint: string,
  query: Readonly<Record<string, string>>,
  ids?: readonly string[],
): string {
  const filters = groupEventRegistrationExportQuerySchema.omit({ ids: true }).strip().parse(query);
  const scope = groupEventRegistrationExportQuerySchema.parse({ ...filters, ...(ids ? { ids: ids.join(",") } : {}) });
  return buildServerCollectionUrl(
    endpoint,
    Object.fromEntries(
      Object.entries(scope)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    ),
  );
}
