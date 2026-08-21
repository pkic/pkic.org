import type { CollectionLoader } from "../../hooks/useServerCollection";
import { api } from "../api";

export const loadAdminCollection: CollectionLoader = (url, signal) => api<unknown>(url, { signal });
