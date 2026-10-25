/** Bounded fixture data for the shared picker; no live account data enters the gallery. */
import { useState } from "preact/hooks";
import { z } from "zod";
import { paginatedResponseSchema } from "../../../shared/schemas/pagination";
import { ServerSearchSelect } from "../../components/ServerSearchSelect";
import { Field } from "../Field";

const item = z.object({ id: z.string(), name: z.string() });
const schema = paginatedResponseSchema("items", item);
const choices = [
  { id: "current", name: "Northstar Trust Association · Program lead" },
  { id: "other", name: "Harbor Security Labs · Engineering representative" },
];
const catalog = {
  endpoint: "/gallery/identities",
  sort: "name",
  responseSchema: schema,
  resolveItems: (response: z.infer<typeof schema>) => response.items,
  resolvePage: (response: z.infer<typeof schema>) => response.page,
  itemKey: (choice: z.infer<typeof item>) => choice.id,
  itemLabel: (choice: z.infer<typeof item>) => choice.name,
};

export function ServerSelectPreview() {
  const [selected, setSelected] = useState<z.infer<typeof item> | null>(choices[0]);
  return (
    <div data-gallery-open>
      <Field label="Representation">
        {(control) => (
          <ServerSearchSelect
            {...control}
            catalog={catalog}
            searchable={false}
            allowEmpty={false}
            value={selected?.id ?? null}
            selectedLabel={selected?.name}
            searchLabel="Your identities"
            onChange={setSelected}
            load={async (_url, _signal, response) =>
              response.parse({ items: choices, page: { limit: 25, offset: 0, total: 2, hasMore: false } })
            }
          />
        )}
      </Field>
    </div>
  );
}
