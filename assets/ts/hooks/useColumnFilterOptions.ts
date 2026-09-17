import { useState } from "preact/hooks";
import { listFilterOptionsResponseSchema } from "../../shared/schemas/list-filter-options";
import type { ColumnFilter } from "../components/Table";
import { useServerCollection, type CollectionLoader } from "./useServerCollection";
import { getJson } from "../shared/api-client";

const loadOptions: CollectionLoader = (url, signal, schema) => getJson(url, schema, { signal });

/** Option values are paged by the server, independently of the table's row page. */
export function useColumnFilterOptions(endpoint: string, param: string, allLabel: string): ColumnFilter {
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const collection = useServerCollection({
    endpoint,
    params: { field: param, limit: String(limit), offset: String(offset), sort: "value" },
    responseSchema: listFilterOptionsResponseSchema,
    load: loadOptions,
  });
  const page = collection.data?.page;
  return {
    param,
    options: [{ value: "", label: allLabel }, ...(collection.data?.options ?? [])],
    optionNavigation: [
      ...(collection.loading
        ? [{ id: `${param}-loading`, label: "Loading choices…", disabled: true, onSelect: () => undefined }]
        : []),
      ...(collection.error
        ? [
            {
              id: `${param}-retry`,
              label: "Couldn't load choices — retry",
              keepOpen: true,
              onSelect: () => void collection.reload(),
            },
          ]
        : []),
      ...(offset > 0
        ? [
            {
              id: `${param}-previous`,
              label: "Previous choices",
              keepOpen: true,
              disabled: collection.loading,
              onSelect: () => setOffset(Math.max(0, offset - limit)),
            },
          ]
        : []),
      ...(page?.hasMore
        ? [
            {
              id: `${param}-next`,
              label: "More choices",
              keepOpen: true,
              disabled: collection.loading,
              onSelect: () => setOffset(offset + limit),
            },
          ]
        : []),
    ],
  };
}
