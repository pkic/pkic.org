import { membershipWorkflowVersionResponseSchema } from "../../shared/schemas/membership-workflows";
import { useData } from "../hooks/useData";
import { getJson } from "../shared/api-client";
import { MEMBERSHIP_WORKFLOWS_API, publishedMembershipWorkflowCatalog } from "../shared/membership-workflow-catalog";
import type { FieldControlProps } from "../ui/Field";
import { ErrorAlert } from "./ErrorAlert";
import { ServerSearchSelect } from "./ServerSearchSelect";

export function MembershipWorkflowSelect({
  value,
  onChange,
  disabled,
  ...control
}: FieldControlProps & {
  name: string;
  value: string | null;
  onChange: (versionId: string | null) => void;
  disabled?: boolean;
}) {
  const selected = useData(
    () =>
      value
        ? getJson(`${MEMBERSHIP_WORKFLOWS_API}/${encodeURIComponent(value)}`, membershipWorkflowVersionResponseSchema)
        : Promise.resolve(null),
    [value],
  );
  return (
    <div class="pk-stack pk-stack--tight">
      <ServerSearchSelect
        {...control}
        catalog={publishedMembershipWorkflowCatalog}
        searchLabel="Published workflow"
        value={value}
        selectedLabel={selected.data ? publishedMembershipWorkflowCatalog.itemLabel(selected.data.workflow) : undefined}
        disabled={disabled}
        onChange={(workflow) => onChange(workflow?.id ?? null)}
      />
      <ErrorAlert error={selected.error} />
    </div>
  );
}
