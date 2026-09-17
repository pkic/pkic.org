import { groupResponseSchema } from "../../../../../shared/schemas/groups";
import { mailingListResponseSchema, mailingListsListResponseSchema } from "../../../../../shared/schemas/mailing-lists";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { activeAdminGroupCatalog } from "../../../../shared/management-catalogs";
import type { ServerCatalog } from "../../../../shared/server-catalog";
import type { FieldControlProps } from "../../../../ui/Field";
import type { z } from "zod";
import type { MailingList } from "../../../../../shared/schemas/mailing-lists";

const destinations = "/api/v1/membership/workflows/destinations";
const mailingCatalog: ServerCatalog<MailingList, z.infer<typeof mailingListsListResponseSchema>> = {
  endpoint: destinations,
  responseSchema: mailingListsListResponseSchema,
  resolveItems: (data) => data.mailingLists,
  resolvePage: (data) => data.page,
  itemKey: (item) => item.id,
  itemLabel: (item) => `${item.label} (${item.email})`,
  sort: "label",
};
type Props = FieldControlProps & { name: string; value: string | null; onChange: (id: string | null) => void };
export function WorkflowGroupSelect({ value, onChange, ...control }: Props) {
  const selected = useData(
    () => (value ? getJson(`/api/v1/groups/${encodeURIComponent(value)}`, groupResponseSchema) : Promise.resolve(null)),
    [value],
  );
  return (
    <div class="pk-stack pk-stack--tight">
      <ServerSearchSelect
        {...control}
        value={value}
        onChange={(item) => onChange(item?.id ?? null)}
        catalog={activeAdminGroupCatalog()}
        selectedLabel={selected.data?.group.name}
        searchLabel="Reviewer group"
      />
      <ErrorAlert error={selected.error} />
    </div>
  );
}
export function WorkflowDestinationSelect({ value, onChange, ...control }: Props) {
  const selected = useData(
    () =>
      value
        ? getJson(`${destinations}/${encodeURIComponent(value)}`, mailingListResponseSchema)
        : Promise.resolve(null),
    [value],
  );
  return (
    <div class="pk-stack pk-stack--tight">
      <ServerSearchSelect
        {...control}
        value={value}
        onChange={(item) => onChange(item?.id ?? null)}
        catalog={mailingCatalog}
        selectedLabel={selected.data ? mailingCatalog.itemLabel(selected.data.mailingList) : undefined}
        searchLabel="Notification list"
      />
      <ErrorAlert error={selected.error} />
    </div>
  );
}
