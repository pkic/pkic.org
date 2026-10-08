import { requestJson } from "../../../../../../shared/api-client";
import type { CollectionLoader } from "../../../../../../hooks/useServerCollection";
/** Contacts and attribution are live, with no HTTP cache or persistent browser copy. */
export const loadLiveSponsorLeads: CollectionLoader = (url, signal, schema) =>
  requestJson(url, schema, { method: "GET", signal, cache: "no-store" });
