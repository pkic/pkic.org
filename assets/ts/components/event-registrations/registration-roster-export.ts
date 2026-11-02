import { groupEventRegistrationExportQuerySchema } from "../../../shared/schemas/group-event-registration-operations";
import { buildServerCollectionUrl } from "../../hooks/useServerCollection";

/** Exports share the roster's filters, with pagination removed and optional explicit selection. */
export function registrationRosterExportUrl(
  endpoint: string,
  query: Readonly<Record<string, string>>,
  ids?: readonly string[],
): string | null {
  const filters = groupEventRegistrationExportQuerySchema.omit({ ids: true }).strip().safeParse(query);
  if (!filters.success) return null;
  const scope = groupEventRegistrationExportQuerySchema.safeParse({
    ...filters.data,
    ...(ids ? { ids: ids.join(",") } : {}),
  });
  if (!scope.success) return null;
  return buildServerCollectionUrl(
    endpoint,
    Object.fromEntries(
      Object.entries(scope.data)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    ),
  );
}
