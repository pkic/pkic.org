import type { CollectionLoader } from "../../hooks/useServerCollection";
import { api } from "../api";

/** Collection callers provide the endpoint schema; parsing belongs to the shared controller. */
export const loadAdminCollection: CollectionLoader = (url, signal, schema) => api(url, schema, { signal });
