import type { ComponentChildren } from "preact";
import { ApiDataTable as SharedApiDataTable } from "../../components/ApiDataTable";
import type { ApiDataTableProps, ApiTableActions } from "../../components/ApiDataTable";
import { loadAdminCollection } from "../services/server-collection";

export type { ApiTableActions };

/** Temporary admin adapter preserving admin-specific authentication error handling. */
export function ApiDataTable<T, Response = unknown>(props: ApiDataTableProps<T, Response>): ComponentChildren {
  return <SharedApiDataTable {...props} load={loadAdminCollection} />;
}
